import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import csv from "csv-parser";
import * as fastcsv from "fast-csv";
// @ts-ignore
import winkPosTagger from "wink-pos-tagger";

const tagger = winkPosTagger(); //lọc và loại bỏ các loại từ ko cần thiết (liên từ, trạng từ,..)

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Định nghĩa Interface cho dữ liệu chuẩn đầu ra
interface FinalQuestion {
  sentence: string;
  options: string;
  answer: string;
  difficulty: string;
  question_type: "VOCAB" | "LISTENING" | "SPEAKING" | "MATCHING";
  audio_url?: string;
  phonetic?: string;
  hint?: string;
}

const RAW_DIR = path.resolve(__dirname, "../data/raw");
const OUTPUT_FILE = path.resolve(__dirname, "../data/dataset_final.csv");

// tự động xoá file dataset_final.csv để rồi tạo lại file đó mới chỉ có các dòng mới trong /raw
if (fs.existsSync(OUTPUT_FILE)) {
  fs.unlinkSync(OUTPUT_FILE);
  console.log(`Đã xóa file cũ: ${OUTPUT_FILE} để chuẩn bị tạo bản mới.`);
}

async function processFiles() {
  const allResults: FinalQuestion[] = [];
  const files = fs.readdirSync(RAW_DIR);
  for (const file of files) {
    const filePath = path.join(RAW_DIR, file);
    console.log(`Đang quét file: ${file}`);

    const rows: any[] = [];
    await new Promise((resolve) => {
      fs.createReadStream(filePath)
        .pipe(
          csv({
            mapHeaders: ({ header }) => header.trim().replace(/^\uFEFF/, ""),
          }),
        )
        .on("data", (row) => rows.push(row))
        .on("end", resolve);
    });

    for (const row of rows) {
      let processed: FinalQuestion | null = null;

      // Nhận diện loại bài tập dựa trên tên file
      //1. Xử lý VOCABULARY
      if (file.toLowerCase().includes("vocab")) {
        processed = {
          sentence: `${row.sentence}`,
          options: `${row.distractors}`,
          answer: `${row.answer}`,
          difficulty: `${row.difficulty}`,
          question_type: "VOCAB",
        };
        //2. Xử lý LISTENING
      } else if (file.toLowerCase().includes("listening")) {
        processed = {
          sentence: `${row.gapped_text}`,
          options: "", //phần nghe cho tự điền (ko có 4 đáp án)
          answer: `${row.answer}`,
          difficulty: `${row.difficulty}`, 
          question_type: "LISTENING",
          audio_url: `${row.audio}`
        };
      }
      // 3. Xử lý SPEAKING
      else if (file.toLowerCase().includes("speaking")) {
        processed = {
          sentence: `${row.sentences}`,
          options: "", 
          answer: "",
          difficulty: `${row.difficulty}`,
          question_type: "SPEAKING",
          audio_url: `${row.audio}` 
        };
      }
      // 4. Xử lý MATCHING (Cặp Anh - Việt)
      else if (file.toLowerCase().includes("matching")) {
        processed = {
          sentence: `${row.sentence_left}`, // Vế trái: Tiếng Anh
          options: "MATCHING_PAIR", // Flag nhận diện
          answer: `${row.sentence_right}`, // Vế phải: Tiếng Việt
          difficulty: `${row.difficulty}`,
          question_type: "MATCHING",
        };
      }

      if (processed) allResults.push(processed);
    }
  }

  // Ghi kết quả ra file tổng hợp dataset_final.csv
  const ws = fs.createWriteStream(OUTPUT_FILE);
  await new Promise((resolve) => {
    fastcsv.write(allResults, { headers: true }).pipe(ws).on("finish", resolve);
  });
  console.log(
    `Đã tạo file tổng hợp tại: ${OUTPUT_FILE} với ${allResults.length} câu hỏi.`,
  );
}

processFiles().catch(console.error);
