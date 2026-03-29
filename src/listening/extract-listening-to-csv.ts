import fs from "fs";
import path from "path";

// Kiểu độ khó
type Difficulty = "easy" | "medium" | "hard";

// Mode chạy (lọc nguồn)
type SourceMode = "statics" | "upstream" | "both";

// Folder nguồn
type SourceFolder = "statics" | "upstream";

// 1 ô trống
type BlankItem = {
  answer?: string;
};

// 1 item trong JSON
type ListeningItem = {
  gapped_text?: string;
  blanks?: BlankItem[];
  audio?: string;
};

// Dòng output chính
type OutputRow = {
  gapped_text: string;
  answer: string;
  audio: string;
  difficulty: Difficulty;
};

// File input
type InputFile = {
  mode: SourceFolder;
  filePath: string;
  fileName: string;
};

// Lưu audio đã gặp để detect duplicate
type AudioSeenRecord = {
  source_file: string;
  mode: SourceFolder;
  full_text: string;
  difficulty: Difficulty;
};

// Dòng review (log lỗi)
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

type DuplicateRow = {
  source_file: string;
  mode: SourceFolder;
  reason: string;
  gapped_text: string;
  answer: string;
  audio: string;
  difficulty: Difficulty;
  conflict_with_source_file: string;
  conflict_with_mode: string;
};

type MainSeenRecord = {
  source_file: string;
  mode: SourceFolder;
};

// Đường dẫn
const BASE_INPUT_DIR = path.resolve(process.cwd(), "data/src-data-listening");
const STATICS_DIR = path.join(BASE_INPUT_DIR, "statics");
const UPSTREAM_DIR = path.join(BASE_INPUT_DIR, "upstream");
const OUTPUT_FILE = path.resolve(process.cwd(), "data/archive/listening_raw.csv");
const REVIEW_FILE = path.resolve(process.cwd(), "data/archive/listening_review.csv");
const DUPLICATE_FILE = path.resolve(process.cwd(), "data/archive/listening_duplicates.csv");

// Mode hợp lệ
const ALLOWED_SOURCE_MODES: SourceMode[] = ["statics", "upstream", "both"];

// Escape CSV (tránh lỗi dấu ", , newline)
function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Chuyển newline thật thành \n
function toLiteralNewline(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\n/g, "\\n");
}

// Chuẩn hóa text cơ bản
function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

