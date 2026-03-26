import fs from "fs";
import path from "path";

type Difficulty = "easy" | "medium" | "hard";

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
  full_text: string;
  answer: string;
  audio: string;
  difficulty: Difficulty;
};

const INPUT_DIR = path.resolve(process.cwd(), "data/listening");
const OUTPUT_FILE = path.resolve(process.cwd(), "data/archive/listening_raw_from_json.csv");

const FILE_DIFFICULTY_MAP: Record<string, Difficulty> = {
  "basic.json": "easy",
  "developing.json": "medium",
  "expanding.json": "hard",
};

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

function parseFile(fileName: string, difficulty: Difficulty): OutputRow[] {
  const filePath = path.join(INPUT_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    console.warn(`Skip missing file: ${filePath}`);
    return [];
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const items = JSON.parse(raw) as ListeningItem[];

  const rows: OutputRow[] = [];

  for (const item of items) {
    const originalGappedText = normalizeText(String(item.gapped_text || ""));
    if (!originalGappedText) {
      continue;
    }

    const answers = (item.blanks || [])
      .map((blank) => String(blank?.answer || "").trim())
      .filter((ans) => ans.length > 0);

    const gappedWithNumber = numberGaps(originalGappedText);
    const fullText = buildFullText(originalGappedText, answers);

    rows.push({
      gapped_text: toLiteralNewline(gappedWithNumber),
      full_text: toLiteralNewline(fullText),
      answer: flattenAnswers(answers),
      audio: String(item.audio || "").trim(),
      difficulty,
    });
  }

  return rows;
}

function writeCsv(rows: OutputRow[], outputPath: string): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const header = ["gapped_text", "full_text", "answer", "audio", "difficulty"].join(",");
  const body = rows
    .map((row) => {
      return [row.gapped_text, row.full_text, row.answer, row.audio, row.difficulty]
        .map(csvEscape)
        .join(",");
    })
    .join("\n");

  const content = body ? `${header}\n${body}\n` : `${header}\n`;
  fs.writeFileSync(outputPath, content, "utf-8");
}

function main(): void {
  const allRows: OutputRow[] = [];

  for (const [fileName, difficulty] of Object.entries(FILE_DIFFICULTY_MAP)) {
    const rows = parseFile(fileName, difficulty);
    allRows.push(...rows);
    console.log(`Processed ${fileName}: ${rows.length} rows`);
  }

  writeCsv(allRows, OUTPUT_FILE);
  console.log(`Done. total_rows=${allRows.length} -> ${OUTPUT_FILE}`);
}

main();