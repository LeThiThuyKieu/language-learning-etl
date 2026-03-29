import fs from "fs";
import path from "path";

type Difficulty = "easy" | "medium" | "hard";
type SourceMode = "stactics" | "upstream" | "both";

type SpeakingItem = {
  id?: unknown;
  sentences?: unknown;
  audio?: unknown;
};

type MainRow = {
  sentences: string;
  audio: string;
  difficulty: Difficulty;
};

type AudioSeenRecord = {
  source_file: string;
  mode: "stactics" | "upstream";
  sentences: string;
  difficulty: Difficulty;
};

type ReviewRow = {
  source_file: string;
  mode: "stactics" | "upstream";
  reason: string;
  sentences: string;
  audio: string;
  difficulty: Difficulty;
  conflict_with_source_file: string;
  conflict_with_mode: string;
  conflict_with_sentences: string;
  conflict_with_audio: string;
  conflict_with_difficulty: string;
};

type DuplicateRow = {
  source_file: string;
  mode: "stactics" | "upstream";
  reason: string;
  sentences: string;
  audio: string;
  difficulty: Difficulty;
  conflict_with_source_file: string;
  conflict_with_mode: string;
};

type MainSeenRecord = {
  source_file: string;
  mode: "stactics" | "upstream";
};

const DEFAULT_INPUT_ROOT = path.resolve(process.cwd(), "data/src-data-speaking");
const DEFAULT_OUTPUT_CSV = path.resolve(process.cwd(), "data/archive/speaking_raw.csv");
const DEFAULT_REVIEW_CSV = path.resolve(process.cwd(), "data/archive/speaking_review.csv");
const DEFAULT_DUPLICATE_CSV = path.resolve(process.cwd(), "data/archive/speaking_duplicates.csv");

/* =========================
   UTIL FUNCTIONS
========================= */

// Escape dữ liệu để ghi CSV
function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Chuẩn hóa newline
function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

// Chuẩn hóa string để so sánh
function normalizeForCompare(value: string): string {
  return normalizeLineEndings(value)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// Chuẩn hóa audio
function normalizeAudio(value: string): string {
  return normalizeForCompare(value);
}

function isCloudinaryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname.toLowerCase().includes("cloudinary.com");
  } catch {
    return false;
  }
}

function isMp3Url(value: string): boolean {
  try {
    const url = new URL(value);
    return url.pathname.toLowerCase().endsWith(".mp3");
  } catch {
    return value.toLowerCase().split("?")[0].endsWith(".mp3");
  }
}

function validateAudio(audio: string): string | null {
  const cloudinary = isCloudinaryUrl(audio);
  const mp3 = isMp3Url(audio);

  if (!cloudinary && !mp3) return "AUDIO_NOT_CLOUDINARY_AND_NOT_MP3";
  if (!cloudinary) return "AUDIO_NOT_CLOUDINARY";
  if (!mp3) return "AUDIO_NOT_MP3";
  return null;
}

// Parse mode CLI
function parseMode(input?: string): SourceMode {
  const lower = String(input || "both").toLowerCase();
  if (["stactics", "upstream", "both"].includes(lower)) {
    return lower as SourceMode;
  }
  throw new Error(`Invalid mode: ${input}`);
}

// Map difficulty từ tên file
function mapDifficultyFromFileName(fileName: string): Difficulty {
  const lower = fileName.toLowerCase();
  if (lower.includes("basic") || lower.includes("level1")) return "easy";
  if (lower.includes("developing") || lower.includes("level2")) return "medium";
  if (lower.includes("expanding") || lower.includes("level3")) return "hard";
  return "medium";
}

// Extract sentences sạch
function extractSentencesRaw(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => normalizeLineEndings(String(v ?? "")).trim())
    .filter((s) => s.length > 0);
}

// Join sentences
function joinSentences(sentences: string[]): string {
  return normalizeLineEndings(sentences.join("\n")).trim();
}

// Mode xử lý
function getModes(mode: SourceMode): Array<"stactics" | "upstream"> {
  return mode === "both" ? ["stactics", "upstream"] : [mode];
}

