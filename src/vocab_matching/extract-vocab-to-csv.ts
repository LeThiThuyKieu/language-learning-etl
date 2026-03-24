import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

type OutputDifficulty = "easy" | "medium" | "hard";

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

const DEFAULT_INPUT_JSON_DIR = path.resolve(__dirname, "../../data/destination_text_vocab");
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, "../../data/archive");
const DEFAULT_OUTPUT_CSV = path.resolve(DEFAULT_OUTPUT_DIR, "vocab_raw_from_destination.csv");
const DEFAULT_REVIEW_CSV = path.resolve(
  DEFAULT_OUTPUT_DIR,
  "vocab_raw_from_destination_review.csv",
);
const DEFAULT_DUPLICATE_CSV = path.resolve(
  DEFAULT_OUTPUT_DIR,
  "vocab_raw_from_destination_duplicates.csv",
);

function mapDifficultyFromName(fileName: string): OutputDifficulty {
  const lower = fileName.toLowerCase();
  if (lower.includes("b1")) return "easy";
  if (lower.includes("b2")) return "medium";
  if (lower.includes("c1") || lower.includes("c2")) return "hard";
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

function run(): Promise<void> {
  return (async () => {
    const inputJsonDir = process.argv[2]
      ? path.resolve(process.argv[2])
      : DEFAULT_INPUT_JSON_DIR;
    const outputCsv = process.argv[3]
      ? path.resolve(process.argv[3])
      : DEFAULT_OUTPUT_CSV;
    const reviewCsv = process.argv[4]
      ? path.resolve(process.argv[4])
      : DEFAULT_REVIEW_CSV;
    const duplicateCsv = process.argv[5]
      ? path.resolve(process.argv[5])
      : DEFAULT_DUPLICATE_CSV;

    if (!fs.existsSync(inputJsonDir)) {
      throw new Error(`JSON input folder not found: ${inputJsonDir}`);
    }

    fs.mkdirSync(path.dirname(outputCsv), { recursive: true });
    fs.mkdirSync(path.dirname(reviewCsv), { recursive: true });
    fs.mkdirSync(path.dirname(duplicateCsv), { recursive: true });

    const jsonFiles = fs
      .readdirSync(inputJsonDir)
      .filter((x) => x.toLowerCase().endsWith(".json"))
      .sort((a, b) => a.localeCompare(b));

    if (jsonFiles.length === 0) {
      throw new Error(`No JSON files found in: ${inputJsonDir}`);
    }

    const mainRows: MainRow[] = [];
    const reviewRows: ReviewRow[] = [];
    const duplicateRows: DuplicateRow[] = [];
    const seenSentenceKeys = new Set<string>();

    for (const jsonFileName of jsonFiles) {
      const jsonPath = path.join(inputJsonDir, jsonFileName);
      const difficulty = mapDifficultyFromName(jsonFileName);

      console.log(`Processing ${jsonFileName} (${difficulty})`);

      const questions = parseQuestions(jsonPath);

      for (const q of questions) {
        const sentence = normalizeSpace(q.question);
        const answer = normalizeSpace(q.answer);
        const options = extractOptions(q.options);

        if (options.length === 0) {
          reviewRows.push({
            source_file: jsonFileName,
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
            source_file: jsonFileName,
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
            source_file: jsonFileName,
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
    const reviewBody = reviewRows
      .map((r) => {
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
      .join("\n");
    if (reviewRows.length > 0) {
      fs.writeFileSync(reviewCsv, `${reviewHeader}\n${reviewBody}\n`, "utf8");
    } else if (fs.existsSync(reviewCsv)) {
      fs.unlinkSync(reviewCsv);
    }

    const duplicateHeader = ["source_file", "sentence", "answer", "difficulty"].join(",");
    const duplicateBody = duplicateRows
      .map((r) => {
        return [r.source_file, r.sentence, r.answer, r.difficulty].map(csvEscape).join(",");
      })
      .join("\n");
    fs.writeFileSync(duplicateCsv, `${duplicateHeader}\n${duplicateBody}\n`, "utf8");

    console.log(`Done. main_rows=${mainRows.length} -> ${outputCsv}`);
    if (reviewRows.length > 0) {
      console.log(`Done. review_rows=${reviewRows.length} -> ${reviewCsv}`);
    } else {
      console.log(`Done. review_rows=0 -> deleted review file: ${reviewCsv}`);
    }
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
