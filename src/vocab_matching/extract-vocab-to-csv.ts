import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

type OutputDifficulty = "easy" | "medium" | "hard";
type SourceMode = "destination" | "upstream" | "both";
type SourceFolder = "destination" | "upstream";

type InputFile = {
  mode: SourceFolder;
  filePath: string;
  fileName: string;
};

type VocabQuestion = {
  question: string;
  options: unknown;
  answer: string;
};

type MainRow = {
  sentence: string;
  answer: string;
  distractors: string;
  difficulty: OutputDifficulty;
};

type ReviewRow = {
  source_file: string;
  sentence: string;
  answer: string;
  options: string;
  difficulty: OutputDifficulty;
  reason: string;
};

type DuplicateRow = {
  source_file: string;
  sentence: string;
  answer: string;
  difficulty: OutputDifficulty;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_INPUT_ROOT = path.resolve(__dirname, "../../data/src-data-vocab");
const DESTINATION_DIR = path.join(DEFAULT_INPUT_ROOT, "destination");
const UPSTREAM_DIR = path.join(DEFAULT_INPUT_ROOT, "upstream");
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, "../../data/archive");
const DEFAULT_OUTPUT_CSV = path.resolve(DEFAULT_OUTPUT_DIR, "vocab_raw.csv");
const DEFAULT_REVIEW_CSV = path.resolve(DEFAULT_OUTPUT_DIR, "vocab_review.csv");
const DEFAULT_DUPLICATE_CSV = path.resolve(DEFAULT_OUTPUT_DIR, "vocab_duplicates.csv");

const ALLOWED_SOURCE_MODES: SourceMode[] = ["destination", "upstream", "both"];

function mapDifficultyFromName(fileName: string): OutputDifficulty {
  const lower = fileName.toLowerCase();
  if (lower.includes("b1") || lower.includes("level1")) return "easy";
  if (lower.includes("b2") || lower.includes("level2")) return "medium";
  if (lower.includes("c1") || lower.includes("c2") || lower.includes("level3")) return "hard";
  return "medium";
}

