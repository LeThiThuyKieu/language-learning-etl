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

    await mongoose.connect(process.env.MONGODB_URI!);
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

              // E. Lấy ra danh sách skill tree thuộc level đó
              const [trees]: any = await mysqlConn.execute(
                `SELECT id FROM skill_tree WHERE level_id = ?`,
                [levelId],
              );
              const candidateTopics = trees.map((t: any) => t.id); //danh sách topic các skill tree của level đó
              if (candidateTopics.length === 0) {
                console.log("No skill_tree found for level:", levelId);
                continue;
              }

              // F. Phân loại theo chủ đề (mỗi skill_tree là mỗi chủ đề)
              const skill_tree_id = await classifyTopic(
                sentence,
                candidateTopics,
              );

              // G. question_type
              const qType = item.question_type || "VOCAB";

              // H. Sau khi biết skill tree id thì sẽ map với node theo type tương ứng
              const nodeId = mapNodeId(skill_tree_id, qType);

              console.log({
                sentence,
                levelId,
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
                  qType,
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
