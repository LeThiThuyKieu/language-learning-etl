import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { PDFParse } from "pdf-parse";

type CliOptions = {
	inputPath: string;
	outputDir: string;
	minExtractedChars: number;
	startPage: number;
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
	const startPage = Math.max(1, asPositiveInt(getArgValue("--start-page"), 1));

	return {
		inputPath: resolvedInput,
		outputDir,
		minExtractedChars,
		startPage,
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
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/\u00A0/g, " ")
		.replace(/[ \t\f]+/g, " ")
		// tách số câu rõ hơn
		.replace(/(?<!\n)(\b\d{1,3}[.)]?\s+[A-Z])/g, "\n$1")
		// tách các mở đầu câu điển hình (That's, I've, It's, He's, She's, We've, They've, etc.)
		.replace(/\s+([TIHSWYwt][''][A-Za-z])/g, "\n$1")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function splitQuestionBlocks(sectionText: string): Array<{ stemSeed: string; lines: string[] }> {
	const normalized = sectionText
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	const blocks: Array<{ stemSeed: string; lines: string[] }> = [];

	const pattern = /(?:^|\n)\s*(\d{1,3})[.)]?\s+([\s\S]*?)(?=(?:\n\s*\d{1,3}[.)]?\s+)|$)/g;
	for (const match of normalized.matchAll(pattern)) {
		const content = (match[2] || "").trim();
		if (!content) continue;

		const lines = content
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);

		if (lines.length === 0) continue;

		blocks.push({
			stemSeed: "",
			lines,
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
		/(\bWrite one word in each gap\b|\bMatch\b|\bFind the extra word\b|\bWord formation\b|\bPhrasal verbs\b|\bPrepositional phrases\b|\bPhrases and collocations\b)/i;

	const match = marker.exec(text);
	if (!match || match.index < 0) return text;
	return text.slice(0, match.index).trim();
}

function cleanPrompt(rawPrompt: string): string {
	let merged = rawPrompt
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.filter((line) => !/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line))
		.filter((line) => !/^\d+$/.test(line))
		.join(" ");

	merged = cleanQuestionLine(cleanNoiseText(merged));

	// Nếu bị lẫn question number cũ do thứ tự text lỗi, lấy đoạn cuối cùng bắt đầu bằng số
	const embeddedMatches = [...merged.matchAll(/\b\d{1,3}[.)]?\s+(?=[A-Z])/g)];
	if (embeddedMatches.length > 1) {
		const last = embeddedMatches[embeddedMatches.length - 1];
		const index = last.index ?? -1;
		if (index > 0) {
			merged = cleanQuestionLine(merged.slice(index));
		}
	}

	return merged.replace(/[ ]{2,}/g, " ").trim();
}

function splitMergedPrompts(prompt: string): string[] {
	const normalized = prompt.replace(/[ ]{2,}/g, " ").trim();
	if (!normalized) return [];

	const blankCount = (normalized.match(/\.{3,}/g) || []).length;
	if (blankCount < 2) return [normalized];

	const parts = normalized
		.split(/(?<=[?!.])\s+(?=[A-Z])/)
		.map((part) => part.trim())
		.filter(Boolean)
		.filter((part) => part.length >= 6)
		.filter((part) => /\.{3,}|\?/.test(part));

	if (parts.length <= 1) return [normalized];
	return parts.slice(0, 4);
}