function normalizeSpace(value: string): string {
  return (value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\t\r\n\f]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function parseQuestions(jsonPath: string): VocabQuestion[] {
  const raw = fs.readFileSync(jsonPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];

  const out: VocabQuestion[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;

    const question = normalizeSpace(String(obj.question || ""));
    const answer = normalizeSpace(String(obj.answer || ""));
    const options = obj.options;

    if (!question) continue;
    out.push({ question, answer, options });
  }

  return out;
}

function resolveCli(): {
  sourceMode: SourceMode;
  inputRoot: string;
  outputCsv: string;
  reviewCsv: string;
  duplicateCsv: string;
} {
  const arg1 = process.argv[2];
  const normalizedArg1 = String(arg1 || "").trim().toLowerCase();

  // Backward compatible:
  // - If argv[2] is mode -> [mode] [inputRoot] [output] [review] [duplicate]
  // - Otherwise argv[2] is inputRoot -> [inputRoot] [output] [review] [duplicate]
  const isModeArg = ALLOWED_SOURCE_MODES.includes(normalizedArg1 as SourceMode);
  const sourceMode: SourceMode = isModeArg ? (normalizedArg1 as SourceMode) : "both";

  const inputRoot = isModeArg
    ? process.argv[3]
      ? path.resolve(process.argv[3])
      : DEFAULT_INPUT_ROOT
    : process.argv[2]
      ? path.resolve(process.argv[2])
      : DEFAULT_INPUT_ROOT;

  const outputCsv = isModeArg
    ? process.argv[4]
      ? path.resolve(process.argv[4])
      : DEFAULT_OUTPUT_CSV
    : process.argv[3]
      ? path.resolve(process.argv[3])
      : DEFAULT_OUTPUT_CSV;

  const reviewCsv = isModeArg
    ? process.argv[5]
      ? path.resolve(process.argv[5])
      : DEFAULT_REVIEW_CSV
    : process.argv[4]
      ? path.resolve(process.argv[4])
      : DEFAULT_REVIEW_CSV;

  const duplicateCsv = isModeArg
    ? process.argv[6]
      ? path.resolve(process.argv[6])
      : DEFAULT_DUPLICATE_CSV
    : process.argv[5]
      ? path.resolve(process.argv[5])
      : DEFAULT_DUPLICATE_CSV;

  return { sourceMode, inputRoot, outputCsv, reviewCsv, duplicateCsv };
}

function getSelectedSources(sourceMode: SourceMode, inputRoot: string): Array<{ mode: SourceFolder; dir: string }> {
  const destinationDir = path.join(inputRoot, "destination");
  const upstreamDir = path.join(inputRoot, "upstream");

  if (sourceMode === "destination") return [{ mode: "destination", dir: destinationDir }];
  if (sourceMode === "upstream") return [{ mode: "upstream", dir: upstreamDir }];
  return [
    { mode: "destination", dir: destinationDir },
    { mode: "upstream", dir: upstreamDir },
  ];
}

function collectInputFiles(sourceMode: SourceMode, inputRoot: string): InputFile[] {
  const files: InputFile[] = [];
  const sources = getSelectedSources(sourceMode, inputRoot);

  for (const source of sources) {
    if (!fs.existsSync(source.dir)) {
      console.warn(`Skip missing folder: ${source.dir}`);
      continue;
    }

    const jsonFiles = fs
      .readdirSync(source.dir)
      .filter((x) => x.toLowerCase().endsWith(".json"))
      .sort((a, b) => a.localeCompare(b));

    for (const fileName of jsonFiles) {
      files.push({
        mode: source.mode,
        filePath: path.join(source.dir, fileName),
        fileName,
      });
    }
  }

  return files;
}

function extractOptions(options: unknown): string[] {
  if (Array.isArray(options)) {
    return options
      .map((item) => normalizeSpace(String(item || "")))
      .filter((item) => item.length > 0);
  }

  if (options && typeof options === "object") {
    return Object.values(options as Record<string, unknown>)
      .map((item) => normalizeSpace(String(item || "")))
      .filter((item) => item.length > 0);
  }

  return [];
}

function summarizeByDifficulty(
  rows: Array<{ difficulty: OutputDifficulty }>,
): Record<OutputDifficulty, number> {
  const summary: Record<OutputDifficulty, number> = {
    easy: 0,
    medium: 0,
    hard: 0,
  };

  for (const row of rows) {
    summary[row.difficulty] += 1;
  }

  return summary;
}

function buildReviewCommentLines(): string[] {
  return [
    "# REVIEW_REASON_GUIDE",
    "# MISSING_OPTIONS: Cau hoi khong co options hop le",
    "# ANSWER_NOT_IN_OPTIONS: Dap an khong nam trong danh sach options",
    "# === KHONG_CO_CAU_NAO_CAN_REVIEW ===: Khong co dong nao can review",
  ];
}

function buildDuplicateCommentLines(): string[] {
  return [
    "# DUPLICATE_GUIDE",
    "# Ghi lai cac dong bi loai do trung sentence",
    "# === KHONG_CO_DONG_TRUNG ===: Khong co dong duplicate",
  ];
}

function run(): Promise<void> {
  return (async () => {
    const { sourceMode, inputRoot, outputCsv, reviewCsv, duplicateCsv } = resolveCli();

    if (!fs.existsSync(inputRoot)) {
      throw new Error(`JSON input root not found: ${inputRoot}`);
    }

    fs.mkdirSync(path.dirname(outputCsv), { recursive: true });
    fs.mkdirSync(path.dirname(reviewCsv), { recursive: true });
    fs.mkdirSync(path.dirname(duplicateCsv), { recursive: true });

    const inputFiles = collectInputFiles(sourceMode, inputRoot);

    if (inputFiles.length === 0) {
      throw new Error(`No JSON files found for mode='${sourceMode}' in root: ${inputRoot}`);
    }

    const mainRows: MainRow[] = [];
    const reviewRows: ReviewRow[] = [];
    const duplicateRows: DuplicateRow[] = [];
    const seenSentenceKeys = new Set<string>();

    for (const inputFile of inputFiles) {
      const difficulty = mapDifficultyFromName(inputFile.fileName);
      const sourceFileTag = `${inputFile.mode}/${inputFile.fileName}`;

      console.log(`Processing ${sourceFileTag} (${difficulty})`);

      const questions = parseQuestions(inputFile.filePath);

      for (const q of questions) {
        const sentence = normalizeSpace(q.question);
        const answer = normalizeSpace(q.answer);
        const options = extractOptions(q.options);

        if (options.length === 0) {
          reviewRows.push({
            source_file: sourceFileTag,
            sentence,
            answer,
            options: "",
            difficulty,
            reason: "MISSING_OPTIONS",
          });
          continue;
        }

        if (!options.includes(answer)) {
          reviewRows.push({
            source_file: sourceFileTag,
            sentence,
            answer,
            options: options.join("|"),
            difficulty,
            reason: "ANSWER_NOT_IN_OPTIONS",
          });
          continue;
        }

        const sentenceKey = sentence.toLowerCase();
        if (seenSentenceKeys.has(sentenceKey)) {
          duplicateRows.push({
            source_file: sourceFileTag,
            sentence,
            answer,
            difficulty,
          });
          continue;
        }
        seenSentenceKeys.add(sentenceKey);

        mainRows.push({
          sentence,
          answer,
          distractors: options.join("|"),
          difficulty,
        });
      }
    }

    const mainHeader = "sentence,answer,distractors,difficulty";
    const mainBody = mainRows
      .map((r) => [r.sentence, r.answer, r.distractors, r.difficulty].map(csvEscape).join(","))
      .join("\n");
    fs.writeFileSync(outputCsv, `${mainHeader}\n${mainBody}\n`, "utf8");

    const reviewHeader = [
      "source_file",
      "sentence",
      "answer",
      "options",
      "difficulty",
      "reason",
    ].join(",");
    const reviewComment = buildReviewCommentLines().join("\n");
    const reviewBodyRows =
      reviewRows.length > 0
        ? reviewRows.map((r) => {
            return [
              r.source_file,
              r.sentence,
              r.answer,
              r.options,
              r.difficulty,
              r.reason,
            ]
              .map(csvEscape)
              .join(",");
          })
        : [["", "", "", "", "medium", "=== KHONG_CO_CAU_NAO_CAN_REVIEW ==="].map(csvEscape).join(",")];

    const reviewBody = reviewBodyRows.join("\n");
    const reviewContent = reviewBody
      ? `${reviewComment}\n${reviewHeader}\n${reviewBody}\n`
      : `${reviewComment}\n${reviewHeader}\n`;
    fs.writeFileSync(reviewCsv, reviewContent, "utf8");

    const duplicateHeader = ["source_file", "sentence", "answer", "difficulty"].join(",");
    const duplicateComment = buildDuplicateCommentLines().join("\n");
    const duplicateBodyRows =
      duplicateRows.length > 0
        ? duplicateRows.map((r) => {
            return [r.source_file, r.sentence, r.answer, r.difficulty].map(csvEscape).join(",");
          })
        : [["", "=== KHONG_CO_DONG_TRUNG ===", "", "medium"].map(csvEscape).join(",")];
    const duplicateBody = duplicateBodyRows.join("\n");
    fs.writeFileSync(duplicateCsv, `${duplicateComment}\n${duplicateHeader}\n${duplicateBody}\n`, "utf8");

    console.log(`Done. mode=${sourceMode}`);
    console.log(`Done. main_rows=${mainRows.length} -> ${outputCsv}`);
    console.log(`Done. review_rows=${reviewRows.length} -> ${reviewCsv}`);
    console.log(`Done. duplicate_rows=${duplicateRows.length} -> ${duplicateCsv}`);

    const mainByDifficulty = summarizeByDifficulty(mainRows);
    const reviewByDifficulty = summarizeByDifficulty(reviewRows);
    const duplicateByDifficulty = summarizeByDifficulty(duplicateRows);

    console.log(
      `Stats main_by_difficulty: easy=${mainByDifficulty.easy}, medium=${mainByDifficulty.medium}, hard=${mainByDifficulty.hard}`,
    );
    console.log(
      `Stats review_by_difficulty: easy=${reviewByDifficulty.easy}, medium=${reviewByDifficulty.medium}, hard=${reviewByDifficulty.hard}`,
    );
    console.log(
      `Stats duplicate_by_difficulty: easy=${duplicateByDifficulty.easy}, medium=${duplicateByDifficulty.medium}, hard=${duplicateByDifficulty.hard}`,
    );
  })();
}

run().catch((error) => {
  console.error("Failed:", error);
  process.exit(1);
});
