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

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeSpaces(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function normalizeForCompare(value: string): string {
  return normalizeLineEndings(value)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function normalizeAudio(value: string): string {
  return normalizeForCompare(value);
}

function parseMode(input?: string): SourceMode {
  const lower = String(input || "both").toLowerCase();
  if (lower === "stactics" || lower === "upstream" || lower === "both") {
    return lower;
  }
  throw new Error(`Invalid mode: ${input}. Use stactics | upstream | both`);
}

function mapDifficultyFromFileName(fileName: string): Difficulty {
  const lower = fileName.toLowerCase();

  if (lower.includes("basic") || lower.includes("level1")) return "easy";
  if (lower.includes("developing") || lower.includes("level2")) return "medium";
  if (lower.includes("expanding") || lower.includes("level3")) return "hard";

  return "medium";
}

function extractSentencesRaw(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const out: string[] = [];
  for (const part of value) {
    const s = normalizeLineEndings(String(part ?? "")).trim();
    if (s.length > 0) out.push(s);
  }
  return out;
}

function parseLeadingNumber(sentence: string): number | null {
  const match = sentence.match(/^\s*(\d+)\s*([.)-]|\s)/);
  if (!match) return null;
  return Number(match[1]);
}

function validateSentenceNumbering(sentences: string[]): { ok: boolean; reason?: string } {
  if (sentences.length === 0) {
    return { ok: false, reason: "EMPTY_SENTENCES" };
  }

  const nums: number[] = [];
  for (const s of sentences) {
    const n = parseLeadingNumber(s);
    if (n === null) {
      return { ok: false, reason: "MISSING_NUMBER_PREFIX" };
    }
    nums.push(n);
  }

  for (let i = 0; i < nums.length; i += 1) {
    const expected = i + 1;
    if (nums[i] !== expected) {
      return {
        ok: false,
        reason: `NON_SEQUENTIAL_NUMBERING(expected:${expected},actual:${nums[i]})`,
      };
    }
  }

  return { ok: true };
}

function toJoinedSentencesKeepNewline(sentences: string[]): string {
  return normalizeLineEndings(sentences.join("\n")).trim();
}

function getModesToProcess(mode: SourceMode): Array<"stactics" | "upstream"> {
  if (mode === "both") return ["stactics", "upstream"];
  return [mode];
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

function writeMainCsv(filePath: string, rows: MainRow[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const header = "sentences,audio,difficulty";
  const body = rows
    .map((r) => [r.sentences, r.audio, r.difficulty].map(csvEscape).join(","))
    .join("\n");

  const content = body ? `${header}\n${body}\n` : `${header}\n`;
  fs.writeFileSync(filePath, content, "utf8");
}

function writeReviewCsv(filePath: string, rows: ReviewRow[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

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

  const body = rows
    .map((r) =>
      [
        r.source_file,
        r.mode,
        r.reason,
        r.sentences,
        r.audio,
        r.difficulty,
        r.conflict_with_source_file,
        r.conflict_with_mode,
        r.conflict_with_sentences,
        r.conflict_with_audio,
        r.conflict_with_difficulty,
      ]
        .map(csvEscape)
        .join(","),
    )
    .join("\n");

  const content = body ? `${header}\n${body}\n` : `${header}\n`;
  fs.writeFileSync(filePath, content, "utf8");
}

function main(): void {
  const mode = parseMode(process.argv[2]);
  const inputRoot = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_INPUT_ROOT;
  const outputCsv = process.argv[4] ? path.resolve(process.argv[4]) : DEFAULT_OUTPUT_CSV;
  const reviewCsv = process.argv[5] ? path.resolve(process.argv[5]) : DEFAULT_REVIEW_CSV;

  const modes = getModesToProcess(mode);

  const mainRows: MainRow[] = [];
  const reviewRows: ReviewRow[] = [];

  // exact dedupe cho output chính
  const seenMainKey = new Set<string>();

  // track audio đầu tiên đã thấy
  const audioToFirstSeen = new Map<string, AudioSeenRecord>();

  // để không đẩy lặp lại cùng 1 conflict nhiều lần
  const reportedAudioConflicts = new Set<string>();

  for (const currentMode of modes) {
    const sourceDir = path.join(inputRoot, currentMode);

    if (!fs.existsSync(sourceDir)) {
      reviewRows.push(
        buildBaseReviewRow({
          source_file: sourceDir,
          mode: currentMode,
          reason: "SOURCE_DIR_NOT_FOUND",
          sentences: "",
          audio: "",
          difficulty: "medium",
        }),
      );
      continue;
    }

    const jsonFiles = fs
      .readdirSync(sourceDir)
      .filter((name) => name.toLowerCase().endsWith(".json"))
      .sort((a, b) => a.localeCompare(b));

    for (const fileName of jsonFiles) {
      const filePath = path.join(sourceDir, fileName);
      const difficulty = mapDifficultyFromFileName(fileName);

      const loaded = safeReadJsonArray(filePath);
      if (!loaded.ok) {
        reviewRows.push(
          buildBaseReviewRow({
            source_file: fileName,
            mode: currentMode,
            reason: loaded.error,
            sentences: "",
            audio: "",
            difficulty,
          }),
        );
        continue;
      }

      loaded.data.forEach((rawItem, index) => {
        const sourceTag = `${fileName}#${index + 1}`;

        if (!rawItem || typeof rawItem !== "object") {
          reviewRows.push(
            buildBaseReviewRow({
              source_file: sourceTag,
              mode: currentMode,
              reason: "ITEM_NOT_OBJECT",
              sentences: "",
              audio: "",
              difficulty,
            }),
          );
          return;
        }

        const item = rawItem as SpeakingItem;

        const sentenceArray = extractSentencesRaw(item.sentences);
        const sentenceValidation = validateSentenceNumbering(sentenceArray);

        const joinedSentences = toJoinedSentencesKeepNewline(sentenceArray);
        const joinedSentencesNormalized = normalizeForCompare(joinedSentences);

        const audioRaw = String(item.audio ?? "");
        const audio = normalizeAudio(audioRaw);

        if (!sentenceValidation.ok) {
          reviewRows.push(
            buildBaseReviewRow({
              source_file: sourceTag,
              mode: currentMode,
              reason: sentenceValidation.reason || "INVALID_SENTENCES",
              sentences: joinedSentences,
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
              mode: currentMode,
              reason: "MISSING_AUDIO",
              sentences: joinedSentences,
              audio,
              difficulty,
            }),
          );
          return;
        }

        const firstSeen = audioToFirstSeen.get(audio);
        if (firstSeen && firstSeen.sentences !== joinedSentencesNormalized) {
          // tạo key conflict theo cặp 2 source để chỉ report 1 lần/cặp
          const pairKeySorted = [firstSeen.source_file, sourceTag].sort().join(" <-> ");
          const conflictKey = `${audio} || ${pairKeySorted}`;

          if (!reportedAudioConflicts.has(conflictKey)) {
            reportedAudioConflicts.add(conflictKey);

            // row A: current record, show conflict with firstSeen
            reviewRows.push({
              source_file: sourceTag,
              mode: currentMode,
              reason: "AUDIO_DUPLICATED_WITH_DIFFERENT_SENTENCES",
              sentences: joinedSentences,
              audio,
              difficulty,
              conflict_with_source_file: firstSeen.source_file,
              conflict_with_mode: firstSeen.mode,
              conflict_with_sentences: firstSeen.sentences,
              conflict_with_audio: audio,
              conflict_with_difficulty: firstSeen.difficulty,
            });

            // row B: firstSeen record, show conflict with current
            reviewRows.push({
              source_file: firstSeen.source_file,
              mode: firstSeen.mode,
              reason: "AUDIO_DUPLICATED_WITH_DIFFERENT_SENTENCES",
              sentences: firstSeen.sentences,
              audio,
              difficulty: firstSeen.difficulty,
              conflict_with_source_file: sourceTag,
              conflict_with_mode: currentMode,
              conflict_with_sentences: joinedSentences,
              conflict_with_audio: audio,
              conflict_with_difficulty: difficulty,
            });
          }

          return;
        }

        if (!firstSeen) {
          audioToFirstSeen.set(audio, {
            source_file: sourceTag,
            mode: currentMode,
            sentences: joinedSentencesNormalized,
            difficulty,
          });
        }

        const dedupeKey = `${joinedSentencesNormalized}||${audio}||${difficulty}`;
        if (seenMainKey.has(dedupeKey)) {
          return;
        }
        seenMainKey.add(dedupeKey);

        mainRows.push({
          sentences: joinedSentences,
          audio,
          difficulty,
        });
      });
    }
  }

  writeMainCsv(outputCsv, mainRows);
  writeReviewCsv(reviewCsv, reviewRows);

  const totalReviewRows = reviewRows.length;

  const audioConflictRows = reviewRows.filter(
    (r) => r.reason === "AUDIO_DUPLICATED_WITH_DIFFERENT_SENTENCES",
  );

  // Đếm số cặp conflict unique (2 dòng -> 1 issue)
  const audioConflictPairKeys = new Set<string>();
  for (const row of audioConflictRows) {
    const pair = [row.source_file, row.conflict_with_source_file].sort().join(" <-> ");
    const key = `${row.audio}||${pair}`;
    audioConflictPairKeys.add(key);
  }

  const audioConflictIssueCount = audioConflictPairKeys.size;
  const nonAudioConflictIssueCount = totalReviewRows - audioConflictRows.length;
  const totalReviewIssues = nonAudioConflictIssueCount + audioConflictIssueCount;

  console.log(`Done. mode=${mode}`);
  console.log(`Main rows: ${mainRows.length} -> ${outputCsv}`);
  console.log(`Review rows: ${totalReviewRows} -> ${reviewCsv}`);
  console.log(`Review issues: ${totalReviewIssues}`);

  if (audioConflictIssueCount > 0) {
    console.log(`Audio duplicate issues: ${audioConflictIssueCount}`);
  }
}

main();