function cleanOptionValue(raw: string): string {
	let trimmed = trimByNoiseMarkers(cleanNoiseText(raw));

	// Khi PDF nhiều cột bị trộn, option thường bị dính prompt kế tiếp có dạng chỗ trống .......
	const blankMarkerIndex = trimmed.search(/\.{4,}/);
	if (blankMarkerIndex > 0) {
		trimmed = trimmed.slice(0, blankMarkerIndex).trim();
	}

	// Cắt phần text bị tràn sau số thứ tự câu mới.
	const nextQuestionIndex = trimmed.search(/\s\d{1,3}[.)]?\s+[A-Z]/);
	if (nextQuestionIndex > 0) {
		trimmed = trimmed.slice(0, nextQuestionIndex).trim();
	}

	// Nếu sau đáp án ngắn xuất hiện cụm viết hoa mở đầu câu mới, giữ lại phần đáp án phía trước.
	const sentenceSpillIndex = trimmed.search(/\s+[A-Z][a-z]{2,}\s+[a-z]/);
	if (sentenceSpillIndex > 0) {
		const prefixWordCount = trimmed.slice(0, sentenceSpillIndex).trim().split(/\s+/).length;
		if (prefixWordCount <= 4) {
			trimmed = trimmed.slice(0, sentenceSpillIndex).trim();
		}
	}

	// OCR đôi khi chèn số câu vào giữa option, ví dụ "amusing3 People...".
	const digitSpillIndex = trimmed.search(/\d+\s+[A-Z]/);
	if (digitSpillIndex > 0) {
		trimmed = trimmed.slice(0, digitSpillIndex).trim();
	}

	// Loại đuôi bị dính ví dụ: "... 'Colin's got to stay..."
	const quoteSpillIndex = trimmed.search(/\s['"][A-Z]/);
	if (quoteSpillIndex > 0) {
		trimmed = trimmed.slice(0, quoteSpillIndex).trim();
	}

	return trimmed.replace(/[ ]{2,}/g, " ").trim();
}

function parseInlineOptions(text: string): Array<{ label: "A" | "B" | "C" | "D"; value: string }> {
	const optionPattern = /\b([A-D])[.)]?\s+(.+?)(?=(?:\s+[A-D][.)]?\s+)|(?:\s+\d{1,3}[.)]?\s+[A-Z])|$)/g;
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
	if (/^[A-D]$/i.test(value.trim())) return false;
	if (!/[a-z]/i.test(value)) return false;
	return true;
}

function hasSuspiciousInlineOptions(options: Array<{ label: "A" | "B" | "C" | "D"; value: string }>): boolean {
	if (options.length < 2) return true;
	const singleLetterValues = options.filter((opt) => /^[A-D]$/i.test(opt.value.trim())).length;
	return singleLetterValues >= 1;
}

function isReasonableQuestion(prompt: string): boolean {
	if (!prompt) return false;
	if (prompt.length < 6 || prompt.length > 320) return false;
	if (/^\(?[A-D]\)?$/.test(prompt)) return false;
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
	const out: ExtractedQuestion[] = [];

	for (const block of blocks) {
		const rawText = block.lines.join("\n");

		// Ưu tiên parse theo A/B/C/D trên dòng riêng
		const lines = rawText
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);

		const stemParts: string[] = [];
		const options: Partial<Record<"A" | "B" | "C" | "D", string>> = {};
		let activeOption: "A" | "B" | "C" | "D" | null = null;
		let seenOption = false;
		const pendingLabels: Array<"A" | "B" | "C" | "D"> = [];

		for (const line of lines) {
			// OCR cột đôi hay xuất ra A/B/C/D ở dòng riêng, sau đó mới đến nội dung đáp án.
			const labelOnly = line.match(/^([A-D])[.)]?$/);
			if (labelOnly) {
				pendingLabels.push(labelOnly[1] as "A" | "B" | "C" | "D");
				seenOption = true;
				activeOption = null;
				continue;
			}

			if (pendingLabels.length > 0) {
				const label = pendingLabels.shift() as "A" | "B" | "C" | "D";
				if (!options[label]) {
					options[label] = cleanOptionValue(line);
				}
				activeOption = null;
				seenOption = true;
				continue;
			}

			// Ưu tiên tách đáp án inline trước để tránh cả cụm A/B/C/D bị nhét vào 1 option.
			const inlineCandidates = parseInlineOptions(line);
			if (inlineCandidates.length >= 2 && !hasSuspiciousInlineOptions(inlineCandidates)) {
				for (const opt of inlineCandidates) {
					options[opt.label] = opt.value;
				}
				activeOption = null;
				seenOption = true;
				continue;
			}

			const optionStart = line.match(/^([A-D])[.)]?\s+(.+)$/);
			if (optionStart) {
				const label = optionStart[1] as "A" | "B" | "C" | "D";
				options[label] = cleanOptionValue(optionStart[2]);
				activeOption = label;
				seenOption = true;
				continue;
			}

			if (!seenOption) {
				stemParts.push(line);
				continue;
			}

			// Text nhiều cột thường kéo sang câu kế tiếp trong cùng block, bỏ đoạn này để tránh bẩn option.
			if (/^\d{1,3}[.)]?\s+[A-Z]/.test(line) || /choose the correct answer/i.test(line)) {
				activeOption = null;
				continue;
			}

			if (activeOption) {
				options[activeOption] = cleanOptionValue(`${options[activeOption] || ""} ${line}`);
			}
		}

		// fallback: parse toàn block
		if (Object.keys(options).length < 2) {
			const flatText = rawText.replace(/\s+/g, " ").trim();
			const inlineMatches = parseInlineOptions(flatText);

			if (inlineMatches.length >= 2 && !hasSuspiciousInlineOptions(inlineMatches)) {
				const firstOpt = flatText.search(/\bA\s+/);
				const promptRaw = firstOpt >= 0 ? flatText.slice(0, firstOpt) : flatText;

				stemParts.length = 0;
				stemParts.push(promptRaw);

				for (const opt of inlineMatches) {
					options[opt.label] = opt.value;
				}
			}
		}

		const prompt = cleanPrompt(trimByNoiseMarkers(stemParts.join(" ")));

		if (!isReasonableQuestion(prompt)) continue;
		const promptVariants = splitMergedPrompts(prompt);
		if (promptVariants.length === 0) continue;

		const cleanedOptions: Partial<Record<"A" | "B" | "C" | "D", string>> = {};
		for (const label of ["A", "B", "C", "D"] as const) {
			const value = cleanOptionValue(String(options[label] || ""));
			if (!isReasonableOption(value)) continue;
			cleanedOptions[label] = value;
		}

		for (const variant of promptVariants) {
			if (!isReasonableQuestion(variant)) continue;
			out.push({
				page,
				section,
				question: variant,
				options: cleanedOptions,
			});
		}
	}

	const bestByKey = new Map<string, ExtractedQuestion>();
	for (const q of out) {
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

function looksLikeChooseCorrectContinuation(pageText: string): boolean {
	const text = pageText || "";
	const questionStarts = (text.match(/(^|\n)\s*\d{1,3}[.)]?(\s+|\n)/g) || []).length;
	const optionMarkers = (text.match(/(^|\n)\s*[A-D][.)]?\s*($|\n)/g) || []).length;
	const inlineOptionPairs = (text.match(/\bA[.)]?\s+[^\n]{1,40}\s+B[.)]?\s+/g) || []).length;

	return questionStarts >= 3 && (optionMarkers >= 8 || inlineOptionPairs >= 1);
}