// Đọc JSON an toàn
function safeReadJsonArray(filePath: string): { ok: true; data: unknown[] } | { ok: false; error: string } {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { ok: false, error: "ROOT_NOT_ARRAY" };
    return { ok: true, data: parsed as unknown[] };
  } catch (e: any) {
    return { ok: false, error: "JSON_PARSE_ERROR:" + e.message };
  }
}

// Tạo review row
function baseReviewRow(params: {
  source_file: string;
  mode: "stactics" | "upstream";
  reason: string;
  sentences: string;
  audio: string;
  difficulty: Difficulty;
}): ReviewRow {
  return {
    ...params,
    conflict_with_source_file: "",
    conflict_with_mode: "",
    conflict_with_sentences: "",
    conflict_with_audio: "",
    conflict_with_difficulty: "",
  };
}

// Ghi CSV chính
function writeMainCsv(filePath: string, rows: MainRow[]) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const content =
    "sentences,audio,difficulty\n" +
    rows.map((r) => [r.sentences, r.audio, r.difficulty].map(csvEscape).join(",")).join("\n");

  fs.writeFileSync(filePath, content, "utf8");
}

// Ghi CSV review
function writeReviewCsv(filePath: string, rows: ReviewRow[]) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const commentLines = [
    "# REVIEW_REASON_GUIDE",
    "# SOURCE_NOT_FOUND: Khong tim thay folder nguon",
    "# ROOT_NOT_ARRAY / JSON_PARSE_ERROR:*: Loi dinh dang JSON",
    "# EMPTY_SENTENCES: Khong co sentence hop le",
    "# MISSING_AUDIO: Thieu audio",
    "# AUDIO_NOT_CLOUDINARY: Audio khong phai link cloudinary",
    "# AUDIO_NOT_MP3: Audio khong co duoi .mp3",
    "# AUDIO_NOT_CLOUDINARY_AND_NOT_MP3: Audio vua khong cloudinary vua khong .mp3",
    "# AUDIO_CONFLICT: Trung audio nhung noi dung sentences khac nhau",
    "# === KHONG_CO_CAU_NAO_CAN_REVIEW ===: Khong co dong nao can review",
  ];

  const header = [
    "source_file",
    "mode",
    "reason",
    "sentences",
    "audio",
    "difficulty",
    "conflict_with_source_file",
    "conflict_with_mode",
    "conflict_with_sentences",
    "conflict_with_audio",
    "conflict_with_difficulty",
  ].join(",");
  const bodyRows =
    rows.length > 0
      ? rows.map((r) => Object.values(r).map(csvEscape).join(","))
      : [
          ["", "", "=== KHONG_CO_CAU_NAO_CAN_REVIEW ===", "", "", "medium", "", "", "", "", ""]
            .map(csvEscape)
            .join(","),
        ];
  const body = bodyRows.join("\n");
  const comment = commentLines.join("\n");
  const content = `${comment}\n${header}\n${body}\n`;

  fs.writeFileSync(filePath, content, "utf8");
}

function writeDuplicateCsv(filePath: string, rows: DuplicateRow[]) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const commentLines = [
    "# DUPLICATE_GUIDE",
    "# EXACT_DUPLICATE_ROW: Dong bi bo qua do trung hoan toan key dedupe",
    "# === KHONG_CO_DONG_TRUNG ===: Khong co dong duplicate",
  ];

  const header = [
    "source_file",
    "mode",
    "reason",
    "sentences",
    "audio",
    "difficulty",
    "conflict_with_source_file",
    "conflict_with_mode",
  ].join(",");

  const bodyRows =
    rows.length > 0
      ? rows.map((row) =>
          [
            row.source_file,
            row.mode,
            row.reason,
            row.sentences,
            row.audio,
            row.difficulty,
            row.conflict_with_source_file,
            row.conflict_with_mode,
          ]
            .map(csvEscape)
            .join(","),
        )
      : [["", "", "=== KHONG_CO_DONG_TRUNG ===", "", "", "medium", "", ""].map(csvEscape).join(",")];

  const content = `${commentLines.join("\n")}\n${header}\n${bodyRows.join("\n")}\n`;
  fs.writeFileSync(filePath, content, "utf8");
}

/* =========================
   MAIN PROCESS
========================= */

