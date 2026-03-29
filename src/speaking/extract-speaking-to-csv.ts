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

const DEFAULT_INPUT_ROOT = path.resolve(process.cwd(), "data/src-data-speaking");
const DEFAULT_OUTPUT_CSV = path.resolve(process.cwd(), "data/archive/speaking_raw.csv");
const DEFAULT_REVIEW_CSV = path.resolve(process.cwd(), "data/archive/speaking_review.csv");

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

// Lấy số thứ tự đầu câu
function parseLeadingNumber(sentence: string): number | null {
  const match = sentence.match(/^\s*(\d+)\s*([.)-]|\s)/);
  return match ? Number(match[1]) : null;
}

// Validate numbering
function validateSentenceNumbering(sentences: string[]): { ok: boolean; reason?: string } {
  if (sentences.length === 0) return { ok: false, reason: "EMPTY_SENTENCES" };

  for (let i = 0; i < sentences.length; i++) {
    const num = parseLeadingNumber(sentences[i]);
    if (num === null) return { ok: false, reason: "MISSING_NUMBER_PREFIX" };
    if (num !== i + 1) {
      return { ok: false, reason: `NON_SEQUENTIAL(expected:${i + 1},actual:${num})` };
    }
  }

  return { ok: true };
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
function safeReadJsonArray(filePath: string) {
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

  const header = Object.keys(rows[0] || {}).join(",");
  const body = rows.map((r) => Object.values(r).map(csvEscape).join(",")).join("\n");

  fs.writeFileSync(filePath, header + "\n" + body, "utf8");
}

/* =========================
   MAIN PROCESS
========================= */

function main() {
  const mode = parseMode(process.argv[2]);
  const inputRoot = process.argv[3] || DEFAULT_INPUT_ROOT;
  const outputCsv = process.argv[4] || DEFAULT_OUTPUT_CSV;
  const reviewCsv = process.argv[5] || DEFAULT_REVIEW_CSV;

  const modes = getModes(mode);

  const mainRows: MainRow[] = [];
  const reviewRows: ReviewRow[] = [];

  const seen = new Set<string>();
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

        const valid = validateSentenceNumbering(sentencesArr);
        if (!valid.ok) {
          reviewRows.push(
            baseReviewRow({
              source_file: tag,
              mode: m,
              reason: valid.reason!,
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
        if (seen.has(key)) return;
        seen.add(key);

        mainRows.push({ sentences: joined, audio, difficulty });
      });
    }
  }

  writeMainCsv(outputCsv, mainRows);
  writeReviewCsv(reviewCsv, reviewRows);

  console.log("DONE");
  console.log("Main:", mainRows.length);
  console.log("Review:", reviewRows.length);
}

main();