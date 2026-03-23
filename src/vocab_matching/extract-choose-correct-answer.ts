import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { PDFParse } from "pdf-parse";

type CliOptions = {
	inputPath: string;
	outputDir: string;
	minExtractedChars: number;
};

type ExtractedQuestion = {
	page: number;
	section: string;
	question: string;
	options: Partial<Record<"A" | "B" | "C" | "D", string>>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_INPUT_PATH = path.resolve(__dirname, "../../data/destination_input");
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, "../../data/destination_text");

function getArgValue(name: string): string | undefined {
	const direct = process.argv.find((arg) => arg.startsWith(`${name}=`));
	if (!direct) return undefined;
	return direct.slice(name.length + 1);
}

function asPositiveInt(value: string | undefined, fallback: number): number {
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return Math.floor(n);
}

function parseCli(): CliOptions {
	const inputPath = process.argv[2] || DEFAULT_INPUT_PATH;

	const resolvedInput = path.resolve(inputPath);
	if (!fs.existsSync(resolvedInput)) {
		throw new Error(`Input not found: ${resolvedInput}`);
	}

	const inputStat = fs.statSync(resolvedInput);
	if (inputStat.isFile() && !resolvedInput.toLowerCase().endsWith(".pdf")) {
		throw new Error(`Input file is not a PDF: ${resolvedInput}`);
	}
	if (!inputStat.isFile() && !inputStat.isDirectory()) {
		throw new Error(`Input must be a PDF file or folder: ${resolvedInput}`);
	}

	const outArg = getArgValue("--out-dir");
	const outputDir = outArg
		? path.resolve(outArg)
		: DEFAULT_OUTPUT_DIR;

	const minExtractedChars = asPositiveInt(getArgValue("--min-text-chars"), 300);

	return {
		inputPath: resolvedInput,
		outputDir,
		minExtractedChars,
	};
}

function getPdfFiles(inputPath: string): string[] {
	const stat = fs.statSync(inputPath);
	if (stat.isFile()) {
		return [inputPath];
	}

	return fs
		.readdirSync(inputPath)
		.filter((name) => name.toLowerCase().endsWith(".pdf"))
		.map((name) => path.join(inputPath, name))
		.sort((a, b) => a.localeCompare(b));
}

function getOutputPath(pdfPath: string, outputDir: string): string {
	const baseName = path.basename(pdfPath, path.extname(pdfPath));
	return path.join(outputDir, `${baseName}.choose-correct-answer.json`);
}

function normalizeText(raw: string): string {
	return raw
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/\u00A0/g, " ")
		.replace(/[\t\f]+/g, " ")
		.replace(/[ ]{2,}/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function cleanQuestionLine(line: string): string {
	return line
		.replace(/^\d{1,3}[.)]?\s+/, "")
		.replace(/^[-.)]\s+/, "")
		.replace(/[ ]{2,}/g, " ")
		.trim();
}

function prepareSectionForQuestionSplit(text: string): string {
	return text
		// Common in 2-column text extraction: tail of one question immediately followed by next number.
		.replace(/([.?!])\s+(\d{1,3}[.)]?\s+[A-Z])/g, "$1\n$2")
		.replace(/([a-z0-9)\]])\s+(\d{1,3}[.)]?\s+[A-Z])/g, "$1\n$2")
		// Keep option labels on dedicated lines when they are flattened inline.
		.replace(/\s+([A-D])\s+(?=[A-Za-z])/g, "\n$1 ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function splitQuestionBlocks(sectionText: string): Array<{ stemSeed: string; lines: string[] }> {
	const pattern = /(?:^|\n)\s*\d{1,3}[.)]?\s+[\s\S]*?(?=(?:\n\s*\d{1,3}[.)]?\s+)|$)/g;
	const matches = [...sectionText.matchAll(pattern)];
	const blocks: Array<{ stemSeed: string; lines: string[] }> = [];

	for (const match of matches) {
		const rawBlock = (match[0] || "").trim();
		if (!rawBlock) continue;

		const blockLines = rawBlock
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);

		if (blockLines.length === 0) continue;

		const first = blockLines[0];
		const qStart = first.match(/^(\d{1,3})[.)]?\s+(.+)$/);
		if (!qStart) continue;

		blocks.push({
			stemSeed: cleanQuestionLine(qStart[2]),
			lines: blockLines.slice(1),
		});
	}

	return blocks;
}