async function isTextPdf(parser: PDFParse, totalPages: number, minExtractedChars: number, startPage: number): Promise<boolean> {
	if (startPage > totalPages) return false;
	const samplePages = Math.min(totalPages - startPage + 1, 8);
	let chars = 0;

	for (let page = startPage; page < startPage + samplePages; page += 1) {
		const extracted = await parser.getText({ partial: [page] });
		chars += (extracted.text || "").replace(/\s+/g, "").length;
	}

	return chars >= minExtractedChars;
}

async function extractFile(pdfPath: string, outputPath: string, minExtractedChars: number, startPage: number): Promise<number> {
	const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(pdfPath)) });

	try {
		const info = await parser.getInfo();
		const hasTextLayer = await isTextPdf(parser, info.total, minExtractedChars, startPage);

		if (!hasTextLayer) {
			console.log(`Skip non-text PDF: ${path.basename(pdfPath)} (run OCR first)`);
			return 0;
		}

		const questions: ExtractedQuestion[] = [];
		let lastSectionName: string | null = null;

		for (let page = Math.max(1, startPage); page <= info.total; page += 1) {
			const extracted = await parser.getText({ partial: [page] });
			const pageText = normalizeText(extracted.text || "");

			const sections = splitSectionsWithHeading(pageText);
			if (sections.length > 0) {
				for (const section of sections) {
					const sectionName = extractSectionLabel(section.heading);
					lastSectionName = sectionName;
					questions.push(...extractQuestionsFromSection(section.body, page, sectionName));
				}
				continue;
			}

			if (lastSectionName && looksLikeChooseCorrectContinuation(pageText)) {
				questions.push(...extractQuestionsFromSection(pageText, page, lastSectionName));
				continue;
			}

			lastSectionName = null;
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
		total += await extractFile(pdfPath, outputPath, options.minExtractedChars, options.startPage);
	}

	console.log(`Done. Processed files: ${pdfFiles.length}`);
	console.log(`Done. Total extracted questions: ${total}`);
}

run().catch((error) => {
	console.error("Failed to extract questions:", error);
	process.exit(1);
});