// Chuẩn hóa để so sánh (xóa space dư)
function normalizeForCompare(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
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

// Đánh số gap: ______ -> ______(1)
function numberGaps(gappedText: string): string {
  let index = 0;
  return gappedText.replace(/_{2,}/g, () => {
    index += 1;
    return `_______(${index})`;
  });
}

// Build full text bằng cách thay gap bằng đáp án
function buildFullText(gappedText: string, answers: string[]): string {
  let answerIndex = 0;
  return gappedText.replace(/_{2,}/g, () => {
    const value = answers[answerIndex] ?? "";
    answerIndex += 1;
    return value;
  });
}

// Gộp đáp án thành chuỗi: 1:a | 2:b
function flattenAnswers(answers: string[]): string {
  return answers.map((ans, i) => `${i + 1}:${ans}`).join(" | ");
}

// Đếm số gap
function countGaps(gappedText: string): number {
  const matches = gappedText.match(/_{2,}/g);
  return matches ? matches.length : 0;
}

// Suy ra difficulty từ tên file
function inferDifficultyFromFileName(fileName: string): Difficulty | null {
  const lower = fileName.toLowerCase();
  if (lower.includes("basic") || lower.includes("level1")) return "easy";
  if (lower.includes("developing") || lower.includes("level2")) return "medium";
  if (lower.includes("expanding") || lower.includes("level3")) return "hard";
  return null;
}

// Lấy mode từ CLI
function resolveSourceMode(): SourceMode {
  const mode = String(process.argv[2] || "both").trim().toLowerCase() as SourceMode;
  if (ALLOWED_SOURCE_MODES.includes(mode)) {
    return mode;
  }

  console.warn(`Invalid mode: ${mode}. Fallback to 'both'. Use: statics | upstream | both`);
  return "both";
}

// Lấy folder theo mode
function getSelectedInputDirs(mode: SourceMode): string[] {
  if (mode === "statics") return [STATICS_DIR];
  if (mode === "upstream") return [UPSTREAM_DIR];
  return [STATICS_DIR, UPSTREAM_DIR];
}

// Lấy source + mode
function getSelectedInputSources(mode: SourceMode): Array<{ mode: SourceFolder; dir: string }> {
  if (mode === "statics") return [{ mode: "statics", dir: STATICS_DIR }];
  if (mode === "upstream") return [{ mode: "upstream", dir: UPSTREAM_DIR }];
  return [
    { mode: "statics", dir: STATICS_DIR },
    { mode: "upstream", dir: UPSTREAM_DIR },
  ];
}

// Đọc JSON an toàn
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

// Tạo dòng review mặc định
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

// Lấy danh sách file JSON
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

// Ghi file CSV chính
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

// Ghi file review (log lỗi)
function writeReviewCsv(filePath: string, rows: ReviewRow[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const reviewCommentLines = [
    "# REVIEW_REASON_GUIDE",
    "# SOURCE_DIR_NOT_FOUND: Khong tim thay folder nguon",
    "# UNMAPPED_DIFFICULTY: Khong map duoc difficulty tu ten file",
    "# ROOT_NOT_ARRAY / JSON_PARSE_ERROR:*: Loi dinh dang JSON",
    "# ITEM_NOT_OBJECT: Phan tu khong phai object",
    "# MISSING_GAPPED_TEXT: Thieu gapped_text",
    "# MISSING_AUDIO: Thieu audio",
    "# AUDIO_NOT_CLOUDINARY: Audio khong phai link cloudinary",
    "# AUDIO_NOT_MP3: Audio khong co duoi .mp3",
    "# AUDIO_NOT_CLOUDINARY_AND_NOT_MP3: Audio vua khong cloudinary vua khong .mp3",
    "# MISSING_ANSWERS: Thieu danh sach dap an",
    "# ANSWER_COUNT_MISMATCH(gaps:X,answers:Y): So gap va so answer khong khop",
    "# AUDIO_DUPLICATED_WITH_DIFFERENT_FULL_TEXT: Trung audio nhung full_text khac nhau",
    "# === KHONG_CO_CAU_NAO_CAN_REVIEW ===: Khong co dong nao can review",
  ];

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

  const bodyRows =
    rows.length > 0
      ? rows.map((row) =>
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
      : [
          [
            "",
            "",
            "=== KHONG_CO_CAU_NAO_CAN_REVIEW ===",
            "",
            "",
            "",
            "",
            "medium",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
          ]
            .map(csvEscape)
            .join(","),
        ];

  const body = bodyRows.join("\n");

  const comment = reviewCommentLines.join("\n");
  const content = `${comment}\n${header}\n${body}\n`;
  fs.writeFileSync(filePath, content, "utf8");
}

function writeDuplicateCsv(filePath: string, rows: DuplicateRow[]): void {
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
    "gapped_text",
    "answer",
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
            row.gapped_text,
            row.answer,
            row.audio,
            row.difficulty,
            row.conflict_with_source_file,
            row.conflict_with_mode,
          ]
            .map(csvEscape)
            .join(","),
        )
      : [["", "", "=== KHONG_CO_DONG_TRUNG ===", "", "", "", "medium", "", ""].map(csvEscape).join(",")];

  const content = `${commentLines.join("\n")}\n${header}\n${bodyRows.join("\n")}\n`;
  fs.writeFileSync(filePath, content, "utf8");
}

  // Hàm main xử lý toàn bộ pipeline
function main(): void {
  // Lấy mode (statics | upstream | both)
  const sourceMode = resolveSourceMode();

  // Lấy danh sách file input
  const inputFiles = collectInputFiles(sourceMode);

  // Mảng chứa dữ liệu output hợp lệ
  const allRows: OutputRow[] = [];

  // Mảng chứa các lỗi / dữ liệu cần review
  const reviewRows: ReviewRow[] = [];

  // Mảng chứa duplicate (khong phai loi)
  const duplicateRows: DuplicateRow[] = [];

  // Map dùng để loại duplicate dòng chính và lưu dòng đầu tiên
  const seenMainKey = new Map<string, MainSeenRecord>();

  // Map: audio -> lần xuất hiện đầu tiên (để detect conflict)
  const audioToFirstSeen = new Map<string, AudioSeenRecord>();

  // Tránh log duplicate conflict nhiều lần
  const reportedAudioConflicts = new Set<string>();

  // Kiểm tra folder có tồn tại không
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

  // Duyệt từng file JSON
  for (const input of inputFiles) {
    const loaded = safeReadJsonArray(input.filePath);

    // Suy ra độ khó từ tên file
    const difficulty = inferDifficultyFromFileName(input.fileName);

    const sourceModeTag = input.mode;

    // Nếu không xác định được difficulty → log lỗi
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

    // Nếu lỗi JSON
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

    // Duyệt từng item trong file
    loaded.data.forEach((rawItem, index) => {
      const sourceTag = `${input.fileName}#${index + 1}`;

      // Kiểm tra item hợp lệ
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

      // Chuẩn hóa gapped_text
      const originalGappedText = normalizeText(String(item.gapped_text || ""));

      // Lấy danh sách đáp án
      const answers = (Array.isArray(item.blanks) ? item.blanks : [])
        .map((blank) => String(blank?.answer || "").trim())
        .filter((ans) => ans.length > 0);

      const answerText = flattenAnswers(answers);

      // Chuẩn hóa audio
      const audio = normalizeForCompare(String(item.audio || ""));

      // Validate từng trường

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

      const audioError = validateAudio(audio);
      if (audioError) {
        reviewRows.push(
          buildBaseReviewRow({
            source_file: sourceTag,
            mode: sourceModeTag,
            reason: audioError,
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

      // Check số gap vs số answer
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

      // Xử lý dữ liệu hợp lệ
      const gappedWithNumber = numberGaps(originalGappedText);
      const fullText = buildFullText(originalGappedText, answers);

      const normalizedFullText = normalizeForCompare(fullText);
      const firstSeen = audioToFirstSeen.get(audio);

      // Detect audio trùng nhưng nội dung khác
      if (firstSeen && firstSeen.full_text !== normalizedFullText) {
        const pairKeySorted = [firstSeen.source_file, sourceTag].sort().join(" <-> ");
        const conflictKey = `${audio} || ${pairKeySorted}`;

        if (!reportedAudioConflicts.has(conflictKey)) {
          reportedAudioConflicts.add(conflictKey);

          // Ghi log conflict 2 chiều
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

      // Lưu audio lần đầu
      if (!firstSeen) {
        audioToFirstSeen.set(audio, {
          source_file: sourceTag,
          mode: sourceModeTag,
          full_text: normalizedFullText,
          difficulty,
        });
      }

      // Key để dedupe
      const dedupeKey = `${normalizeForCompare(gappedWithNumber)}||${normalizedFullText}||${normalizeForCompare(answerText)}||${audio}||${difficulty}`;

      const firstMainSeen = seenMainKey.get(dedupeKey);
      if (firstMainSeen) {
        duplicateRows.push({
          source_file: sourceTag,
          mode: sourceModeTag,
          reason: "EXACT_DUPLICATE_ROW",
          gapped_text: toLiteralNewline(gappedWithNumber),
          answer: answerText,
          audio,
          difficulty,
          conflict_with_source_file: firstMainSeen.source_file,
          conflict_with_mode: firstMainSeen.mode,
        });
        return;
      }

      seenMainKey.set(dedupeKey, {
        source_file: sourceTag,
        mode: sourceModeTag,
      });

      // Thêm vào output
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

  // Ghi file CSV
  writeCsv(allRows, OUTPUT_FILE);
  writeReviewCsv(REVIEW_FILE, reviewRows);
  writeDuplicateCsv(DUPLICATE_FILE, duplicateRows);

  // Thống kê lỗi
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

  // Log kết quả
  console.log(`Done. mode=${sourceMode}`);
  console.log(`Main rows: ${allRows.length} -> ${OUTPUT_FILE}`);
  console.log(`Review rows: ${reviewRows.length} -> ${REVIEW_FILE}`);
  console.log(`Duplicate rows: ${duplicateRows.length} -> ${DUPLICATE_FILE}`);
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