function cleanNoiseText(text: string): string {
	return text
		.replace(/--\s*\d+\s+of\s+\d+\s*--/gi, " ")
		.replace(/\(\d+\s*marks?\s+per\s+answer\)/gi, " ")
		.replace(/[ ]{2,}/g, " ")
		.trim();
}

function trimByNoiseMarkers(text: string): string {
	const marker =
		/(\bWrite one word in each gap\b|\bComplete\b|\bMatch\b|\bFind the extra word\b|\bCircle the correct\b|\bGrammar\b|\bVocabulary\b|\bWord patterns\b|\bWord formation\b|\bPhrasal verbs\b|\bPrepositional phrases\b|\bPhrases and collocations\b)/i;
	const match = marker.exec(text);
	if (!match || match.index < 0) return text;
	return text.slice(0, match.index).trim();
}

function cleanPrompt(rawPrompt: string): string {
	const lines = rawPrompt
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.filter((line) => !/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line))
		.filter((line) => !/^\d+$/.test(line));

	if (lines.length === 0) return "";

	const tail = lines.slice(-3);
	let merged = cleanQuestionLine(cleanNoiseText(tail.join(" ")));

	// If OCR/text-order injects previous question tail (e.g. "... writing 9 Unfortunately ..."),
	// keep only the latest embedded numbered question segment.
	const embeddedMatches = [...merged.matchAll(/\b\d{1,3}[.)]?\s+(?=[A-Z])/g)];
	if (embeddedMatches.length > 0) {
		const last = embeddedMatches[embeddedMatches.length - 1];
		const index = last.index ?? -1;
		if (index > 0) {
			merged = cleanQuestionLine(merged.slice(index));
		}
	}

	return merged;
}

function cleanOptionValue(raw: string): string {
	const trimmed = trimByNoiseMarkers(cleanNoiseText(raw));
	return trimmed.replace(/[ ]{2,}/g, " ").trim();
}

function parseInlineOptions(text: string): Array<{ label: "A" | "B" | "C" | "D"; value: string }> {
	const optionPattern = /\b([A-D])\s+(.+?)(?=(?:\s+[A-D]\s+)|$)/g;
	const matches = [...text.matchAll(optionPattern)];
	const out: Array<{ label: "A" | "B" | "C" | "D"; value: string }> = [];
	for (const match of matches) {
		const label = match[1] as "A" | "B" | "C" | "D";
		const value = cleanOptionValue(match[2] || "");
		if (!value) continue;
		out.push({ label, value });
	}
	return out;
}

function scoreQuestion(q: ExtractedQuestion): number {
	const optionCount = Object.keys(q.options).length;
	const longQuestionPenalty = q.question.length > 260 ? 40 : 0;
	const avgOptionLength =
		optionCount === 0 ? 999 : Object.values(q.options).reduce((acc, v) => acc + String(v || "").length, 0) / optionCount;
	const noisyOptionPenalty = avgOptionLength > 80 ? 40 : 0;
	return optionCount * 100 - longQuestionPenalty - noisyOptionPenalty;
}

function questionKey(question: string): string {
	return question
		.toLowerCase()
		.replace(/\.+/g, "")
		.replace(/[^a-z0-9 ]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 140);
}

function isReasonableOption(value: string): boolean {
	if (!value) return false;
	if (value.length < 1 || value.length > 120) return false;
	if (!/[a-z]/i.test(value)) return false;
	if (/\b[A-D]\b\s+[A-Za-z]/.test(value)) return false;
	return true;
}

