import fs from "fs";
import path from "path";
import { createWriteStream } from "fs";

interface MatchingPair {
  left: string;
  right: string;
}

interface SourceData {
  page: number;
  kind: string;
  pairs: MatchingPair[];
}

type SourceMode = "destination" | "upstream" | "both";
type SourceFolder = "destination" | "upstream";

type InputFile = {
  mode: SourceFolder;
  filePath: string;
  fileName: string;
};

interface ExtractedPair {
  sentence_left: string;
  sentence_right: string;
  difficulty: string;
}

interface ReviewRow {
  source_file: string;
  mode: SourceFolder;
  reason: string;
  sentence_left: string;
  sentence_right: string;
  difficulty: string;
}

interface DuplicateRow {
  source_file: string;
  mode: SourceFolder;
  sentence_left: string;
  sentence_right: string;
  difficulty: string;
  conflict_with_source_file: string;
  conflict_with_mode: SourceFolder;
}

type LeftSeenRecord = {
  source_file: string;
  mode: SourceFolder;
};

const DEFAULT_INPUT_ROOT = path.join(process.cwd(), "data", "src-data-matching");
const OUTPUT_DIR = path.join(process.cwd(), "data", "archive");
const DEFAULT_OUTPUT_FILE = path.join(OUTPUT_DIR, "matching_raw.csv");
const DEFAULT_REVIEW_FILE = path.join(OUTPUT_DIR, "matching_review.csv");
const DEFAULT_DUPLICATE_FILE = path.join(OUTPUT_DIR, "matching_duplicates.csv");
const ALLOWED_SOURCE_MODES: SourceMode[] = ["destination", "upstream", "both"];

function mapDifficultyFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.includes("b1") || lower.includes("level1")) return "easy";
  if (lower.includes("b2") || lower.includes("level2")) return "medium";
  if (lower.includes("c1") || lower.includes("c2") || lower.includes("level3")) return "hard";
  return "medium";
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
  const isModeArg = ALLOWED_SOURCE_MODES.includes(normalizedArg1 as SourceMode);

  const sourceMode: SourceMode = isModeArg ? (normalizedArg1 as SourceMode) : "both";

  // Backward compatible:
  // - [mode] [inputRoot] [outputCsv] [reviewCsv] [duplicateCsv]
  // - [inputRoot] [outputCsv] [reviewCsv] [duplicateCsv]
  const inputRoot = isModeArg
    ? process.argv[3]
      ? path.resolve(process.argv[3])
      : path.resolve(DEFAULT_INPUT_ROOT)
    : process.argv[2]
      ? path.resolve(process.argv[2])
      : path.resolve(DEFAULT_INPUT_ROOT);

  const outputCsv = isModeArg
    ? process.argv[4]
      ? path.resolve(process.argv[4])
      : path.resolve(DEFAULT_OUTPUT_FILE)
    : process.argv[3]
      ? path.resolve(process.argv[3])
      : path.resolve(DEFAULT_OUTPUT_FILE);

  const reviewCsv = isModeArg
    ? process.argv[5]
      ? path.resolve(process.argv[5])
      : path.resolve(DEFAULT_REVIEW_FILE)
    : process.argv[4]
      ? path.resolve(process.argv[4])
      : path.resolve(DEFAULT_REVIEW_FILE);

  const duplicateCsv = isModeArg
    ? process.argv[6]
      ? path.resolve(process.argv[6])
      : path.resolve(DEFAULT_DUPLICATE_FILE)
    : process.argv[5]
      ? path.resolve(process.argv[5])
      : path.resolve(DEFAULT_DUPLICATE_FILE);

  return { sourceMode, inputRoot, outputCsv, reviewCsv, duplicateCsv };
}

function getSelectedSources(
  sourceMode: SourceMode,
  inputRoot: string,
): Array<{ mode: SourceFolder; dir: string }> {
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
      .filter((name) => name.toLowerCase().endsWith(".json"))
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

function safeReadJsonArray(filePath: string): { ok: true; data: SourceData[] } | { ok: false; error: string } {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (!Array.isArray(data)) {
      return { ok: false, error: "ROOT_NOT_ARRAY" };
    }
    return { ok: true, data: data as SourceData[] };
  } catch (e) {
    return { ok: false, error: `JSON_PARSE_ERROR:${(e as Error).message}` };
  }
}

function escapeCsvField(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return `"${field}"`;
}

function saveToCsv(pairs: ExtractedPair[], outputPath: string): void {
  try {
    const stream = createWriteStream(outputPath, { encoding: "utf-8" });

    stream.write("sentence_left,sentence_right,difficulty\n");

    pairs.forEach((pair) => {
      const row = `${escapeCsvField(pair.sentence_left)},${escapeCsvField(pair.sentence_right)},${pair.difficulty}\n`;
      stream.write(row);
    });

    stream.end();

    console.log(`Saved ${pairs.length} pairs to ${outputPath}`);
  } catch (error) {
    console.error("Error saving to CSV:", error);
    throw error;
  }
}

function writeReviewCsv(outputPath: string, rows: ReviewRow[]): void {
  const commentLines = [
    "# REVIEW_REASON_GUIDE",
    "# SOURCE_NOT_FOUND: Khong tim thay folder nguon",
    "# ROOT_NOT_ARRAY / JSON_PARSE_ERROR:*: Loi dinh dang JSON",
    "# ITEM_PAIRS_NOT_ARRAY: Item khong co mang pairs hop le",
    "# MISSING_LEFT_OR_RIGHT: Cap pair thieu left hoac right",
    "# === KHONG_CO_CAU_NAO_CAN_REVIEW ===: Khong co dong nao can review",
  ];

  const header = ["source_file", "mode", "reason", "sentence_left", "sentence_right", "difficulty"].join(",");

  const bodyRows =
    rows.length > 0
      ? rows.map((row) =>
          [
            row.source_file,
            row.mode,
            row.reason,
            row.sentence_left,
            row.sentence_right,
            row.difficulty,
          ]
            .map(escapeCsvField)
            .join(","),
        )
      : [["", "", "=== KHONG_CO_CAU_NAO_CAN_REVIEW ===", "", "", "medium"].map(escapeCsvField).join(",")];

  const content = `${commentLines.join("\n")}\n${header}\n${bodyRows.join("\n")}\n`;
  fs.writeFileSync(outputPath, content, "utf8");
}

