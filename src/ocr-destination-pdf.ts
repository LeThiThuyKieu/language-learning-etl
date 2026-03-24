import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { PDFParse } from "pdf-parse";
import { createWorker, PSM } from "tesseract.js";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_INPUT = path.resolve(__dirname, "../data/archive/destination");
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, "../data/destination_text");

type CliOptions = {
	inputPath: string;
	start: number;
	end?: number;
	maxPages?: number;
	stride: number;
	width: number;
	outDir: string;
	force: boolean;
	lang: string;
	psm: PSM;
	debug: boolean;
	debugDir: string;
	minTextChars: number;
};

type OcrLine = {
	text: string;
	x0: number;
	x1: number;
	y0: number;
	y1: number;
};

type RecognizeResult = {
	rawText: string;
	lines: OcrLine[];
};

type ImageRegion = {
	name: string;
	buffer: Buffer;
};

type ColumnDetection =
	| {
			columns: 1;
			confidence: number;
	  }
	| {
			columns: 2;
			splitX: number;
			confidence: number;
	  };

function getArgValue(name: string): string | undefined {
	const direct = process.argv.find((arg) => arg.startsWith(`${name}=`));
	if (!direct) return undefined;
	return direct.slice(name.length + 1);
}

function hasFlag(name: string): boolean {
	return process.argv.includes(name);
}

function asPositiveInt(value: string | undefined, fallback: number): number {
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return Math.floor(n);
}

function asPsm(value: string | undefined, fallback: PSM): PSM {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	const normalized = Math.floor(n);
	if (normalized < 0 || normalized > 13) return fallback;
	return normalized as unknown as PSM;
}

function parseCli(): CliOptions {
	const inputPath = process.argv[2] || DEFAULT_INPUT;
	const start = asPositiveInt(getArgValue("--start"), 1);
	const endRaw = getArgValue("--end");
	const maxPagesRaw = getArgValue("--max-pages");
	const stride = asPositiveInt(getArgValue("--stride"), 1);
	const width = asPositiveInt(getArgValue("--width"), 2600);
	const outDir = getArgValue("--out-dir") || DEFAULT_OUTPUT_DIR;
	const lang = getArgValue("--lang") || "eng";
	const psmRaw = getArgValue("--psm");
	const debug = hasFlag("--debug");
	const debugDir = getArgValue("--debug-dir") || path.join(outDir, "_debug");
	const minTextChars = asPositiveInt(getArgValue("--min-text-chars"), 30);
	const psm = asPsm(psmRaw, PSM.AUTO);
	const force = hasFlag("--force");

	return {
		inputPath,
		start,
		end: endRaw ? asPositiveInt(endRaw, start) : undefined,
		maxPages: maxPagesRaw ? asPositiveInt(maxPagesRaw, 0) : undefined,
		stride,
		width,
		outDir,
		force,
		lang,
		psm,
		debug,
		debugDir,
		minTextChars,
	};
}

function ensureDir(dirPath: string): void {
	fs.mkdirSync(dirPath, { recursive: true });
}

function getPdfFiles(inputPath: string): string[] {
	if (!fs.existsSync(inputPath)) {
		throw new Error(`Not found: ${inputPath}`);
	}

	const stat = fs.statSync(inputPath);
	if (stat.isFile()) {
		if (!inputPath.toLowerCase().endsWith(".pdf")) {
			throw new Error(`Input file is not a PDF: ${inputPath}`);
		}
		return [inputPath];
	}

	return fs
		.readdirSync(inputPath)
		.filter((name) => name.toLowerCase().endsWith(".pdf"))
		.map((name) => path.join(inputPath, name))
		.sort((a, b) => a.localeCompare(b));
}

function toSidecarPath(pdfPath: string, outDir: string): string {
	const baseName = path.basename(pdfPath).replace(/\.pdf$/i, ".txt");
	return path.join(outDir, baseName);
}

function toDebugBase(pdfPath: string, page: number, debugDir: string): string {
	const baseName = path.basename(pdfPath, path.extname(pdfPath));
	return path.join(debugDir, `${baseName}_page_${page}`);
}