function isReasonableQuestion(prompt: string): boolean {
	if (!prompt) return false;
	if (prompt.length < 8 || prompt.length > 260) return false;
	if (/\bA\s+B\s+C\s+D\b/.test(prompt)) return false;
	return true;
}

function extractSectionLabel(headingLine: string): string {
	const match = headingLine.match(/\b([A-J])\s+Choose the correct answer\.?/i);
	if (match) {
		return `${match[1].toUpperCase()} Choose the correct answer`;
	}
	return "Choose the correct answer";
}

function extractQuestionsFromSection(sectionText: string, page: number, section: string): ExtractedQuestion[] {
	const normalizedSection = prepareSectionForQuestionSplit(
		sectionText
		.replace(/\r/g, "\n")
		.replace(/\u00A0/g, " ")
		.replace(/[ \t\f]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim(),
	);

	const blocks = splitQuestionBlocks(normalizedSection);

	const flexibleOut: ExtractedQuestion[] = [];
	for (const block of blocks) {
		const stemParts: string[] = [];
		if (block.stemSeed) {
			stemParts.push(block.stemSeed);
		}

		const options: Partial<Record<"A" | "B" | "C" | "D", string>> = {};
		let activeOption: "A" | "B" | "C" | "D" | null = null;

		for (const line of block.lines) {
			const optionStart = line.match(/^([A-D])\s+(.+)$/);
			if (optionStart) {
				const inlineCandidates = parseInlineOptions(line);
				if (inlineCandidates.length >= 2) {
					for (const opt of inlineCandidates) {
						options[opt.label] = opt.value;
					}
					activeOption = null;
					continue;
				}

				const label = optionStart[1] as "A" | "B" | "C" | "D";
				options[label] = cleanOptionValue(optionStart[2]);
				activeOption = label;
				continue;
			}

			if (activeOption && options[activeOption]) {
				if (/^\d{1,3}[.)]?\s+/.test(line)) {
					activeOption = null;
					stemParts.push(line);
					continue;
				}
				const appended = cleanOptionValue(`${options[activeOption]} ${line}`);
				options[activeOption] = appended;
				continue;
			}

			stemParts.push(line);
		}

		if (Object.keys(options).length < 2) {
			const blockText = [block.stemSeed, ...block.lines].join(" ").replace(/\s+/g, " ").trim();
			const optionMatches = parseInlineOptions(blockText);

			if (optionMatches.length >= 2) {
				const firstPos = blockText.search(/\b[A-D]\s+/);
				const stemRaw = firstPos < 0 ? blockText : blockText.slice(0, firstPos);
				stemParts.length = 0;
				stemParts.push(stemRaw);

				for (const optionMatch of optionMatches) {
					options[optionMatch.label] = optionMatch.value;
				}
			}
		}

		const prompt = cleanPrompt(trimByNoiseMarkers(stemParts.join(" ")));
		if (!isReasonableQuestion(prompt)) continue;
		if (Object.keys(options).length < 2) continue;
		if (Object.values(options).some((value) => !isReasonableOption(String(value || "")))) continue;

		flexibleOut.push({
			page,
			section,
			question: prompt,
			options,
		});
	}

	const strictFourPattern =
		/(?:^|\n)([\s\S]*?)\nA\s+([^\n]+)\nB\s+([^\n]+)\nC\s+([^\n]+)\nD\s+([^\n]+)(?=\n|$)/g;
	const strictOut: ExtractedQuestion[] = [];
	for (const match of normalizedSection.matchAll(strictFourPattern)) {
		const prompt = cleanPrompt(match[1] || "");
		if (!isReasonableQuestion(prompt)) continue;

		const strict: ExtractedQuestion = {
			page,
			section,
			question: prompt,
			options: {
				A: cleanOptionValue(match[2] || ""),
				B: cleanOptionValue(match[3] || ""),
				C: cleanOptionValue(match[4] || ""),
				D: cleanOptionValue(match[5] || ""),
			},
		};

		if (Object.values(strict.options).some((v) => !isReasonableOption(String(v || "")))) continue;
		strictOut.push(strict);
	}

	const candidates = strictOut.length > 0 ? strictOut : flexibleOut;
	const bestByKey = new Map<string, ExtractedQuestion>();
	for (const q of candidates) {
		const key = `${q.page}::${questionKey(q.question)}`;
		const prev = bestByKey.get(key);
		if (!prev || scoreQuestion(q) > scoreQuestion(prev)) {
			bestByKey.set(key, q);
		}
	}

	return [...bestByKey.values()];
}

