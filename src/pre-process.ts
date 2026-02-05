import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import csv from "csv-parser";
import * as fastcsv from "fast-csv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Định nghĩa Interface cho dữ liệu chuẩn đầu ra
interface FinalQuestion {
  sentence: string;
  options: string;
  answer: string;
  difficulty: string;
  question_type: "VOCAB" | "LISTENING" | "SPEAKING" | "MATCHING";
}

const RAW_DIR = path.resolve(__dirname, "../data/raw");
const OUTPUT_FILE = path.resolve(__dirname, "../data/dataset_final.csv");

// Kho chứa từ vựng dùng chung để làm distractors (từ gây nhiễu)
let vocabPool: string[] = [];

// Hàm bốc 3 từ nhiễu ngẫu nhiên từ kho vocabPool
function getDistractorsFromPool(exclude: string, count: number = 3): string {
  // Lọc bỏ từ đáp án đúng để không bị trùng
  const filtered = vocabPool.filter(w => w.toLowerCase() !== exclude.toLowerCase());
  // Trộn ngẫu nhiên và lấy số lượng mong muốn
  const shuffled = filtered.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count).join('|');
}

//đục lỗ trống cho phần listening (nghe- điền khuyết)
function getRandomWordToHide(sentence: string) {
  // Tách câu thành mảng các từ và loại bỏ các ký tự đặc biệt như dấu chấm, phẩy
  const words = sentence.split(" ").map((w) => w.replace(/[.,!?;]/g, ""));

  // Lọc bỏ các từ quá ngắn (dưới 3 ký tự) để tránh đục lỗ vào "a", "is", "in"...
  const validWords = words.filter((word) => word.length > 3);

  // Nếu không tìm được từ nào thỏa mãn, lấy đại một từ bất kỳ
  const targetList = validWords.length > 0 ? validWords : words;
  const randomIndex = Math.floor(Math.random() * targetList.length);

  return targetList[randomIndex];
}

async function processFiles() {
  const allResults: FinalQuestion[] = [];
  const files = fs.readdirSync(RAW_DIR);

  // Quét trước để nạp từ vào vocabPool
  for (const file of files) {
    if (file.toLowerCase().includes("vocab")) {
      const filePath = path.join(RAW_DIR, file);
      await new Promise((resolve) => {
        fs.createReadStream(filePath)
          .pipe(csv())
          .on("data", (row) => { if (row.word) vocabPool.push(row.word); })
          .on("end", resolve);
      });
    }
  }

  for (const file of files) {
    const filePath = path.join(RAW_DIR, file);
    console.log(`Đang quét file: ${file}`);

    await new Promise((resolve) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on("data", (row) => {
          let processed: FinalQuestion | null = null;

          // Nhận diện loại bài tập dựa trên tên file
          //1. Xử lý VOCABULARY
          if (file.toLowerCase().includes("vocab")) {
            processed = {
              sentence: `What is the meaning of: ${row.word}`,
              options: `${row.distractors}|${row.definition}`,
              answer: row.definition,
              difficulty: row.difficulty || "easy",
              question_type: "VOCAB",
            };
            //2. Xử lý LISTENING
          } else if (file.toLowerCase().includes("listening")) {
            // Logic đục lỗ ngẫu nhiên cho bài nghe
            const answer = getRandomWordToHide(row.transcript);
            // Tạo câu hỏi với dấu gạch dưới tại vị trí từ đã chọn
            const regex = new RegExp(`\\b${answer}\\b`, "i");
            const maskedSentence = row.transcript.replace(regex, "___");

            processed = {
              sentence: maskedSentence,
              // Chèn đáp án đúng vào cuối danh sách options
              options: `${getDistractorsFromPool(answer, 3)}|${answer}`,
              answer: answer,
              difficulty: row.difficulty || "easy", // Lấy độ khó từ file CSV
              question_type: "LISTENING",
            };
          }
          // 3. Xử lý SPEAKING
          else if (file.toLowerCase().includes("speaking")) {
            processed = {
              sentence: row.sentence,
              options: row.phonetic || "", // Lưu phiên âm để hiển thị gợi ý
              answer: row.sentence,
              difficulty: row.difficulty || "easy",
              question_type: "SPEAKING",
            };
          }
          // 4. Xử lý MATCHING (Cặp Anh - Việt)
          else if (file.toLowerCase().includes("matching")) {
            processed = {
              sentence: row.word_en, // Vế trái: Tiếng Anh
              options: "MATCHING_PAIR", // Flag nhận diện
              answer: row.word_vi, // Vế phải: Tiếng Việt
              difficulty: row.difficulty || "easy",
              question_type: "MATCHING",
            };
          }

          if (processed) allResults.push(processed);
        })
        .on("end", () => resolve(true));
    });
  }

  // Ghi kết quả ra file tổng hợp dataset_final.csv
  const ws = fs.createWriteStream(OUTPUT_FILE);
  fastcsv.write(allResults, { headers: true }).pipe(ws);
  console.log(
    `Đã tạo file tổng hợp tại: ${OUTPUT_FILE} với ${allResults.length} câu hỏi.`,
  );
}

processFiles().catch(console.error);
