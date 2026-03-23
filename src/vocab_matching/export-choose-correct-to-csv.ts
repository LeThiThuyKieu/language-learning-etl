import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { PDFParse } from "pdf-parse";

type Difficulty = "easy" | "medium" | "hard";

type ChoiceLetter = "A" | "B" | "C" | "D";

type ChooseQuestion = {
  page: number;
  section: string;
  question: string;
  options: Partial<Record<ChoiceLetter, string>>;
};

type AnswerPair = {
  number: number;
  letter: ChoiceLetter;
};

type MainRow = {
  sentence: string;
  answer: string;
  distractors: string;
  difficulty: Difficulty;
};

type ReviewRow = {
  source_file: string;
  page: number;
  section: string;
  sentence: string;
  options_count: number;
  detected_question_number: string;
  detected_answer_letter: string;
  reason: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_INPUT_PDF_DIR = path.resolve(__dirname, "../../data/destination_input");
const DEFAULT_INPUT_JSON_DIR = path.resolve(__dirname, "../../data/destination_text");
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, "../../data/archive/destination");
const DEFAULT_OUTPUT_CSV = path.resolve(DEFAULT_OUTPUT_DIR, "choose_correct_raw.csv");
const DEFAULT_REVIEW_CSV = path.resolve(DEFAULT_OUTPUT_DIR, "choose_correct_review.csv");

function mapDifficultyFromName(fileName: string): Difficulty {
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

function hasSuspiciousCharacters(value: string): boolean {
  // Keep this strict to obvious OCR corruption only.
  if (/�/.test(value)) return true;
  if (/Ã|Â/.test(value)) return true;
  return false;
}

function extractQuestionNumber(question: string): number | null {
  const normalized = normalizeSpace(question);

  // Prefer numbers around sentence boundaries (typical OCR pattern: "... . 32")
  const boundaryMatch = normalized.match(/(?:^|[.!?]\s+)(\d{1,3})(?:\s|$)/);
  if (boundaryMatch) {
    const n = Number(boundaryMatch[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 300) return n;
  }

  // Fallback: first standalone number in range.
  const genericMatch = normalized.match(/\b(\d{1,3})\b/);
  if (!genericMatch) return null;

  const n = Number(genericMatch[1]);
  if (!Number.isFinite(n) || n < 1 || n > 300) return null;
  return n;
}

function mode(numbers: number[]): number | null {
  if (numbers.length === 0) return null;

  const freq = new Map<number, number>();
  for (const n of numbers) {
    freq.set(n, (freq.get(n) || 0) + 1);
  }

  let best: number | null = null;
  let bestCount = -1;
  for (const [n, count] of freq.entries()) {
    if (count > bestCount || (count === bestCount && best !== null && n > best)) {
      best = n;
      bestCount = count;
    }
    if (best === null) {
      best = n;
      bestCount = count;
    }
  }

  return best;
}

async function extractPdfText(pdfFilePath: string): Promise<string> {
  const buffer = fs.readFileSync(pdfFilePath);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const textResult = await parser.getText();
  await parser.destroy();
  return normalizeSpace(textResult.text || "");
}

function parseAnswerPairs(pdfText: string): AnswerPair[] {
  const result: AnswerPair[] = [];
  const lower = pdfText.toLowerCase();
  const answerKeyPos = lower.lastIndexOf("answer key");
  const source = answerKeyPos >= 0 ? pdfText.slice(answerKeyPos) : pdfText;

  const regex = /(\d{1,3})\s*([ABCD])/gi;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(source)) !== null) {
    const number = Number(match[1]);
    const letter = match[2].toUpperCase() as ChoiceLetter;
    if (!Number.isFinite(number) || number < 1 || number > 300) continue;
    result.push({ number, letter });
  }

  return result;
}

