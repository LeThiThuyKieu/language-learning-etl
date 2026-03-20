import mysql from "mysql2/promise";
import mongoose from "mongoose";
import { Schema } from "mongoose";
import * as dotenv from "dotenv";
import * as fs from "fs";
import csv from "csv-parser";
import path from "path";
import { fileURLToPath } from "url";

// Import hàm mới từ node-mapper.ts
import { getNodeId, getLevelNodeMap } from "./node-mapper.ts";
import {
  getTreesByLevel,
  distributeByTree
} from "./tree-distributor.ts";

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

function normalizeDifficulty(value: string | undefined): "easy" | "medium" | "hard" {
  const normalized = String(value || "").toLowerCase().trim();
  if (normalized === "easy" || normalized === "medium" || normalized === "hard") {
    return normalized;
  }
  return "medium";
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
    // 1. Kết nối Database
    const mysqlConn = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });

    // 2. Kết nối MongoDB với cơ chế fallback nếu SRV lookup gặp lỗi
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
        console.log(`Found ${results.length} questions.`);

        const normalizedResults = results.map((q) => ({
          ...q,
          difficulty: normalizeDifficulty(q.difficulty),
        }));

        //đếm số câu theo từng độ khó
        const easyQuestions = normalizedResults.filter(
          (q) => q.difficulty?.toLowerCase() === "easy",
        );
        const mediumQuestions = normalizedResults.filter(
          (q) => q.difficulty?.toLowerCase() === "medium",
        );
        const hardQuestions = normalizedResults.filter(
          (q) => q.difficulty?.toLowerCase() === "hard",
        );

        console.log("easy:", easyQuestions.length);
        console.log("medium:", mediumQuestions.length);
        console.log("hard:", hardQuestions.length);

        // lấy tree
        const easyTrees = await getTreesByLevel(mysqlConn, 1);
        const mediumTrees = await getTreesByLevel(mysqlConn, 2);
        const hardTrees = await getTreesByLevel(mysqlConn, 3);

        // chia đều
        const easyMap = distributeByTree(easyQuestions, easyTrees);
        const mediumMap = distributeByTree(mediumQuestions, mediumTrees);
        const hardMap = distributeByTree(hardQuestions, hardTrees);

        async function processQuestions(
          treeId: number,
          levelId: number,
          questions: any[],
          nodeMap: Record<string, number> // Thêm tham số nodeMap để lấy ID chính xác
        ) {
          if (!questions || questions.length === 0) return;
          for (const item of questions) {
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

              // Nếu đã tồn tại thì skip, nếu chưa thì insert mới với node_id tương ứng
              if (existingRows.length > 0) {
                console.log(`[SKIP] ${sentence.substring(0, 40)}`);
                continue;
              }

              // question type để map node_id
              const qType = String(item.question_type || "VOCAB").toUpperCase();
              
              // CẬP NHẬT: map node_id dựa trên treeId và question type (Ưu tiên lấy từ Map database)
              const nodeId = getNodeId(treeId, qType, nodeMap);

              // Insert vào MySQL
              await mysqlConn.execute(
                `INSERT INTO questions 
                (mongo_question_id, node_id, level_id, question_type, correct_answer) 
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
                `[NEW][Tree ${treeId}][Node ${nodeId}] ${sentence.substring(0, 40)}`,
              );
            } catch (lineError) {
              console.error("Error on line:", lineError);
            }
          }
        }

        // easy
        console.log("Processing Level 1 (Easy)...");
        const nodeMapL1 = await getLevelNodeMap(mysqlConn, 1); // Lấy bản đồ Node của Level 1
        for (const treeId of easyTrees) {
          const questions = easyMap[treeId];
          await processQuestions(treeId, 1, questions, nodeMapL1);
        }

        // medium
        console.log("Processing Level 2 (Medium)...");
        const nodeMapL2 = await getLevelNodeMap(mysqlConn, 2); // Lấy bản đồ Node của Level 2
        for (const treeId of mediumTrees) {
          const questions = mediumMap[treeId];
          await processQuestions(treeId, 2, questions, nodeMapL2);
        }

        // hard
        console.log("Processing Level 3 (Hard)...");
        const nodeMapL3 = await getLevelNodeMap(mysqlConn, 3); // Lấy bản đồ Node của Level 3
        for (const treeId of hardTrees) {
          const questions = hardMap[treeId];
          await processQuestions(treeId, 3, questions, nodeMapL3);
        }

        console.log("Dữ liệu đã được xử lý xong và lưu vào MongoDB & MySQL!");
        await mongoose.disconnect();
        await mysqlConn.end();
        process.exit();
      });
  } catch (error) {
    console.error("System Error:", error);
  }
}

runETL();