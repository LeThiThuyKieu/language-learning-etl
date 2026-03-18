import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import * as dotenv from "dotenv";
import csv from "csv-parser";
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

type FailedRow = {
  row_index: string;
  text: string;
  level: string;
  error: string;
};

type ProgressState = {
  inputFilePath: string;
  total: number;
  nextIndex: number;
  success: number;
  failed: number;
  updatedAt: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_FILE_PRIMARY = path.resolve(
  __dirname,
  "../data/data-listening-speaking-add.txt",
);
const INPUT_FILE_FALLBACK = path.resolve(
  __dirname,
  "../data/data-listening-speaking-add.txt",
);
const AUDIO_DIR = path.resolve(__dirname, "../audio");
const TEST_TTS_ITEMS = Number(process.env.TTS_TEST_LIMIT ?? "5");
const TTS_RESUME_ENABLED =
  String(process.env.TTS_RESUME ?? "true").toLowerCase() !== "false";
const TTS_RETRY_FAILED_ONLY =
  String(process.env.TTS_RETRY_FAILED_ONLY ?? "false").toLowerCase() === "true";
const RAW_DIR = path.resolve(__dirname, "../data/raw");

// Cloudinary Configuration
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
// Sau khi upload lên Cloudinary, có xóa file local không
const DELETE_LOCAL_AFTER_UPLOAD = true;
const RAW_LISTENING_FILE = path.resolve(RAW_DIR, "listening_tts_raw.csv");
const RAW_SPEAKING_FILE = path.resolve(RAW_DIR, "speaking_tts_raw.csv");
const FAILED_ROWS_FILE = path.resolve(RAW_DIR, "failed_rows.csv");
const PROGRESS_FILE = path.resolve(RAW_DIR, "tts_difficulty_progress.json");

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

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function appendListeningRow(row: ListeningRow): void {
  const line = [
    escapeCsv(row.transcript),
    escapeCsv(row.audio_url),
    escapeCsv(row.difficulty),
  ].join(",");
  fs.appendFileSync(RAW_LISTENING_FILE, `${line}\n`);
}

function appendSpeakingRow(row: SpeakingRow): void {
  const line = [
    escapeCsv(row.sentence),
    escapeCsv(row.phonetic),
    escapeCsv(row.audio_url),
    escapeCsv(row.difficulty),
  ].join(",");
  fs.appendFileSync(RAW_SPEAKING_FILE, `${line}\n`);
}

function appendFailedRow(
  index: number,
  item: InputItem,
  error: unknown,
): void {
  const message = (error as Error)?.message || String(error);
  const line = [
    escapeCsv(String(index + 1)),
    escapeCsv(item.text),
    escapeCsv(String(item.level)),
    escapeCsv(message),
  ].join(",");
  fs.appendFileSync(FAILED_ROWS_FILE, `${line}\n`);
}

function initFailedRowsFile(): void {
  fs.writeFileSync(FAILED_ROWS_FILE, "row_index,text,level,error\n");
}

function initRawCsvFiles(): void {
  fs.writeFileSync(RAW_LISTENING_FILE, "transcript,audio_url,difficulty\n");
  fs.writeFileSync(RAW_SPEAKING_FILE, "sentence,phonetic,audio_url,difficulty\n");
  initFailedRowsFile();
}

async function loadFailedRowsAsInput(filePath: string): Promise<InputItem[]> {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const rows: FailedRow[] = [];
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(
        csv({
          mapHeaders: ({ header }) => header.trim().replace(/^\uFEFF/, ""),
        }),
      )
      .on("data", (row) => rows.push(row as FailedRow))
      .on("end", () => resolve())
      .on("error", (err) => reject(err));
  });

  return rows
    .map((row) => ({
      text: String(row.text || "").trim(),
      level: Number(row.level),
    }))
    .filter((item) => item.text !== "" && Number.isFinite(item.level) && item.level > 0);
}

function loadProgress(
  inputFilePath: string,
  total: number,
): ProgressState | null {
  if (!TTS_RESUME_ENABLED || !fs.existsSync(PROGRESS_FILE)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(PROGRESS_FILE, "utf-8");
    const progress = JSON.parse(raw) as ProgressState;
    if (
      progress.inputFilePath === inputFilePath &&
      progress.total === total &&
      progress.nextIndex >= 0 &&
      progress.nextIndex <= total
    ) {
      return progress;
    }
  } catch {
    return null;
  }

  return null;
}

function saveProgress(progress: ProgressState): void {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), "utf-8");
}

function deleteProgress(): void {
  if (fs.existsSync(PROGRESS_FILE)) {
    fs.unlinkSync(PROGRESS_FILE);
  }
}

function getLevelFolder(level: number): "level01" | "level02" | "level03" {
  if (level <= 1) return "level01";
  if (level === 2) return "level02";
  return "level03";
}