function buildPageList(total: number, options: CliOptions): number[] {
	const from = Math.max(1, options.start);
	const to = Math.max(from, Math.min(total, options.end || total));

	const pages: number[] = [];
	for (let page = from; page <= to; page += options.stride) {
		pages.push(page);
		if (options.maxPages && pages.length >= options.maxPages) {
			break;
		}
	}
	return pages;
}

function basicNormalize(text: string): string {
	return text
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/\u00A0/g, " ")
		.replace(/[ \t\f]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Chỉ sửa lỗi OCR cấu trúc an toàn.
 * Không sửa nghĩa tiếng Anh quá nhiều để tránh phá câu.
 */
function structureNormalizeSafe(text: string): string {
	return text
		.replace(/[“”]/g, '"')
		.replace(/[‘’]/g, "'")
		.replace(/[‐-–—]/g, "-")
		.replace(/\.{4,}/g, "...")
		.replace(/\b([A-Za-z])\s+([A-Za-z])\b/g, (m, a, b) => {
			// giữ nguyên kiểu "A B" vì có thể là label, không gộp bừa
			return `${a} ${b}`;
		})
		.replace(/\b([A-Za-z])(\d)\b/g, "$1 $2")
		.replace(/\b(\d)([A-Za-z])\b/g, "$1 $2")
		.replace(/\s+([,.!?;:])/g, "$1");
}

/**
 * Chỉ fix vài lỗi OCR rất phổ biến, nhưng hạn chế sửa quá tay.
 */
const COMMON_OCR_FIXES: Array<[RegExp, string]> = [
	[/\bItsthe\b/g, "It's the"],
	[/\bIve\b/g, "I've"],
	[/\bIm\b/g, "I'm"],
	[/\bIdont\b/gi, "I don't"],
	[/\bdont\b/gi, "don't"],
	[/\bcant\b/gi, "can't"],
	[/\bwont\b/gi, "won't"],
	[/\byoure\b/gi, "you're"],
	[/\bhes\b/gi, "he's"],
	[/\bshes\b/gi, "she's"],
];

function postCorrectLight(text: string): string {
	let out = text;
	for (const [pattern, replacement] of COMMON_OCR_FIXES) {
		out = out.replace(pattern, replacement);
	}

	return out
		.replace(/\b0f\b/g, "of")
		.replace(/\b1\b(?=\s+[a-z]{2,})/g, "I");
}

function removeHeaderFooterNoise(text: string): string {
	return text
		.split("\n")
		.filter((line) => {
			const t = line.trim();
			if (!t) return true;

			if (/^\d+$/.test(t)) return false;
			if (/^Unit\s+\d+/i.test(t)) return false;
			if (/^Units?\s+\d+(\s+and\s+\d+)?/i.test(t)) return false;
			if (/^Present simple/i.test(t)) return false;
			if (/^Present perfect/i.test(t)) return false;
			if (/^Travel and transport/i.test(t)) return false;
			if (/^Topic vocabulary/i.test(t)) return false;
			if (/^Phrasal verbs$/i.test(t)) return false;
			if (/^Phrases and collocations$/i.test(t)) return false;
			if (/^Word patterns$/i.test(t)) return false;
			if (/^Word formation$/i.test(t)) return false;
			if (/^Total mark:/i.test(t)) return false;
			if (/^\[\d+\s*mark/i.test(t)) return false;
			if (/^®\s*/.test(t)) return false;

			return true;
		})
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function isOptionLine(line: string): boolean {
	return /^[A-D]\s+/.test(line.trim());
}

function isQuestionStart(line: string): boolean {
	return /^\d{1,3}\s+/.test(line.trim());
}

function isSectionHeader(line: string): boolean {
	return /^[A-J]\s/.test(line.trim()) || /^[A-J]$/.test(line.trim());
}

/**
 * Tách số câu chỉ khi khá chắc đó là đầu câu.
 * Tránh tách bừa các số nằm trong nội dung.
 */
function separateQuestionNumbersSafe(text: string): string {
	return text
		.replace(/([.?!])\s+(\d{1,3}\s+[A-Z][^\n]*)/g, "$1\n$2")
		.replace(/([a-z])\s+(\d{1,3}\s+[A-Z][^\n]*)/g, "$1\n$2")
		.replace(/\n{3,}/g, "\n\n");
}

/**
 * Tách lựa chọn A/B/C/D an toàn hơn.
 * Chỉ chèn newline khi sau A/B/C/D là text dài, tránh làm hỏng từ viết hoa.
 */
function separateAnswerChoicesSafe(text: string): string {
	return text
		.replace(/([^\n])\s+([A-D])\s+([A-Z][A-Za-z'(),/-]{2,})/g, "$1\n$2 $3")
		.replace(/\n{3,}/g, "\n\n");
}

/**
 * Gom các line bị vỡ của cùng một câu hỏi / option.
 * Đây là bước rất quan trọng cho trắc nghiệm + matching.
 */
function joinBrokenExerciseLines(text: string): string {
	const lines = text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	const merged: string[] = [];

	for (const line of lines) {
		if (merged.length === 0) {
			merged.push(line);
			continue;
		}

		const prev = merged[merged.length - 1];

		if (
			isSectionHeader(line) ||
			isQuestionStart(line) ||
			isOptionLine(line) ||
			/^[A-J]\s+[A-Z]/.test(line)
		) {
			merged.push(line);
			continue;
		}

		if (
			/[:;,.?!]$/.test(prev) ||
			prev.endsWith("...") ||
			/[a-z0-9)\]]$/.test(prev)
		) {
			merged[merged.length - 1] = `${prev} ${line}`;
			continue;
		}

		merged.push(line);
	}

	return merged.join("\n");
}

/**
 * Chuẩn hóa nhẹ các line option để parser dễ đọc hơn.
 */
function normalizeOptionLabels(text: string): string {
	return text
		.replace(/^\s*([A-D])([A-Za-z])/gm, "$1 $2")
		.replace(/^\s*(\d{1,3})([A-Za-z])/gm, "$1 $2");
}

/**
 * Gom pipeline normalize thiên về cấu trúc.
 */
function normalize(text: string): string {
	return joinBrokenExerciseLines(
		normalizeOptionLabels(
			removeHeaderFooterNoise(
				separateAnswerChoicesSafe(
					separateQuestionNumbersSafe(
						postCorrectLight(structureNormalizeSafe(basicNormalize(text))),
					),
				),
			),
		),
	).trim();
}

function extractOcrLines(lines: unknown[]): OcrLine[] {
	const out: OcrLine[] = [];
	for (const item of lines) {
		if (!item || typeof item !== "object") continue;

		const line = item as {
			text?: unknown;
			bbox?: { x0?: unknown; x1?: unknown; y0?: unknown; y1?: unknown };
		};

		if (!line.bbox) continue;

		const text = String(line.text || "").trim();
		const x0 = Number(line.bbox.x0);
		const x1 = Number(line.bbox.x1);
		const y0 = Number(line.bbox.y0);
		const y1 = Number(line.bbox.y1);

		if (!text) continue;
		if (![x0, x1, y0, y1].every(Number.isFinite)) continue;

		out.push({ text, x0, x1, y0, y1 });
	}
	return out;
}

function normalizeLineText(text: string): string {
	return text.replace(/[ \t]+/g, " ").trim();
}

function sortLinesReadingOrder(lines: OcrLine[]): OcrLine[] {
	return [...lines].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

function joinLinesInReadingOrder(lines: OcrLine[]): string {
	if (lines.length === 0) return "";

	const sorted = sortLinesReadingOrder(lines);
	const chunks: string[] = [];
	let prevY1 = sorted[0].y1;

	for (const line of sorted) {
		const gap = line.y0 - prevY1;
		if (gap > 18) {
			chunks.push("");
		}
		chunks.push(normalizeLineText(line.text));
		prevY1 = line.y1;
	}

	return chunks.join("\n");
}

function buildXHistogram(lines: OcrLine[], bins = 80): number[] {
	if (lines.length === 0) return [];

	const minX = Math.min(...lines.map((line) => line.x0));
	const maxX = Math.max(...lines.map((line) => line.x1));
	const span = Math.max(1, maxX - minX);
	const hist = new Array<number>(bins).fill(0);

	for (const line of lines) {
		const left = Math.max(0, Math.floor(((line.x0 - minX) / span) * bins));
		const right = Math.min(bins - 1, Math.floor(((line.x1 - minX) / span) * bins));
		for (let i = left; i <= right; i += 1) {
			hist[i] += 1;
		}
	}

	return hist;
}

function detectColumns(lines: OcrLine[]): ColumnDetection {
	if (lines.length < 8) {
		return { columns: 1, confidence: 0 };
	}

	const hist = buildXHistogram(lines, 100);
	if (hist.length < 10) {
		return { columns: 1, confidence: 0 };
	}

	let bestStart = -1;
	let bestEnd = -1;
	let currentStart = -1;

	const threshold = Math.max(1, Math.floor(lines.length * 0.04));

	for (let i = 0; i < hist.length; i += 1) {
		const isLow = hist[i] <= threshold;

		if (isLow && currentStart < 0) {
			currentStart = i;
		}

		if (!isLow && currentStart >= 0) {
			if (currentStart > hist.length * 0.2 && i < hist.length * 0.8) {
				if (i - currentStart > bestEnd - bestStart) {
					bestStart = currentStart;
					bestEnd = i;
				}
			}
			currentStart = -1;
		}
	}

	if (currentStart >= 0) {
		const end = hist.length;
		if (currentStart > hist.length * 0.2 && end < hist.length * 0.8) {
			if (end - currentStart > bestEnd - bestStart) {
				bestStart = currentStart;
				bestEnd = end;
			}
		}
	}

	if (bestStart < 0 || bestEnd < 0) {
		return { columns: 1, confidence: 0.2 };
	}

	const minX = Math.min(...lines.map((line) => line.x0));
	const maxX = Math.max(...lines.map((line) => line.x1));
	const span = Math.max(1, maxX - minX);

	const splitRatio = (bestStart + bestEnd) / 2 / hist.length;
	const splitX = minX + splitRatio * span;
	const gapWidthRatio = (bestEnd - bestStart) / hist.length;

	const leftCount = lines.filter((line) => (line.x0 + line.x1) / 2 < splitX).length;
	const rightCount = lines.filter((line) => (line.x0 + line.x1) / 2 >= splitX).length;
	const balance = Math.min(leftCount, rightCount) / Math.max(1, Math.max(leftCount, rightCount));

	if (gapWidthRatio >= 0.08 && balance >= 0.2) {
		return {
			columns: 2,
			splitX,
			confidence: Math.min(1, gapWidthRatio + balance / 2),
		};
	}

	return { columns: 1, confidence: 0.35 };
}

function splitLinesByDetectedColumns(lines: OcrLine[]): OcrLine[][] {
	if (lines.length === 0) return [];

	const detection = detectColumns(lines);
	if (detection.columns === 1) {
		return [lines];
	}

	const splitX = detection.splitX;
	const left = lines.filter((line) => (line.x0 + line.x1) / 2 < splitX);
	const right = lines.filter((line) => (line.x0 + line.x1) / 2 >= splitX);

	return [left, right].filter((bucket) => bucket.length > 0);
}

function reorderColumnsFromLines(lines: OcrLine[]): string {
	if (lines.length === 0) return "";
	const buckets = splitLinesByDetectedColumns(lines);
	return buckets.map((bucket) => joinLinesInReadingOrder(bucket)).filter(Boolean).join("\n\n");
}

async function saveDebugFile(filePath: string, content: string | Buffer): Promise<void> {
	ensureDir(path.dirname(filePath));
	if (typeof content === "string") {
		await fs.promises.writeFile(filePath, content, "utf8");
		return;
	}
	await fs.promises.writeFile(filePath, content);
}

async function recognizeImageRegion(
	worker: Awaited<ReturnType<typeof createWorker>>,
	imageData: Buffer,
	psm: PSM,
): Promise<RecognizeResult> {
	await worker.setParameters({
		tessedit_pageseg_mode: psm,
	});

	const recognized = await worker.recognize(imageData);
	const rawText = String(recognized.data.text || "");
	const pageData = recognized.data as unknown as { lines?: unknown[] };
	const rawLines = Array.isArray(pageData.lines) ? pageData.lines : [];
	const lines = extractOcrLines(rawLines);

	return { rawText, lines };
}

async function cropImageIntoTwoColumns(imageData: Buffer): Promise<ImageRegion[]> {
	const image = sharp(imageData);
	const meta = await image.metadata();
	const width = meta.width ?? 0;
	const height = meta.height ?? 0;

	if (!width || !height) {
		return [{ name: "full", buffer: imageData }];
	}

	const overlap = Math.max(12, Math.floor(width * 0.01));
	const middle = Math.floor(width / 2);

	const left = await image
		.clone()
		.extract({
			left: 0,
			top: 0,
			width: Math.min(width, middle + overlap),
			height,
		})
		.png()
		.toBuffer();

	const right = await image
		.clone()
		.extract({
			left: Math.max(0, middle - overlap),
			top: 0,
			width: width - Math.max(0, middle - overlap),
			height,
		})
		.png()
		.toBuffer();

	return [
		{ name: "col_1", buffer: left },
		{ name: "col_2", buffer: right },
	];
}

async function preprocessImageForOcr(imageData: Buffer): Promise<Buffer> {
	return sharp(imageData)
		.grayscale()
		.normalize()
		.sharpen()
		.png()
		.toBuffer();
}

async function ocrByForcedTwoColumns(
	worker: Awaited<ReturnType<typeof createWorker>>,
	imageData: Buffer,
	options: CliOptions,
	debugBase?: string,
): Promise<string> {
	const regions = await cropImageIntoTwoColumns(imageData);
	const outputs: string[] = [];

	for (const region of regions) {
		const prepared = await preprocessImageForOcr(region.buffer);

		if (options.debug && debugBase) {
			await saveDebugFile(`${debugBase}.${region.name}.png`, prepared);
		}

		const result = await recognizeImageRegion(worker, prepared, PSM.SINGLE_COLUMN);
		const text = result.lines.length > 0 ? joinLinesInReadingOrder(result.lines) : result.rawText;

		if (options.debug && debugBase) {
			await saveDebugFile(`${debugBase}.${region.name}.raw.txt`, result.rawText);
			await saveDebugFile(`${debugBase}.${region.name}.ordered.txt`, text);
		}

		outputs.push(text);
	}

	return normalize(outputs.filter(Boolean).join("\n\n"));
}

async function ocrWholePageAutoColumns(
	worker: Awaited<ReturnType<typeof createWorker>>,
	imageData: Buffer,
	options: CliOptions,
	debugBase?: string,
): Promise<string> {
	const prepared = await preprocessImageForOcr(imageData);
	const result = await recognizeImageRegion(worker, prepared, options.psm);
	const reordered = result.lines.length > 0 ? reorderColumnsFromLines(result.lines) : result.rawText;
	const cleaned = normalize(reordered);

	if (options.debug && debugBase) {
		const detection = detectColumns(result.lines);
		await saveDebugFile(`${debugBase}.full.png`, prepared);
		await saveDebugFile(`${debugBase}.full.raw.txt`, result.rawText);
		await saveDebugFile(`${debugBase}.full.ordered.txt`, reordered);
		await saveDebugFile(`${debugBase}.full.cleaned.txt`, cleaned);
		await saveDebugFile(`${debugBase}.columns.json`, JSON.stringify(detection, null, 2));
	}

	return cleaned;
}

async function recognizeBestText(
	worker: Awaited<ReturnType<typeof createWorker>>,
	imageData: Buffer,
	options: CliOptions,
	debugBase?: string,
): Promise<string> {
	const whole = await ocrWholePageAutoColumns(worker, imageData, options, debugBase);
	const forcedTwo = await ocrByForcedTwoColumns(worker, imageData, options, debugBase);

	const wholeScore = scoreStructuredText(whole);
	const forcedTwoScore = scoreStructuredText(forcedTwo);

	const selected = forcedTwoScore > wholeScore ? forcedTwo : whole;

	if (options.debug && debugBase) {
		await saveDebugFile(`${debugBase}.whole.score.txt`, String(wholeScore));
		await saveDebugFile(`${debugBase}.forcedTwo.score.txt`, String(forcedTwoScore));
		await saveDebugFile(`${debugBase}.selected.txt`, selected);
	}

	return selected;
}

/**
 * Chấm điểm text theo độ "hữu ích cho parser" thay vì chỉ đếm ký tự.
 * Ưu tiên câu hỏi, option, section.
 */
function scoreStructuredText(text: string): number {
	const compactLen = text.replace(/\s+/g, "").length;
	const lines = text.split("\n");

	let questionCount = 0;
	let optionCount = 0;
	let sectionCount = 0;

	for (const line of lines) {
		const trimmed = line.trim();
		if (isQuestionStart(trimmed)) questionCount += 1;
		if (isOptionLine(trimmed)) optionCount += 1;
		if (isSectionHeader(trimmed)) sectionCount += 1;
	}

	return compactLen + questionCount * 80 + optionCount * 50 + sectionCount * 30;
}

async function renderPageImage(parser: PDFParse, page: number, width: number): Promise<Buffer | null> {
	const shot = await parser.getScreenshot({
		partial: [page],
		desiredWidth: width,
		imageBuffer: true,
		imageDataUrl: false,
	});

	const image = shot.pages[0];
	if (!image?.data?.length) {
		return null;
	}

	return Buffer.from(image.data);
}

async function extractTextLayerIfAvailable(_parser: PDFParse, _page: number): Promise<string> {
	return "";
}

async function processPage(
	parser: PDFParse,
	page: number,
	pdfPath: string,
	worker: Awaited<ReturnType<typeof createWorker>>,
	options: CliOptions,
): Promise<string> {
	const debugBase = options.debug ? toDebugBase(pdfPath, page, options.debugDir) : undefined;

	const textLayer = normalize(await extractTextLayerIfAvailable(parser, page));
	if (textLayer.replace(/\s+/g, "").length >= options.minTextChars) {
		if (options.debug && debugBase) {
			await saveDebugFile(`${debugBase}.text-layer.txt`, textLayer);
			await saveDebugFile(`${debugBase}.selected.txt`, textLayer);
		}
		return textLayer;
	}

	const imageData = await renderPageImage(parser, page, options.width);
	if (!imageData) return "";

	if (options.debug && debugBase) {
		await saveDebugFile(`${debugBase}.page.png`, imageData);
	}

	return recognizeBestText(worker, imageData, options, debugBase);
}

async function ocrFile(
	pdfPath: string,
	worker: Awaited<ReturnType<typeof createWorker>>,
	options: CliOptions,
): Promise<void> {
	const sidecarPath = toSidecarPath(pdfPath, options.outDir);

	if (fs.existsSync(sidecarPath) && !options.force) {
		console.log(`Skip existing: ${path.basename(sidecarPath)} (add --force)`);
		return;
	}

	ensureDir(path.dirname(sidecarPath));
	if (options.debug) {
		ensureDir(options.debugDir);
	}

	const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(pdfPath)) });
	const info = await parser.getInfo();
	const pages = buildPageList(info.total, options);

	console.log(
		`OCR ${path.basename(pdfPath)}: total=${info.total}, selected=${pages.length}, width=${options.width}, stride=${options.stride}, psm=${options.psm}, out=${options.outDir}`,
	);

	fs.writeFileSync(sidecarPath, "", "utf8");

	let idx = 0;
	for (const page of pages) {
		idx += 1;
		const text = await processPage(parser, page, pdfPath, worker, options);

		if (idx % 10 === 0 || idx === 1 || idx === pages.length) {
			console.log(`  page ${page} (${idx}/${pages.length}): ${text.length} chars`);
		}

		if (text) {
			fs.appendFileSync(sidecarPath, `\n\n===== PAGE ${page} =====\n${text}`, "utf8");
		}
	}

	await parser.destroy();
	console.log(`Saved: ${sidecarPath}`);
}

async function run(): Promise<void> {
	const options = parseCli();
	const files = getPdfFiles(options.inputPath);
	const worker = await createWorker(options.lang, 1);

	try {
		for (const file of files) {
			await ocrFile(file, worker, options);
		}
	} finally {
		await worker.terminate();
	}
}

run().catch((error) => {
	console.error("OCR failed:", error);
	process.exit(1);
});