import mysql from 'mysql2/promise';
import mongoose from 'mongoose';
import { Schema } from 'mongoose';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import csv from 'csv-parser';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ quiet: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Schema cho MongoDB - Giữ nguyên nhưng linh hoạt hơn
const QuestionMongoSchema = new Schema({
    question_text: String,
    distractors: [String],
    explanation: String,
    metadata: Object // Thêm cái này để lưu trữ các thông tin riêng biệt (như audio_url)
});
const QuestionModel = mongoose.model('questions', QuestionMongoSchema);

async function runETL() {
    try {
        // 2. Kết nối Database
        const mysqlConn = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        await mongoose.connect(process.env.MONGODB_URI!);
        console.log("Connected to MySQL & MongoDB Atlas");

        const results: any[] = [];
        // 3. Đọc file tổng hợp từ pre_process.ts
        const csvFilePath = path.resolve(__dirname, '../data/dataset_final.csv');

        if (!fs.existsSync(csvFilePath)) {
            console.error("Không tìm thấy file dataset_final.csv. Hãy chạy pre-process trước!");
            process.exit(1);
        }

        fs.createReadStream(csvFilePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', async () => {
                console.log(`Found ${results.length} questions. Starting sync...`);

                for (const item of results) {
                    try {
                        const optionsArray = item.options ? item.options.split('|') : [];

                        // A. Lưu vào MongoDB
                        const mongoQuestion = new QuestionModel({
                            question_text: item.sentence,
                            distractors: optionsArray,
                            explanation: `Type: ${item.question_type}. Level: ${item.difficulty}.`
                        });
                        const savedMongo = await mongoQuestion.save();

                        // B. Lưu vào MySQL
                        const levelMapping: { [key: string]: number } = { 'easy': 1, 'medium': 2, 'hard': 3 };
                        const levelId = levelMapping[item.difficulty?.toLowerCase()] || 1;

                        // Lấy question_type động từ file CSV 
                        const qType = item.question_type || 'VOCAB'; 

                        await mysqlConn.execute(
                            `INSERT INTO questions (mongo_question_id, node_id, level_id, question_type, correct_answer) 
                             VALUES (?, ?, ?, ?, ?)`,
                            [savedMongo._id.toString(), 1, levelId, qType, item.answer]
                        );

                        console.log(`[${qType}] Synced: ${item.sentence.substring(0, 30)}...`);
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