function getMatchingPdfPath(jsonFileName: string, inputPdfDir: string): string | null {
  const base = jsonFileName.replace(/\.choose-correct-answer\.json$/i, "");
  const pdfPath = path.join(inputPdfDir, `${base}.pdf`);
  return fs.existsSync(pdfPath) ? pdfPath : null;
}

function parseChooseQuestions(jsonPath: string): ChooseQuestion[] {
  const raw = fs.readFileSync(jsonPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];

  const out: ChooseQuestion[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;

    const page = Number(obj.page);
    const section = normalizeSpace(String(obj.section || ""));
    const question = normalizeSpace(String(obj.question || ""));
    const optionsRaw = obj.options as Record<string, unknown> | undefined;

    const options: Partial<Record<ChoiceLetter, string>> = {};
    if (optionsRaw && typeof optionsRaw === "object") {
      for (const key of ["A", "B", "C", "D"] as ChoiceLetter[]) {
        if (typeof optionsRaw[key] === "string") {
          const normalizedOption = normalizeSpace(String(optionsRaw[key]));
          if (normalizedOption) {
            options[key] = normalizedOption;
          }
        }
      }
    }

    if (!Number.isFinite(page) || !question) continue;
    out.push({ page, section, question, options });
  }

  return out;
}

function expectedOptionCountByGroup(
  questions: ChooseQuestion[],
): Map<string, number> {
  const grouped = new Map<string, number[]>();
  for (const q of questions) {
    const key = `${q.page}|||${q.section || "(empty-section)"}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(Object.keys(q.options).length);
  }

  const result = new Map<string, number>();
  for (const [key, counts] of grouped.entries()) {
    const m = mode(counts);
    if (m !== null) {
      result.set(key, m);
    }
  }
  return result;
}

function findAnswerLetter(
  questionNumber: number | null,
  pairs: AnswerPair[],
  startIndex: number,
): { letter: ChoiceLetter | null; nextIndex: number } {
  if (questionNumber !== null) {
    for (let i = startIndex; i < pairs.length; i += 1) {
      if (pairs[i].number === questionNumber) {
        return { letter: pairs[i].letter, nextIndex: i + 1 };
      }
    }
  }

  // Fallback: use next available answer key entry in order for OCR-corrupted questions.
  if (startIndex < pairs.length) {
    return { letter: pairs[startIndex].letter, nextIndex: startIndex + 1 };
  }

  return { letter: null, nextIndex: startIndex };
}

function run(): Promise<void> {
  return (async () => {
    const inputPdfDir = process.argv[2]
      ? path.resolve(process.argv[2])
      : DEFAULT_INPUT_PDF_DIR;
    const inputJsonDir = process.argv[3]
      ? path.resolve(process.argv[3])
      : DEFAULT_INPUT_JSON_DIR;
    const outputCsv = process.argv[4]
      ? path.resolve(process.argv[4])
      : DEFAULT_OUTPUT_CSV;
    const reviewCsv = process.argv[5]
      ? path.resolve(process.argv[5])
      : DEFAULT_REVIEW_CSV;

    if (!fs.existsSync(inputPdfDir)) {
      throw new Error(`PDF input folder not found: ${inputPdfDir}`);
    }
    if (!fs.existsSync(inputJsonDir)) {
      throw new Error(`JSON input folder not found: ${inputJsonDir}`);
    }

    fs.mkdirSync(path.dirname(outputCsv), { recursive: true });
    fs.mkdirSync(path.dirname(reviewCsv), { recursive: true });

    const jsonFiles = fs
      .readdirSync(inputJsonDir)
      .filter((x) => /choose-correct-answer\.json$/i.test(x))
      .sort((a, b) => a.localeCompare(b));

    if (jsonFiles.length === 0) {
      throw new Error(`No choose-correct-answer JSON found in: ${inputJsonDir}`);
    }

    const mainRows: MainRow[] = [];
    const reviewRows: ReviewRow[] = [];

    for (const jsonFileName of jsonFiles) {
      const jsonPath = path.join(inputJsonDir, jsonFileName);
      const difficulty = mapDifficultyFromName(jsonFileName);
      const pdfPath = getMatchingPdfPath(jsonFileName, inputPdfDir);

      console.log(`Processing ${jsonFileName} (${difficulty})`);

      const questions = parseChooseQuestions(jsonPath);
      const expectedByGroup = expectedOptionCountByGroup(questions);

      let pairs: AnswerPair[] = [];
      if (pdfPath) {
        const pdfText = await extractPdfText(pdfPath);
        pairs = parseAnswerPairs(pdfText);
        console.log(`  answer_pairs=${pairs.length}`);
      } else {
        console.log("  missing matching PDF in destination_input");
      }

      let pairCursor = 0;
      for (const q of questions) {
        const groupKey = `${q.page}|||${q.section || "(empty-section)"}`;
        const expectedCount = expectedByGroup.get(groupKey) ?? 4;
        const optionEntries = Object.entries(q.options) as Array<[ChoiceLetter, string]>;
        const optionCount = optionEntries.length;

        const questionNumber = extractQuestionNumber(q.question);
        const answerMatch = findAnswerLetter(questionNumber, pairs, pairCursor);
        const answerLetter = answerMatch.letter;
        pairCursor = answerMatch.nextIndex;

        const reasons: string[] = [];
        if (optionCount === 0) reasons.push("MISSING_OPTIONS");
        if (optionCount < expectedCount) reasons.push("OPTION_COUNT_LOWER_THAN_PAGE_SECTION");
        if (hasSuspiciousCharacters(q.question)) reasons.push("SUSPICIOUS_QUESTION_TEXT");
        if (optionEntries.some(([, value]) => hasSuspiciousCharacters(value))) {
          reasons.push("SUSPICIOUS_OPTION_TEXT");
        }
        if (!answerLetter) reasons.push("ANSWER_KEY_NOT_MATCHED");

        let answerValue = "";
        const distractorValues: string[] = [];

        if (answerLetter) {
          answerValue = normalizeSpace(String(q.options[answerLetter] || ""));
          if (!answerValue) {
            reasons.push("ANSWER_OPTION_MISSING");
          }
        }

        for (const [letter, optionValue] of optionEntries) {
          if (answerLetter && letter === answerLetter) continue;
          distractorValues.push(normalizeSpace(optionValue));
        }

        if (distractorValues.length === 0) {
          reasons.push("DISTRACTORS_EMPTY");
        }

        if (reasons.length > 0) {
          reviewRows.push({
            source_file: jsonFileName,
            page: q.page,
            section: q.section,
            sentence: q.question,
            options_count: optionCount,
            detected_question_number: questionNumber === null ? "" : String(questionNumber),
            detected_answer_letter: answerLetter || "",
            reason: reasons.join("|"),
          });
          continue;
        }

        mainRows.push({
          sentence: q.question,
          answer: answerValue,
          distractors: distractorValues.join("|"),
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
      "page",
      "section",
      "sentence",
      "options_count",
      "detected_question_number",
      "detected_answer_letter",
      "reason",
    ].join(",");
    const reviewBody = reviewRows
      .map((r) => {
        return [
          r.source_file,
          String(r.page),
          r.section,
          r.sentence,
          String(r.options_count),
          r.detected_question_number,
          r.detected_answer_letter,
          r.reason,
        ]
          .map(csvEscape)
          .join(",");
      })
      .join("\n");
    fs.writeFileSync(reviewCsv, `${reviewHeader}\n${reviewBody}\n`, "utf8");

    console.log(`Done. main_rows=${mainRows.length} -> ${outputCsv}`);
    console.log(`Done. review_rows=${reviewRows.length} -> ${reviewCsv}`);
  })();
}

run().catch((error) => {
  console.error("Failed:", error);
  process.exit(1);
});
