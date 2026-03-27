import fs from "fs";
import path from "path";

type Difficulty = "easy" | "medium" | "hard";
type SourceMode = "statics" | "upstream" | "both";
type SourceFolder = "statics" | "upstream";

type BlankItem = {
  answer?: string;
};

type ListeningItem = {
  gapped_text?: string;
  blanks?: BlankItem[];
  audio?: string;
};

type OutputRow = {
  gapped_text: string;
  answer: string;
  audio: string;
  difficulty: Difficulty;
};

type InputFile = {
  mode: SourceFolder;
  filePath: string;
  fileName: string;
};

type AudioSeenRecord = {
  source_file: string;
  mode: SourceFolder;
  full_text: string;
  difficulty: Difficulty;
};

type ReviewRow = {
  source_file: string;
  mode: SourceFolder;
  reason: string;
  gapped_text: string;
  full_text: string;
  answer: string;
  audio: string;
  difficulty: Difficulty;
  conflict_with_source_file: string;
  conflict_with_mode: string;
  conflict_with_gapped_text: string;
  conflict_with_full_text: string;
  conflict_with_answer: string;
  conflict_with_audio: string;
  conflict_with_difficulty: string;
};

const BASE_INPUT_DIR = path.resolve(process.cwd(), "data/src-data-listening");
const STATICS_DIR = path.join(BASE_INPUT_DIR, "statics");
const UPSTREAM_DIR = path.join(BASE_INPUT_DIR, "upstream");
const OUTPUT_FILE = path.resolve(process.cwd(), "data/archive/listening_raw_from_json.csv");
const REVIEW_FILE = path.resolve(process.cwd(), "data/archive/listening_review.csv");

const ALLOWED_SOURCE_MODES: SourceMode[] = ["statics", "upstream", "both"];

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toLiteralNewline(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\n/g, "\\n");
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function normalizeForCompare(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function numberGaps(gappedText: string): string {
  let index = 0;
  return gappedText.replace(/_{2,}/g, () => {
    index += 1;
    return `_______(${index})`;
  });
}

function buildFullText(gappedText: string, answers: string[]): string {
  let answerIndex = 0;
  return gappedText.replace(/_{2,}/g, () => {
    const value = answers[answerIndex] ?? "";
    answerIndex += 1;
    return value;
  });
}

function flattenAnswers(answers: string[]): string {
  return answers.map((ans, i) => `${i + 1}:${ans}`).join(" | ");
}

function countGaps(gappedText: string): number {
  const matches = gappedText.match(/_{2,}/g);
  return matches ? matches.length : 0;
}

function inferDifficultyFromFileName(fileName: string): Difficulty | null {
  const lower = fileName.toLowerCase();
  if (lower.includes("basic") || lower.includes("level1")) return "easy";
  if (lower.includes("developing") || lower.includes("level2")) return "medium";
  if (lower.includes("expanding") || lower.includes("level3")) return "hard";
  return null;
}

function resolveSourceMode(): SourceMode {
  const mode = String(process.argv[2] || "both").trim().toLowerCase() as SourceMode;
  if (ALLOWED_SOURCE_MODES.includes(mode)) {
    return mode;
  }

  console.warn(`Invalid mode: ${mode}. Fallback to 'both'. Use: statics | upstream | both`);
  return "both";
}

function getSelectedInputDirs(mode: SourceMode): string[] {
  if (mode === "statics") return [STATICS_DIR];
  if (mode === "upstream") return [UPSTREAM_DIR];
  return [STATICS_DIR, UPSTREAM_DIR];
}

function getSelectedInputSources(mode: SourceMode): Array<{ mode: SourceFolder; dir: string }> {
  if (mode === "statics") return [{ mode: "statics", dir: STATICS_DIR }];
  if (mode === "upstream") return [{ mode: "upstream", dir: UPSTREAM_DIR }];
  return [
    { mode: "statics", dir: STATICS_DIR },
    { mode: "upstream", dir: UPSTREAM_DIR },
  ];
}

function safeReadJsonArray(filePath: string): { ok: true; data: unknown[] } | { ok: false; error: string } {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return { ok: false, error: "ROOT_NOT_ARRAY" };
    }
    return { ok: true, data: parsed };
  } catch (err) {
    return { ok: false, error: `JSON_PARSE_ERROR:${(err as Error).message}` };
  }
}