export async function uploadToCloudinary(
  localFilePath: string,
  fileName: string,
  level: number,
): Promise<string> {
  try {
    if (!fs.existsSync(localFilePath)) {
      throw new Error(`File không tồn tại: ${localFilePath}`);
    }

    const levelFolder = getLevelFolder(level);
    const cloudinaryFolder = `audio_file/${levelFolder}`;
    const fileNameWithoutExt = fileName.replace(/\.mp3$/, "");

    const result = await cloudinary.uploader.upload(localFilePath, {
      resource_type: "video", // audio files use "video" resource type in Cloudinary
      // Put asset into Media Library folder tree in dynamic-folder mode.
      asset_folder: cloudinaryFolder,
      // Include folder in public_id so returned secure_url also contains audio_file/levelXX.
      public_id: `${cloudinaryFolder}/${fileNameWithoutExt}`,
      timeout: 60000,
    });

    if (!result.secure_url) {
      throw new Error("Cloudinary không trả về secure_url");
    }

    const url = result.secure_url;
    console.log(
      `Cloudinary saved in asset_folder=${(result as any).asset_folder ?? "(none)"}, public_id=${result.public_id}`,
    );

    if (DELETE_LOCAL_AFTER_UPLOAD) {
      fs.unlinkSync(localFilePath);
      console.log(`Xoa file local: ${path.basename(localFilePath)}`);
    }

    return url;
  } catch (error) {
    console.error("Loi upload Cloudinary:", error);
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

async function generateAllAudio(
  data: InputItem[],
  progress: ProgressState,
): Promise<AudioResult[]> {
  ensureAudioDir();
  const results: AudioResult[] = [];

  for (let index = progress.nextIndex; index < data.length; index += 1) {
    const item = data[index];
    if (!item.text || !item.level) continue;

    const fileName = generateFileName(item.level);
    const filePath = path.join(AUDIO_DIR, fileName);

    try {
      await generateAudio(item.text, filePath);
      const url = await uploadToCloudinary(filePath, fileName, item.level);
      const difficulty = mapLevelToDifficulty(item.level);
      appendListeningRow({
        transcript: item.text,
        audio_url: url,
        difficulty,
      });
      appendSpeakingRow({
        sentence: item.text,
        phonetic: generateRealIPA(item.text),
        audio_url: url,
        difficulty,
      });

      progress.success += 1;
      progress.nextIndex = index + 1;
      progress.updatedAt = new Date().toISOString();
      saveProgress(progress);

      console.log(`[${index + 1}/${data.length}] ${fileName} -> ${url}`);
      results.push({
        file: fileName,
        text: item.text,
        level: item.level,
        url,
      });
    } catch (error) {
      progress.failed += 1;
      progress.nextIndex = index + 1;
      progress.updatedAt = new Date().toISOString();
      saveProgress(progress);
      appendFailedRow(index, item, error);
      console.error(`Loi tao audio cho: ${item.text}`, error);
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

async function run() {
  const inputFilePath = getInputFilePath();
  ensureRawDir();

  const baseData = loadInputData(inputFilePath);
  const retryData = await loadFailedRowsAsInput(FAILED_ROWS_FILE);
  const allData = TTS_RETRY_FAILED_ONLY ? retryData : baseData;
  const data =
    !TTS_RETRY_FAILED_ONLY && TEST_TTS_ITEMS > 0
      ? allData.slice(0, TEST_TTS_ITEMS)
      : allData;
  const mode = TTS_RETRY_FAILED_ONLY
    ? "retry-failed"
    : TEST_TTS_ITEMS > 0
      ? "test"
      : "full";

  console.log(
    `Tong so dong hop le: ${allData.length}. Dang chay ${mode} ${data.length} dong (TTS_TEST_LIMIT=${TEST_TTS_ITEMS}).`,
  );

  if (TTS_RETRY_FAILED_ONLY && data.length === 0) {
    initFailedRowsFile();
    console.log("Khong co dong loi de retry trong failed_rows.csv.");
    return;
  }

  let progress = loadProgress(inputFilePath, data.length);
  if (progress) {
    console.log(
      `Resume tu dong ${progress.nextIndex + 1}/${progress.total} (success=${progress.success}, failed=${progress.failed}).`,
    );
  } else {
    progress = {
      inputFilePath,
      total: data.length,
      nextIndex: 0,
      success: 0,
      failed: 0,
      updatedAt: new Date().toISOString(),
    };
    if (TTS_RETRY_FAILED_ONLY) {
      initFailedRowsFile();
    } else {
      initRawCsvFiles();
    }
    saveProgress(progress);
    console.log("Khoi tao progress file.");
  }

  // Initialize Cloudinary
  console.log("Dang khoi tao Cloudinary...");
  initCloudinary();
  console.log("Cloudinary da khoi tao thanh cong\n");

  console.log(`Bat dau tao TTS tu: ${inputFilePath}`);
  const ttsResults = await generateAllAudio(data, progress);
  deleteProgress();

  console.log(`Da tao raw listening cho pre-process: ${RAW_LISTENING_FILE}`);
  console.log(`Da tao raw speaking cho pre-process: ${RAW_SPEAKING_FILE}`);
  console.log(`Da tao file dong loi: ${FAILED_ROWS_FILE}`);
  console.log(`So dong listening ghi ra: ${progress.success}`);
  console.log(`So dong speaking ghi ra: ${progress.success}`);
  console.log(`So dong loi: ${progress.failed}`);
  console.log(`Tong so cau thanh cong: ${ttsResults.length}`);
}

run().catch((error) => {
  console.error("Loi khi tao TTS difficulty CSV:", error);
  process.exit(1);
});
