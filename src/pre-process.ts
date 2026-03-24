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

const VOCAB_DIFFICULTY_FILE = path.resolve(
  __dirname,
  "../data/json/vocab_difficulty.json",
);

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

// Kho chứa từ vựng dùng chung để làm distractors (từ gây nhiễu)
let vocabPool: string[] = [];

//Map lưu độ khó từng từ trong file vocab_raw.csv
let wordLevelMap: Map<string, string> = new Map();

// tự động xoá file dataset_final.csv để rồi tạo lại file đó mới chỉ có các dòng mới trong /raw
if (fs.existsSync(OUTPUT_FILE)) {
  fs.unlinkSync(OUTPUT_FILE);
  console.log(`Đã xóa file cũ: ${OUTPUT_FILE} để chuẩn bị tạo bản mới.`);
}

// Load vocab difficulty JSON
function loadVocabularyDifficulty() {
  const vocab = JSON.parse(fs.readFileSync(VOCAB_DIFFICULTY_FILE, "utf8"));
  for (const [word, level] of Object.entries(vocab)) {
    const clean = normalizeWord(word);
    vocabPool.push(clean);
    wordLevelMap.set(clean, level as string);
  }
  console.log(`Loaded ${vocabPool.length} vocabulary words`);
}

//Dùng cho đục lỗ
// Stopword
const stopwords = new Set([
  "is",
  "am",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "to",
  "of",
  "in",
  "on",
  "at",
]);

// POS filter helper
function isValidPOS(pos: string) {
  return (
    pos.startsWith("NN") || // noun
    pos.startsWith("VB") || // verb
    pos.startsWith("JJ") // adjective
  );
}

// clean punctuation
function normalizeWord(word: string) {
  return word.toLowerCase().replace(/[.,!?;:"()]/g, "");
}

function normalizeDifficulty(
  value: string | undefined,
): "easy" | "medium" | "hard" {
  const normalized = String(value || "").toLowerCase().trim();
  if (normalized === "easy" || normalized === "medium" || normalized === "hard") {
    return normalized;
  }
  return "medium";
}

//đục lỗ trống cho phần listening (nghe- điền khuyết)
function getRandomWordToHide(
  sentence: string,
  sentenceLevel: "easy" | "medium" | "hard",
) {
  const tokens = tagger.tagSentence(sentence); //gắn loại từ cho từng từ trong câu (trả về dạng object từ:pos(loại từ))
  const levelCandidates: string[] = [];
  const fallbackCandidates: string[] = [];

  for (const token of tokens) {
    const word = normalizeWord(token.value); //chuẩn hoá từ, xoá dấu câu
    if (!word) continue;

    //stopword
    if (stopwords.has(word)) continue;

    // POS filter
    if (!isValidPOS(token.pos)) continue;

    //CEFR
    const level =
      wordLevelMap.get(word) || wordLevelMap.get(word.replace(/s$/, ""));
    if (!level) continue;
    if (level === sentenceLevel) {
      levelCandidates.push(word);
    } else {
      fallbackCandidates.push(word);
    }
  }

  const pool =
    levelCandidates.length > 0 ? levelCandidates : fallbackCandidates;

  if (!pool.length) {
    const words = sentence
      .split(" ")
      .map(normalizeWord)
      .filter((w) => !stopwords.has(w) && w.length > 3);
    if (!words.length) return sentence.split(" ")[0];
    return words[Math.floor(Math.random() * words.length)];
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

async function processFiles() {
  loadVocabularyDifficulty();

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
          answer: row.answer,
          difficulty: row.difficulty || "easy",
          question_type: "VOCAB",
        };
        //2. Xử lý LISTENING
      } else if (file.toLowerCase().includes("listening")) {
        // Logic đục lỗ ngẫu nhiên cho bài nghe
        const difficulty = normalizeDifficulty(row.difficulty);
        const answer = getRandomWordToHide(row.transcript, difficulty);
        const hint = `${answer.length} letters`;
        // Tạo câu hỏi với dấu gạch dưới tại vị trí từ đã chọn
        const tokens = tagger.tagSentence(row.transcript);
        let replaced = false;
        const maskedSentence = tokens
          .map((t: any) => {
            const clean = normalizeWord(t.value);
            if (!replaced && clean === normalizeWord(answer)) {
              replaced = true;
              return "___";
            }
            return t.value;
          })
          .join(" ");

        processed = {
          sentence: maskedSentence,
          // Chèn đáp án đúng vào cuối danh sách options
          options: "", //phần nghe cho tự điền (ko có 4 đáp án, nhưng sẽ có hint giải đáp)
          answer: answer,
          difficulty: difficulty, //lấy độ khó từ hàm dò độ khó
          question_type: "LISTENING",
          audio_url: row.audio_url,
          phonetic: "", // Lấy link MP3 từ file CSV raw
          hint: hint,
        };
      }
      // 3. Xử lý SPEAKING
      else if (file.toLowerCase().includes("speaking")) {
        processed = {
          sentence: row.sentence,
          options: "", // Speaking thường không cần distractors
          answer: row.sentence,
          difficulty: normalizeDifficulty(row.difficulty),
          question_type: "SPEAKING",
          phonetic: row.phonetic || "", // Lưu phiên âm riêng
          audio_url: row.audio_url || "", // Lưu link audio mẫu
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
