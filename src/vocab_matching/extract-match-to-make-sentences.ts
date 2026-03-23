import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { PDFParse } from "pdf-parse";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type MatchQuestion = {
  page: number;
  section: string;
  questions: Array<{
    num: number;
    text: string;
  }>;
  options: Array<{
    letter: string;
    text: string;
  }>;
};

function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Extract match to make sentences questions
 * Text arrives as lines separated by \n
 * Format:
 * Match to make sentences.
 * 1
 * 2
 * 3
 * I'm not very fond ............
 * She's interested ............
 * ...separator...
 * A
 * B
 * C
 * in playing for the school team.
 * to find enough time to have any hobbies.
 */
function extractMatchQuestions(allPageText: Map<number, string>): MatchQuestion[] {
  const results: MatchQuestion[] = [];

  for (const [page, pageContent] of allPageText) {
    const lines = pageContent.split("\n").map((l) => l.trim()).filter(Boolean);

    // Find "Match to make sentences" header
    const headerIdx = lines.findIndex(
      (l) => l.toLowerCase().includes("match") && l.toLowerCase().includes("sentences")
    );

    if (headerIdx === -1) continue;

    // Parse from header onwards
    let idx = headerIdx + 1;

    // Collect question numbers: 1, 2, 3, ...
    const questionNumbers: number[] = [];
    while (idx < lines.length && /^\d+$/.test(lines[idx])) {
      questionNumbers.push(parseInt(lines[idx], 10));
      idx++;
    }

    if (questionNumbers.length === 0) continue;

    // Collect question stems (lines after numbers until we hit a letter)
    const questionStems: string[] = [];
    while (idx < lines.length && !/^[A-Z]$/.test(lines[idx]) && !/^[A-Z]\s+/.test(lines[idx])) {
      const line = lines[idx];
      // Skip noise/separator lines
      if (line.length > 2 && !line.match(/^[.,;:\-\s]*$/)) {
        questionStems.push(line);
      }
      idx++;
    }

    // Collect answer letters: A, B, C, ...
    const answerLetters: string[] = [];
    while (idx < lines.length && /^[A-Z]$/.test(lines[idx])) {
      answerLetters.push(lines[idx]);
      idx++;
    }

    // Collect answer texts (remaining lines)
    const answerTexts: string[] = [];
    while (idx < lines.length) {
      const line = lines[idx];
      // Stop if we hit another section header or page number
      if (
        /^[A-Z]\s+(Choose|Complete|Find|Rewrite|Match|Write|Word|Phrases|Grammar|Vocabulary)/i.test(
          line
        ) ||
        /^--\s+\d+\s+of\s+\d+\s+--/.test(line)
      ) {
        break;
      }
      if (line.length > 2 && !line.match(/^[.,;:\-\s]*$/)) {
        answerTexts.push(line);
      }
      idx++;
    }

    // Ensure we have matching lengths
    const minLen = Math.min(questionNumbers.length, questionStems.length, answerLetters.length, answerTexts.length);

    if (minLen > 0) {
      const questions = questionStems.slice(0, minLen).map((text, i) => ({
        num: questionNumbers[i],
        text: normalizeText(text),
      }));

      const options = answerTexts.slice(0, minLen).map((text, i) => ({
        letter: answerLetters[i],
        text: normalizeText(text),
      }));

      results.push({
        page,
        section: "Match to make sentences",
        questions,
        options,
      });
    }
  }

  return results;
}

async function processPdf(
  pdfPath: string,
  outputDir: string
): Promise<MatchQuestion[]> {
  console.log(`\nProcessing: ${path.basename(pdfPath)}`);

  const parser = new PDFParse({
    data: new Uint8Array(fs.readFileSync(pdfPath)),
  });

  try {
    const info = await parser.getInfo();
    console.log(`  Total pages: ${info.total}`);

    const pageTextMap = new Map<number, string>();

    // Extract text from each page
    for (let page = 1; page <= info.total; page++) {
      const extracted = await parser.getText({ partial: [page] });
      const pageText = extracted.text || "";
      if (pageText.trim()) {
        pageTextMap.set(page, pageText);
      }
    }

    const questions = extractMatchQuestions(pageTextMap);

    console.log(`  Found ${questions.length} match sets`);

    // Save to JSON
    if (questions.length > 0) {
      const fileName = path
        .basename(pdfPath)
        .replace(".pdf", ".match-questions.json");
      const outputPath = path.join(outputDir, fileName);

      fs.writeFileSync(outputPath, JSON.stringify(questions, null, 2));
      console.log(`  Saved to: ${path.basename(outputPath)}`);
    }

    return questions;
  } finally {
    await parser.destroy();
  }
}

async function main() {
  const outputDir = path.resolve(__dirname, "../../data/destination_text");
  fs.mkdirSync(outputDir, { recursive: true });

  // Process B2 and C1-C2 PDF files from destination_input
  const pdfDir = path.resolve(__dirname, "../../data/destination_input");

  if (!fs.existsSync(pdfDir)) {
    console.error(`Input directory not found: ${pdfDir}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(pdfDir)
    .filter((f) => f.endsWith(".pdf"))
    .sort();

  console.log(`Input: ${pdfDir}`);
  console.log(`Output: ${outputDir}`);
  console.log(`Found ${files.length} PDF files\n`);

  if (files.length === 0) {
    console.error("No PDF files found to process");
    process.exit(1);
  }

  let allQuestions: MatchQuestion[] = [];

  for (const file of files) {
    const pdfPath = path.join(pdfDir, file);
    const questions = await processPdf(pdfPath, outputDir);
    allQuestions = allQuestions.concat(questions);
  }

  // Save combined results
  const combinedPath = path.join(outputDir, "all-match-questions.json");
  fs.writeFileSync(combinedPath, JSON.stringify(allQuestions, null, 2));
  console.log(`\nTotal match sets extracted: ${allQuestions.length}`);
  console.log(`Combined data saved to: ${path.basename(combinedPath)}`);
}

main().catch(console.error);