function buildBaseReviewRow(params: {
  source_file: string;
  mode: SourceFolder;
  reason: string;
  gapped_text: string;
  full_text: string;
  answer: string;
  audio: string;
  difficulty: Difficulty;
}): ReviewRow {
  return {
    ...params,
    conflict_with_source_file: "",
    conflict_with_mode: "",
    conflict_with_gapped_text: "",
    conflict_with_full_text: "",
    conflict_with_answer: "",
    conflict_with_audio: "",
    conflict_with_difficulty: "",
  };
}

function collectInputFiles(mode: SourceMode): InputFile[] {
  const selectedSources = getSelectedInputSources(mode);
  const files: InputFile[] = [];

  for (const source of selectedSources) {
    const { mode: sourceMode, dir } = source;
    if (!fs.existsSync(dir)) {
      console.warn(`Skip missing folder: ${dir}`);
      continue;
    }

    const names = fs
      .readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith(".json"))
      .sort((a, b) => a.localeCompare(b));

    for (const fileName of names) {
      files.push({
        mode: sourceMode,
        filePath: path.join(dir, fileName),
        fileName,
      });
    }
  }

  return files;
}

function writeCsv(rows: OutputRow[], outputPath: string): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const header = ["gapped_text", "answer", "audio", "difficulty"].join(",");
  const body = rows
    .map((row) => {
      return [row.gapped_text, row.answer, row.audio, row.difficulty].map(csvEscape).join(",");
    })
    .join("\n");

  const content = body ? `${header}\n${body}\n` : `${header}\n`;
  fs.writeFileSync(outputPath, content, "utf-8");
}