function writeDuplicateCsv(outputPath: string, rows: DuplicateRow[]): void {
  const commentLines = [
    "# DUPLICATE_LEFT_GUIDE",
    "# Ghi lai cac dong bi loai do trung sentence_left voi dong da xuat hien truoc do",
    "# === KHONG_CO_DONG_TRUNG ===: Khong co dong duplicate",
  ];

  const header = [
    "source_file",
    "mode",
    "sentence_left",
    "sentence_right",
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
            row.sentence_left,
            row.sentence_right,
            row.difficulty,
            row.conflict_with_source_file,
            row.conflict_with_mode,
          ]
            .map(escapeCsvField)
            .join(","),
        )
      : [["", "", "=== KHONG_CO_DONG_TRUNG ===", "", "medium", "", ""].map(escapeCsvField).join(",")];

  const content = `${commentLines.join("\n")}\n${header}\n${bodyRows.join("\n")}\n`;
  fs.writeFileSync(outputPath, content, "utf8");
}

async function extractAllPairs(): Promise<void> {
  try {
    console.log("Starting extraction of matching pairs...\n");

    const { sourceMode, inputRoot, outputCsv, reviewCsv, duplicateCsv } = resolveCli();

    if (!fs.existsSync(inputRoot)) {
      throw new Error(`Input root not found: ${inputRoot}`);
    }

    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      console.log(`Created output directory: ${OUTPUT_DIR}`);
    }

    let allPairs: ExtractedPair[] = [];
    const reviewRows: ReviewRow[] = [];
    const duplicateRows: DuplicateRow[] = [];
    const seenLefts = new Map<string, LeftSeenRecord>();
    const inputFiles = collectInputFiles(sourceMode, inputRoot);
    const selectedSources = getSelectedSources(sourceMode, inputRoot);

    for (const source of selectedSources) {
      if (!fs.existsSync(source.dir)) {
        reviewRows.push({
          source_file: source.dir,
          mode: source.mode,
          reason: "SOURCE_NOT_FOUND",
          sentence_left: "",
          sentence_right: "",
          difficulty: "medium",
        });
      }
    }

    if (inputFiles.length === 0) {
      throw new Error(`No JSON files found for mode='${sourceMode}' in root: ${inputRoot}`);
    }

    for (const inputFile of inputFiles) {
      console.log(`Reading file: ${inputFile.filePath}`);
      const difficulty = mapDifficultyFromFileName(inputFile.fileName);

      const loaded = safeReadJsonArray(inputFile.filePath);
      if (!loaded.ok) {
        reviewRows.push({
          source_file: inputFile.fileName,
          mode: inputFile.mode,
          reason: loaded.error,
          sentence_left: "",
          sentence_right: "",
          difficulty,
        });
        continue;
      }

      let accepted = 0;
      let skipped = 0;

      loaded.data.forEach((item, itemIndex) => {
        const sourceTag = `${inputFile.fileName}#${itemIndex + 1}`;

        if (!Array.isArray(item?.pairs)) {
          reviewRows.push({
            source_file: sourceTag,
            mode: inputFile.mode,
            reason: "ITEM_PAIRS_NOT_ARRAY",
            sentence_left: "",
            sentence_right: "",
            difficulty,
          });
          return;
        }

        item.pairs.forEach((pair) => {
          const leftValue = String(pair?.left || "").trim();
          const rightValue = String(pair?.right || "").trim();

          if (!leftValue || !rightValue) {
            reviewRows.push({
              source_file: sourceTag,
              mode: inputFile.mode,
              reason: "MISSING_LEFT_OR_RIGHT",
              sentence_left: leftValue,
              sentence_right: rightValue,
              difficulty,
            });
            return;
          }

          const existed = seenLefts.get(leftValue);
          if (existed) {
            skipped += 1;
            duplicateRows.push({
              source_file: sourceTag,
              mode: inputFile.mode,
              sentence_left: leftValue,
              sentence_right: rightValue,
              difficulty,
              conflict_with_source_file: existed.source_file,
              conflict_with_mode: existed.mode,
            });
            return;
          }

          seenLefts.set(leftValue, {
            source_file: sourceTag,
            mode: inputFile.mode,
          });

          allPairs.push({
            sentence_left: leftValue,
            sentence_right: rightValue,
            difficulty,
          });
          accepted += 1;
        });
      });

      console.log(
        `Extracted ${accepted} pairs from ${path.basename(inputFile.filePath)} (skipped ${skipped} duplicate left values)`,
      );
    }

    console.log(`\nTotal pairs extracted: ${allPairs.length}`);

    saveToCsv(allPairs, outputCsv);
    writeReviewCsv(reviewCsv, reviewRows);
    writeDuplicateCsv(duplicateCsv, duplicateRows);
    console.log("\nExtraction completed successfully!");
    console.log(`Mode: ${sourceMode}`);
    console.log(`Output file: ${outputCsv}`);
    console.log(`Review file: ${reviewCsv}`);
    console.log(`Duplicate file: ${duplicateCsv}`);
  } catch (error) {
    console.error("Extraction failed:", error);
    process.exit(1);
  }
}

extractAllPairs();
