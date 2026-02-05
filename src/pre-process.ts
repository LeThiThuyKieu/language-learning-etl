import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import csv from 'csv-parser';
import * as fastcsv from 'fast-csv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Định nghĩa Interface cho dữ liệu chuẩn đầu ra
interface FinalQuestion {
    sentence: string;
    options: string;
    answer: string;
    difficulty: string;
    question_type: 'VOCAB' | 'LISTENING' | 'SPEAKING' | 'MATCHING';
}

const RAW_DIR = path.resolve(__dirname, '../data/raw');
const OUTPUT_FILE = path.resolve(__dirname, '../data/dataset_final.csv');

async function processFiles() {
    const allResults: FinalQuestion[] = [];
    const files = fs.readdirSync(RAW_DIR);

    for (const file of files) {
        const filePath = path.join(RAW_DIR, file);
        console.log(`Đang quét file: ${file}`);

        await new Promise((resolve) => {
            fs.createReadStream(filePath)
                .pipe(csv())
                .on('data', (row) => {
                    let processed: FinalQuestion | null = null;

                    // Nhận diện loại bài tập dựa trên tên file
                    if (file.toLowerCase().includes('vocab')) {
                        processed = {
                            sentence: `What is the meaning of: ${row.word}`,
                            options: `${row.distractors}|${row.definition}`,
                            answer: row.definition,
                            difficulty: 'easy',
                            question_type: 'VOCAB'
                        };
                    } else if (file.toLowerCase().includes('listening')) {
                        // Logic đục lỗ cho bài nghe
                        const words = row.transcript.split(' ');
                        const answer = words[words.length - 1].replace('.', '');
                        processed = {
                            sentence: row.transcript.replace(answer, "___"),
                            options: `word1|word2|word3|${answer}`,
                            answer: answer,
                            difficulty: 'medium',
                            question_type: 'LISTENING'
                        };
                    }
                    // 3. Xử lý SPEAKING (Phát âm)
                    else if (file.toLowerCase().includes('speaking')) {
                        processed = {
                            sentence: row.sentence,
                            options: row.phonetic || "", // Lưu phiên âm để hiển thị gợi ý
                            answer: row.sentence,
                            difficulty: row.difficulty || 'easy',
                            question_type: 'SPEAKING'
                        };
                    }
                    // 4. Xử lý MATCHING (Cặp Anh - Việt)
                    else if (file.toLowerCase().includes('matching')) {
                        processed = {
                            sentence: row.word_en,      // Vế trái: Tiếng Anh
                            options: "MATCHING_PAIR",   // Flag nhận diện
                            answer: row.word_vi,        // Vế phải: Tiếng Việt
                            difficulty: row.difficulty || 'easy',
                            question_type: 'MATCHING'
                        };
                    }

                    if (processed) allResults.push(processed);
                })
                .on('end', () => resolve(true));
        });
    }

    // Ghi kết quả ra file tổng hợp dataset_final.csv
    const ws = fs.createWriteStream(OUTPUT_FILE);
    fastcsv.write(allResults, { headers: true }).pipe(ws);
    console.log(`Đã tạo file tổng hợp tại: ${OUTPUT_FILE} với ${allResults.length} câu hỏi.`);
}

processFiles().catch(console.error);