function writeReviewCsv(filePath: string, rows: ReviewRow[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const header = [
    "source_file",
    "mode",
    "reason",
    "gapped_text",
    "full_text",
    "answer",
    "audio",
    "difficulty",
    "conflict_with_source_file",
    "conflict_with_mode",
    "conflict_with_gapped_text",
    "conflict_with_full_text",
    "conflict_with_answer",
    "conflict_with_audio",
    "conflict_with_difficulty",
  ].join(",");

  const body = rows
    .map((row) =>
      [
        row.source_file,
        row.mode,
        row.reason,
        row.gapped_text,
        row.full_text,
        row.answer,
        row.audio,
        row.difficulty,
        row.conflict_with_source_file,
        row.conflict_with_mode,
        row.conflict_with_gapped_text,
        row.conflict_with_full_text,
        row.conflict_with_answer,
        row.conflict_with_audio,
        row.conflict_with_difficulty,
      ]
        .map(csvEscape)
        .join(","),
    )
    .join("\n");

  const content = body ? `${header}\n${body}\n` : `${header}\n`;
  fs.writeFileSync(filePath, content, "utf8");
}

function main(): void {
  const sourceMode = resolveSourceMode();
  const inputFiles = collectInputFiles(sourceMode);

  const allRows: OutputRow[] = [];
  const reviewRows: ReviewRow[] = [];

  const seenMainKey = new Set<string>();
  const audioToFirstSeen = new Map<string, AudioSeenRecord>();
  const reportedAudioConflicts = new Set<string>();

  const selectedDirs = getSelectedInputDirs(sourceMode);
  for (const dir of selectedDirs) {
    if (!fs.existsSync(dir)) {
      const mode: SourceFolder = dir === STATICS_DIR ? "statics" : "upstream";
      reviewRows.push(
        buildBaseReviewRow({
          source_file: dir,
          mode,
          reason: "SOURCE_DIR_NOT_FOUND",
          gapped_text: "",
          full_text: "",
          answer: "",
          audio: "",
          difficulty: "medium",
        }),
      );
    }
  }

  for (const input of inputFiles) {
    const loaded = safeReadJsonArray(input.filePath);
    const difficulty = inferDifficultyFromFileName(input.fileName);
    const sourceModeTag = input.mode;

    if (!difficulty) {
      reviewRows.push(
        buildBaseReviewRow({
          source_file: input.fileName,
          mode: sourceModeTag,
          reason: "UNMAPPED_DIFFICULTY",
          gapped_text: "",
          full_text: "",
          answer: "",
          audio: "",
          difficulty: "medium",
        }),
      );
      continue;
    }

    if (!loaded.ok) {
      reviewRows.push(
        buildBaseReviewRow({
          source_file: input.fileName,
          mode: sourceModeTag,
          reason: loaded.error,
          gapped_text: "",
          full_text: "",
          answer: "",
          audio: "",
          difficulty,
        }),
      );
      continue;
    }

    let acceptedRows = 0;

    loaded.data.forEach((rawItem, index) => {
      const sourceTag = `${input.fileName}#${index + 1}`;
      if (!rawItem || typeof rawItem !== "object") {
        reviewRows.push(
          buildBaseReviewRow({
            source_file: sourceTag,
            mode: sourceModeTag,
            reason: "ITEM_NOT_OBJECT",
            gapped_text: "",
            full_text: "",
            answer: "",
            audio: "",
            difficulty,
          }),
        );
        return;
      }

      const item = rawItem as ListeningItem;
      const originalGappedText = normalizeText(String(item.gapped_text || ""));

      const answers = (Array.isArray(item.blanks) ? item.blanks : [])
        .map((blank) => String(blank?.answer || "").trim())
        .filter((ans) => ans.length > 0);

      const answerText = flattenAnswers(answers);
      const audio = normalizeForCompare(String(item.audio || ""));

      if (!originalGappedText) {
        reviewRows.push(
          buildBaseReviewRow({
            source_file: sourceTag,
            mode: sourceModeTag,
            reason: "MISSING_GAPPED_TEXT",
            gapped_text: "",
            full_text: "",
            answer: answerText,
            audio,
            difficulty,
          }),
        );
        return;
      }

      if (!audio) {
        reviewRows.push(
          buildBaseReviewRow({
            source_file: sourceTag,
            mode: sourceModeTag,
            reason: "MISSING_AUDIO",
            gapped_text: originalGappedText,
            full_text: "",
            answer: answerText,
            audio,
            difficulty,
          }),
        );
        return;
      }

      if (answers.length === 0) {
        reviewRows.push(
          buildBaseReviewRow({
            source_file: sourceTag,
            mode: sourceModeTag,
            reason: "MISSING_ANSWERS",
            gapped_text: originalGappedText,
            full_text: "",
            answer: answerText,
            audio,
            difficulty,
          }),
        );
        return;
      }

      const gapCount = countGaps(originalGappedText);
      if (gapCount !== answers.length) {
        reviewRows.push(
          buildBaseReviewRow({
            source_file: sourceTag,
            mode: sourceModeTag,
            reason: `ANSWER_COUNT_MISMATCH(gaps:${gapCount},answers:${answers.length})`,
            gapped_text: originalGappedText,
            full_text: "",
            answer: answerText,
            audio,
            difficulty,
          }),
        );
        return;
      }

      const gappedWithNumber = numberGaps(originalGappedText);
      const fullText = buildFullText(originalGappedText, answers);

      const normalizedFullText = normalizeForCompare(fullText);
      const firstSeen = audioToFirstSeen.get(audio);

      if (firstSeen && firstSeen.full_text !== normalizedFullText) {
        const pairKeySorted = [firstSeen.source_file, sourceTag].sort().join(" <-> ");
        const conflictKey = `${audio} || ${pairKeySorted}`;

        if (!reportedAudioConflicts.has(conflictKey)) {
          reportedAudioConflicts.add(conflictKey);

          reviewRows.push({
            source_file: sourceTag,
            mode: sourceModeTag,
            reason: "AUDIO_DUPLICATED_WITH_DIFFERENT_FULL_TEXT",
            gapped_text: gappedWithNumber,
            full_text: fullText,
            answer: answerText,
            audio,
            difficulty,
            conflict_with_source_file: firstSeen.source_file,
            conflict_with_mode: firstSeen.mode,
            conflict_with_gapped_text: "",
            conflict_with_full_text: firstSeen.full_text,
            conflict_with_answer: "",
            conflict_with_audio: audio,
            conflict_with_difficulty: firstSeen.difficulty,
          });

          reviewRows.push({
            source_file: firstSeen.source_file,
            mode: firstSeen.mode,
            reason: "AUDIO_DUPLICATED_WITH_DIFFERENT_FULL_TEXT",
            gapped_text: "",
            full_text: firstSeen.full_text,
            answer: "",
            audio,
            difficulty: firstSeen.difficulty,
            conflict_with_source_file: sourceTag,
            conflict_with_mode: sourceModeTag,
            conflict_with_gapped_text: gappedWithNumber,
            conflict_with_full_text: fullText,
            conflict_with_answer: answerText,
            conflict_with_audio: audio,
            conflict_with_difficulty: difficulty,
          });
        }

        return;
      }

      if (!firstSeen) {
        audioToFirstSeen.set(audio, {
          source_file: sourceTag,
          mode: sourceModeTag,
          full_text: normalizedFullText,
          difficulty,
        });
      }

      const dedupeKey = `${normalizeForCompare(gappedWithNumber)}||${normalizedFullText}||${normalizeForCompare(answerText)}||${audio}||${difficulty}`;
      if (seenMainKey.has(dedupeKey)) {
        return;
      }
      seenMainKey.add(dedupeKey);

      allRows.push({
        gapped_text: toLiteralNewline(gappedWithNumber),
        answer: answerText,
        audio,
        difficulty,
      });

      acceptedRows += 1;
    });

    console.log(`Processed ${input.filePath}: ${acceptedRows} rows`);
  }

  writeCsv(allRows, OUTPUT_FILE);
  writeReviewCsv(REVIEW_FILE, reviewRows);

  const audioConflictRows = reviewRows.filter(
    (row) => row.reason === "AUDIO_DUPLICATED_WITH_DIFFERENT_FULL_TEXT",
  );

  const audioConflictPairKeys = new Set<string>();
  for (const row of audioConflictRows) {
    const pair = [row.source_file, row.conflict_with_source_file].sort().join(" <-> ");
    const key = `${row.audio}||${pair}`;
    audioConflictPairKeys.add(key);
  }

  const audioConflictIssueCount = audioConflictPairKeys.size;
  const nonAudioConflictIssueCount = reviewRows.length - audioConflictRows.length;
  const totalReviewIssues = nonAudioConflictIssueCount + audioConflictIssueCount;
  const reviewReasonCounts = new Map<string, number>();

  for (const row of reviewRows) {
    const current = reviewReasonCounts.get(row.reason) ?? 0;
    reviewReasonCounts.set(row.reason, current + 1);
  }

  const sortedReasonStats = Array.from(reviewReasonCounts.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  console.log(`Done. mode=${sourceMode}`);
  console.log(`Main rows: ${allRows.length} -> ${OUTPUT_FILE}`);
  console.log(`Review rows: ${reviewRows.length} -> ${REVIEW_FILE}`);
  console.log(`Review issues: ${totalReviewIssues}`);
  console.log(`Questions need review: ${totalReviewIssues}`);
  console.log(`All error rows: ${reviewRows.length}`);

  if (sortedReasonStats.length > 0) {
    console.log("Error statistics (all rows):");
    for (const [reason, count] of sortedReasonStats) {
      console.log(`- ${reason}: ${count}`);
    }
  }

  if (audioConflictIssueCount > 0) {
    console.log(`Audio duplicate issues: ${audioConflictIssueCount}`);
  }
}

main();