function main() {
  const mode = parseMode(process.argv[2]);
  const inputRoot = process.argv[3] || DEFAULT_INPUT_ROOT;
  const outputCsv = process.argv[4] || DEFAULT_OUTPUT_CSV;
  const reviewCsv = process.argv[5] || DEFAULT_REVIEW_CSV;
  const duplicateCsv = process.argv[6] || DEFAULT_DUPLICATE_CSV;

  const modes = getModes(mode);

  const mainRows: MainRow[] = [];
  const reviewRows: ReviewRow[] = [];
  const duplicateRows: DuplicateRow[] = [];

  const seen = new Map<string, MainSeenRecord>();
  const audioMap = new Map<string, AudioSeenRecord>();
  const conflictSet = new Set<string>();

  for (const m of modes) {
    const dir = path.join(inputRoot, m);

    if (!fs.existsSync(dir)) {
      reviewRows.push(
        baseReviewRow({
          source_file: dir,
          mode: m,
          reason: "SOURCE_NOT_FOUND",
          sentences: "",
          audio: "",
          difficulty: "medium",
        }),
      );
      continue;
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      const difficulty = mapDifficultyFromFileName(file);
      const filePath = path.join(dir, file);

      const data = safeReadJsonArray(filePath);
      if (!data.ok) {
        reviewRows.push(
          baseReviewRow({
            source_file: file,
            mode: m,
            reason: data.error,
            sentences: "",
            audio: "",
            difficulty,
          }),
        );
        continue;
      }

      data.data.forEach((raw, idx) => {
        const tag = `${file}#${idx + 1}`;

        const item = raw as SpeakingItem;
        const sentencesArr = extractSentencesRaw(item.sentences);
        const joined = joinSentences(sentencesArr);
        const normalized = normalizeForCompare(joined);

        const audio = normalizeAudio(String(item.audio ?? ""));

        if (sentencesArr.length === 0) {
          reviewRows.push(
            baseReviewRow({
              source_file: tag,
              mode: m,
              reason: "EMPTY_SENTENCES",
              sentences: joined,
              audio,
              difficulty,
            }),
          );
          return;
        }

        if (!audio) {
          reviewRows.push(
            baseReviewRow({
              source_file: tag,
              mode: m,
              reason: "MISSING_AUDIO",
              sentences: joined,
              audio,
              difficulty,
            }),
          );
          return;
        }

        const audioError = validateAudio(audio);
        if (audioError) {
          reviewRows.push(
            baseReviewRow({
              source_file: tag,
              mode: m,
              reason: audioError,
              sentences: joined,
              audio,
              difficulty,
            }),
          );
          return;
        }

        // check conflict audio
        const existed = audioMap.get(audio);
        if (existed && existed.sentences !== normalized) {
          const key = [existed.source_file, tag].sort().join("|");
          if (!conflictSet.has(key)) {
            conflictSet.add(key);

            reviewRows.push({
              source_file: tag,
              mode: m,
              reason: "AUDIO_CONFLICT",
              sentences: joined,
              audio,
              difficulty,
              conflict_with_source_file: existed.source_file,
              conflict_with_mode: existed.mode,
              conflict_with_sentences: existed.sentences,
              conflict_with_audio: audio,
              conflict_with_difficulty: existed.difficulty,
            });
          }
          return;
        }

        if (!existed) {
          audioMap.set(audio, {
            source_file: tag,
            mode: m,
            sentences: normalized,
            difficulty,
          });
        }

        const key = `${normalized}|${audio}|${difficulty}`;
        const firstSeen = seen.get(key);
        if (firstSeen) {
          duplicateRows.push({
            source_file: tag,
            mode: m,
            reason: "EXACT_DUPLICATE_ROW",
            sentences: joined,
            audio,
            difficulty,
            conflict_with_source_file: firstSeen.source_file,
            conflict_with_mode: firstSeen.mode,
          });
          return;
        }
        seen.set(key, { source_file: tag, mode: m });

        mainRows.push({ sentences: joined, audio, difficulty });
      });
    }
  }

  writeMainCsv(outputCsv, mainRows);
  writeReviewCsv(reviewCsv, reviewRows);
  writeDuplicateCsv(duplicateCsv, duplicateRows);

  console.log("DONE");
  console.log("Main:", mainRows.length);
  console.log("Review:", reviewRows.length);
  console.log("Duplicate:", duplicateRows.length);
}

main();