function splitSectionsWithHeading(pageText: string): Array<{ heading: string; body: string }> {
	const headingPattern = /(^|\n)([^\n]*Choose the correct answer\.?[^\n]*)(?=\n|$)/gi;
	const matches = [...pageText.matchAll(headingPattern)];
	if (matches.length === 0) return [];

	const sections: Array<{ heading: string; body: string }> = [];
	for (let i = 0; i < matches.length; i += 1) {
		const current = matches[i];
		const next = matches[i + 1];
		const heading = (current[2] || "Choose the correct answer").trim();
		const bodyStart = (current.index || 0) + current[0].length;
		const bodyEnd = next?.index ?? pageText.length;
		const bodyRaw = pageText.slice(bodyStart, bodyEnd).trim();
		const body = trimByNoiseMarkers(bodyRaw);
		if (!body) continue;
		sections.push({
			heading,
			body,
		});
	}

	return sections;
}

async function isTextPdf(parser: PDFParse, totalPages: number, minExtractedChars: number): Promise<boolean> {
	const samplePages = Math.min(totalPages, 8);
	let chars = 0;

	for (let page = 1; page <= samplePages; page += 1) {
		const extracted = await parser.getText({ partial: [page] });
		chars += (extracted.text || "").replace(/\s+/g, "").length;
	}

	return chars >= minExtractedChars;
}

async function extractFile(pdfPath: string, outputPath: string, minExtractedChars: number): Promise<number> {
	const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(pdfPath)) });

	try {
		const info = await parser.getInfo();
		const hasTextLayer = await isTextPdf(parser, info.total, minExtractedChars);

		if (!hasTextLayer) {
			console.log(`Skip non-text PDF: ${path.basename(pdfPath)} (run OCR first)`);
			return 0;
		}

		const questions: ExtractedQuestion[] = [];

		for (let page = 1; page <= info.total; page += 1) {
			const extracted = await parser.getText({ partial: [page] });
			const pageText = normalizeText(extracted.text || "");
			if (!/Choose the correct answer/i.test(pageText)) continue;

			const sections = splitSectionsWithHeading(pageText);
			for (const section of sections) {
				const sectionName = extractSectionLabel(section.heading);
				questions.push(...extractQuestionsFromSection(section.body, page, sectionName));
			}
		}

		fs.writeFileSync(outputPath, JSON.stringify(questions, null, 2), "utf8");

		console.log(`Input: ${pdfPath}`);
		console.log(`Output: ${outputPath}`);
		console.log(`Extracted questions: ${questions.length}`);
		return questions.length;
	} finally {
		await parser.destroy();
	}
}

async function run(): Promise<void> {
	const options = parseCli();
	const pdfFiles = getPdfFiles(options.inputPath);
	if (pdfFiles.length === 0) {
		throw new Error(`No PDF files found in: ${options.inputPath}`);
	}

	fs.mkdirSync(options.outputDir, { recursive: true });

	let total = 0;
	for (const pdfPath of pdfFiles) {
		const outputPath = getOutputPath(pdfPath, options.outputDir);
		total += await extractFile(pdfPath, outputPath, options.minExtractedChars);
	}

	console.log(`Done. Processed files: ${pdfFiles.length}`);
	console.log(`Done. Total extracted questions: ${total}`);
}

run().catch((error) => {
	console.error("Failed to extract questions:", error);
	process.exit(1);
});
