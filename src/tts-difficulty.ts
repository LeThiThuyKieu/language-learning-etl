import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as fastcsv from "fast-csv";
import crypto from "crypto";
import * as dotenv from "dotenv";
// @ts-ignore
import gTTS from "gtts";
import { v2 as cloudinary } from "cloudinary";
import { generateRealIPA } from "./utils/phonetic-helper.ts";

dotenv.config({ quiet: true } as any);

type ListeningRow = {
  transcript: string;
  audio_url: string;
  difficulty: "easy" | "medium" | "hard";
};

type SpeakingRow = {
  sentence: string;
  phonetic: string;
  audio_url: string;
  difficulty: "easy" | "medium" | "hard";
};

type InputItem = {
  text: string;
  level: number;
};

type AudioResult = {
  file: string;
  text: string;
  level: number;
  url: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_FILE_PRIMARY = path.resolve(
  __dirname,
  "../data/data-speaking-listening.txt",
);
const INPUT_FILE_FALLBACK = path.resolve(
  __dirname,
  "../data/data-listening-speaking.txt",
);
const AUDIO_DIR = path.resolve(__dirname, "../audio");
// const MAX_TTS_ITEMS = 5;
const RAW_DIR = path.resolve(__dirname, "../data/raw");

// Cloudinary Configuration
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
// Sau khi upload lên Cloudinary, có xóa file local không
const DELETE_LOCAL_AFTER_UPLOAD = true;
const RAW_LISTENING_FILE = path.resolve(RAW_DIR, "listening_tts_raw.csv");
const RAW_SPEAKING_FILE = path.resolve(RAW_DIR, "speaking_tts_raw.csv");

function initCloudinary() {
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error(
      "Thiếu biến môi trường: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET phải được khai báo trong .env"
    );
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
  });
}

function ensureRawDir() {
  if (!fs.existsSync(RAW_DIR)) {
    fs.mkdirSync(RAW_DIR, { recursive: true });
  }
}

function ensureAudioDir() {
  if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
  }
}

function loadInputData(filePath: string): InputItem[] {
  const raw = fs.readFileSync(filePath, "utf-8");

  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  return lines
    .map((line) => {
      const match = line.match(/(.+?)\s+(\d+)$/);
      if (!match) {
        console.warn(`Bo qua dong sai format: ${line}`);
        return null;
      }

      return {
        text: match[1].trim().replace(/\s+/g, " "),
        level: Number(match[2]),
      };
    })
    .filter((item): item is InputItem => item !== null);
}

function generateFileName(level: number): string {
  const levelStr = String(level).padStart(2, "0");
  const uuid = crypto.randomUUID().slice(0, 10);
  return `${levelStr}_${uuid}.mp3`;
}


export async function uploadToCloudinary(
  localFilePath: string,
  fileName: string
): Promise<string> {
  try {
    if (!fs.existsSync(localFilePath)) {
      throw new Error(`File không tồn tại: ${localFilePath}`);
    }

    const result = await cloudinary.uploader.upload(localFilePath, {
      resource_type: "video", // audio files use "video" resource type in Cloudinary
      public_id: `audio/${fileName.replace(/\.mp3$/, "")}`,
      timeout: 60000,
    });

    if (!result.secure_url) {
      throw new Error("Cloudinary không trả về secure_url");
    }

    const url = result.secure_url;

    if (DELETE_LOCAL_AFTER_UPLOAD) {
      fs.unlinkSync(localFilePath);
      console.log(`  ✓ Xoa file local: ${path.basename(localFilePath)}`);
    }

    return url;
  } catch (error) {
    console.error("❌ Loi upload Cloudinary:", error);
    throw error;
  }
}

function generateAudio(text: string, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tts = new gTTS(text, "en");
    tts.save(filePath, (err: unknown) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function generateAllAudio(inputFilePath: string): Promise<AudioResult[]> {
  ensureAudioDir();
//   const data = loadInputData(inputFilePath).slice(0, MAX_TTS_ITEMS);
  const data = loadInputData(inputFilePath);
  const results: AudioResult[] = [];

  for (const item of data) {
    if (!item.text || !item.level) continue;

    const fileName = generateFileName(item.level);
    const filePath = path.join(AUDIO_DIR, fileName);

    try {
      await generateAudio(item.text, filePath);
      const url = await uploadToCloudinary(filePath, fileName);
      console.log(`  ✓ [${results.length + 1}/${data.length}] ${fileName} -> ${url}`);
      results.push({
        file: fileName,
        text: item.text,
        level: item.level,
        url,
      });
    } catch (error) {
      console.error(`  ❌ Loi tao audio cho: ${item.text}`, error);
    }
  }

  return results;
}

function mapLevelToDifficulty(level: number): "easy" | "medium" | "hard" {
  if (level <= 1) return "easy";
  if (level === 2) return "medium";
  return "hard";
}

function getInputFilePath(): string {
  if (fs.existsSync(INPUT_FILE_PRIMARY)) {
    return INPUT_FILE_PRIMARY;
  }

  if (fs.existsSync(INPUT_FILE_FALLBACK)) {
    console.warn(
      `Khong tim thay ${INPUT_FILE_PRIMARY}, dung fallback ${INPUT_FILE_FALLBACK}.`,
    );
    return INPUT_FILE_FALLBACK;
  }

  throw new Error(
    `Khong tim thay input file. Can mot trong hai file: ${INPUT_FILE_PRIMARY} hoac ${INPUT_FILE_FALLBACK}`,
  );
}

async function writeListeningCsv(rows: ListeningRow[], filePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    fastcsv
      .write(rows, { headers: true })
      .pipe(fs.createWriteStream(filePath))
      .on("finish", () => resolve())
      .on("error", (err) => reject(err));
  });
}

async function writeSpeakingCsv(rows: SpeakingRow[], filePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    fastcsv
      .write(rows, { headers: true })
      .pipe(fs.createWriteStream(filePath))
      .on("finish", () => resolve())
      .on("error", (err) => reject(err));
  });
}

async function run() {
  const inputFilePath = getInputFilePath();
  ensureRawDir();

  // Initialize Cloudinary
  console.log("🔧 Dang khoi tao Cloudinary...");
  initCloudinary();
  console.log("✓ Cloudinary da khoi tao thanh cong\n");

  console.log(`📝 Bat dau tao TTS tu: ${inputFilePath}`);
  const ttsResults = await generateAllAudio(inputFilePath);

  const listeningRows: ListeningRow[] = ttsResults.map((item) => ({
    transcript: item.text,
    audio_url: item.url,
    difficulty: mapLevelToDifficulty(item.level),
  }));

  const speakingRows: SpeakingRow[] = ttsResults.map((item) => ({
    sentence: item.text,
    phonetic: generateRealIPA(item.text),
    audio_url: item.url,
    difficulty: mapLevelToDifficulty(item.level),
  }));

  await writeListeningCsv(listeningRows, RAW_LISTENING_FILE);
  await writeSpeakingCsv(speakingRows, RAW_SPEAKING_FILE);

  console.log(`\n✓ Da tao raw listening cho pre-process: ${RAW_LISTENING_FILE}`);
  console.log(`✓ Da tao raw speaking cho pre-process: ${RAW_SPEAKING_FILE}`);
  console.log(`📊 Tong so cau: ${ttsResults.length}`);
}

run().catch((error) => {
  console.error("❌ Loi khi tao TTS difficulty CSV:", error);
  process.exit(1);
});
