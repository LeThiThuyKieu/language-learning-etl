import mysql from "mysql2/promise";
import mongoose from "mongoose";
import { Schema } from "mongoose";
import * as dotenv from "dotenv";
import * as fs from "fs";
import csv from "csv-parser";
import path from "path";
import { fileURLToPath } from "url";

import {
  initTopicClassifier,
  classifyTopic,
} from "./ai/topic-embedding-classifier.ts";
import { mapNodeId } from "./ai/node-mapper.ts";

dotenv.config({ quiet: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MongoDB Schema
const QuestionMongoSchema = new Schema({
  question_text: String,
  distractors: [String],
  explanation: String,
  metadata: Object,
});
const QuestionModel = mongoose.model("questions", QuestionMongoSchema);

type TopicGroup = "VOCAB_MATCHING" | "LISTENING_SPEAKING";

function resolveTopicGroup(questionType: string): TopicGroup {
  const qType = String(questionType || "").toUpperCase();
  if (qType === "LISTENING" || qType === "SPEAKING") {
    return "LISTENING_SPEAKING";
  }
  return "VOCAB_MATCHING";
}

async function getCandidateTopicsByGroup(
  mysqlConn: mysql.Connection,
  levelId: number,
  group: TopicGroup,
): Promise<number[]> {
  const groupNodeOrders =
    group === "VOCAB_MATCHING"
      ? [1, 4] // VOCAB, MATCHING
      : [2, 3]; // LISTENING, SPEAKING

  const [trees]: any = await mysqlConn.execute(
    `SELECT DISTINCT st.id
     FROM skill_tree st
     JOIN skill_node sn ON sn.skill_tree_id = st.id
     WHERE st.level_id = ?
       AND sn.order_index IN (?, ?)
     ORDER BY st.id`,
    [levelId, groupNodeOrders[0], groupNodeOrders[1]],
  );

  return trees.map((t: any) => t.id);
}

function buildTopicInputText(item: any): string {
  const qType = String(item.question_type || "").toUpperCase();
  const sentence = String(item.sentence || "").trim();
  const answer = String(item.answer || "").trim();

  if (qType === "VOCAB") {
    // Dữ liệu VOCAB có dạng: "What is the meaning of: <word>"
    const match = sentence.match(/what\s+is\s+the\s+meaning\s+of:\s*(.+)$/i);
    if (match?.[1]) {
      const word = match[1].trim();
      // Kết hợp từ gốc + nghĩa để tăng ngữ cảnh phân topic.
      return `${word} ${answer}`.trim();
    }
    return `${sentence} ${answer}`.trim();
  }

  if (qType === "MATCHING") {
    // MATCHING thường rất ngắn; ghép cả 2 vế để có thêm tín hiệu.
    return `${sentence} ${answer}`.trim();
  }

  return sentence;
}

function isSrvLookupError(error: unknown): boolean {
  const message = String((error as Error)?.message || "").toLowerCase();
  return (
    message.includes("querysrv") ||
    message.includes("srv") ||
    message.includes("dns")
  );
}

async function connectMongoWithFallback() {
  const srvUri = process.env.MONGODB_URI;
  const directUri = process.env.MONGODB_URI_DIRECT;

  if (!srvUri) {
    throw new Error("MONGODB_URI is missing in .env");
  }

  try {
    await mongoose.connect(srvUri);
    console.log("Connected MongoDB using MONGODB_URI (SRV)");
    return;
  } catch (error) {
    if (!isSrvLookupError(error)) {
      throw error;
    }

    if (!directUri) {
      throw new Error(
        "MongoDB SRV lookup failed and MONGODB_URI_DIRECT is missing. Add MONGODB_URI_DIRECT in .env using the non-SRV Atlas connection string.",
      );
    }

    console.warn(
      "MongoDB SRV lookup failed. Falling back to MONGODB_URI_DIRECT...",
    );
    await mongoose.connect(directUri);
    console.log("Connected MongoDB using MONGODB_URI_DIRECT");
  }
}

async function runETL() {
  try {
    // 1. Load AI classifier - Topic
    await initTopicClassifier();

    // 2. Kết nối Database
    const mysqlConn = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });

    await connectMongoWithFallback();
    console.log("Connected to MySQL & MongoDB Atlas");

    const results: any[] = [];
    // 3. Đọc file tổng hợp từ pre_process.ts
    const csvFilePath = path.resolve(__dirname, "../data/dataset_final.csv");

    if (!fs.existsSync(csvFilePath)) {
      console.error(
        "Không tìm thấy file dataset_final.csv. Hãy chạy pre-process trước!",
      );
      process.exit(1);
    }

    // 4. Đọc file csv
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on("data", (data) => results.push(data))
      .on("end", async () => {
        console.log(`Found ${results.length} questions. Starting sync...`);

        for (const item of results) {
          try {
            const sentence = item.sentence;

            // A. Xử lý MongoDB - Cái câu nào (question text) có rồi thì bỏ qua ko load nữa
            const mongoQuestion = await QuestionModel.findOneAndUpdate(
              { question_text: sentence }, // Tìm theo nội dung câu
              {
                $setOnInsert: {
                  // Chỉ insert nếu chưa có
                  question_text: sentence,
                  distractors: item.options ? item.options.split("|") : [],
                  explanation: `Type: ${item.question_type}. Level: ${item.difficulty}.`,
                  metadata: {
                    audio_url: item.audio_url || "",
                    phonetic: item.phonetic || "",
                    hint: item.hint || "",
                  },
                },
              },
              { upsert: true, new: true }, // Nếu chưa có thì tạo mới, trả về document sau khi xử lý
            );

            // B. Xử lý MySQL - Kiểm tra xem ID của MongoDB này đã được map chưa
            const [existingRows]: any = await mysqlConn.execute(
              `SELECT id FROM questions WHERE mongo_question_id = ?`,
              [mongoQuestion._id.toString()],
            );

            if (existingRows.length === 0) {
              // C. Nếu MySQL chưa có câu này -> Tiến hành INSERT mới
              const levelMapping: { [key: string]: number } = {
                easy: 1,
                medium: 2,
                hard: 3,
              };

              // D. Lấy ra level theo độ khó trong file csv
              const levelId = levelMapping[item.difficulty?.toLowerCase()] || 1;

              // E. Lấy group theo loại câu hỏi để chọn tập topic phù hợp.
              const qType = String(item.question_type || "VOCAB").toUpperCase();
              const topicGroup = resolveTopicGroup(qType);

              // F. Lấy ra danh sách topic theo level + group (vocab/matching hoặc listening/speaking).
              const candidateTopics = await getCandidateTopicsByGroup(
                mysqlConn,
                levelId,
                topicGroup,
              );

              if (candidateTopics.length === 0) {
                console.log("No topic candidates found for level/group:", {
                  levelId,
                  topicGroup,
                });
                continue;
              }

              // G. Chuẩn hóa text đầu vào cho phân loại topic theo loại câu hỏi
              const topicInputText = buildTopicInputText(item);

              // H. Phân loại theo chủ đề trên tập candidate theo group.
              const skill_tree_id = await classifyTopic(
                topicInputText,
                candidateTopics,
              );

              // I. question_type
              const normalizedQType = qType || "VOCAB";

              // J. Sau khi biết skill tree id thì sẽ map với node theo type tương ứng
              const nodeId = mapNodeId(skill_tree_id, normalizedQType);

              console.log({
                sentence,
                topicInputText,
                levelId,
                topicGroup,
                candidateTopics,
                skill_tree_id,
                nodeId,
              });

              await mysqlConn.execute(
                `INSERT INTO questions (mongo_question_id, node_id, level_id, question_type, correct_answer) 
         VALUES (?, ?, ?, ?, ?)`,
                [
                  mongoQuestion._id.toString(),
                  nodeId,
                  levelId,
                  normalizedQType,
                  item.answer,
                ],
              );

              console.log(
                `[NEW][Tree ${skill_tree_id}][Node ${nodeId}] ${sentence.substring(0, 40)}`,
              );
            } else {
              // Nếu đã có rồi -> Bỏ qua, không chèn trùng
              console.log(
                `[SKIP] Already exists in MySQL: ${item.sentence.substring(0, 30)}...`,
              );
            }
          } catch (lineError) {
            console.error("Error on line:", lineError);
          }
        }

        console.log("All data has been migrated successfully!");
        await mongoose.disconnect();
        await mysqlConn.end();
        process.exit();
      });
  } catch (error) {
    console.error("System Error:", error);
  }
}

runETL();
