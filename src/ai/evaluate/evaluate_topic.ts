import fs from "fs";
import path from "path";
import csv from "csv-parser";
import * as fastcsv from "fast-csv";
import { fileURLToPath } from "url";

import { initTopicClassifier, classifyTopic } from "../topic-embedding-classifier.ts";
import { topicTrainingData } from "../topic-data.ts";

type EvalGroup = "VOCAB_MATCHING" | "LISTENING_SPEAKING" | "ALL";

type QuestionType = "VOCAB" | "MATCHING" | "LISTENING" | "SPEAKING" | "UNKNOWN";

interface TopicEvalRow {
  sentence?: string;
  transcript?: string;
  text?: string;
  answer?: string;
  question_type?: string;
  actual_topic?: string;
  actual_topic_id?: string | number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_TEST_FILE = path.resolve(__dirname, "../../../data/topic-evaluation-vocab-matching.csv");

const TOPIC_TITLE: Record<number, string> = {
  1: "Greetings",
  2: "Family",
  3: "Numbers",
  4: "Food",
  5: "Daily Activities",
  6: "Travel",
  7: "Shopping",
  8: "Work",
  9: "Education",
  10: "Health",
  11: "Technology",
  12: "Environment",
  13: "Transportation",
  14: "Communication",
  15: "Culture",
  16: "Business",
  17: "Science",
  18: "Psychology",
  19: "Politics",
  20: "Economy",
  21: "Law",
  22: "Media",
  23: "Philosophy",
  24: "Innovation",
  25: "Global Issues",
};

const TITLE_TO_ID = Object.fromEntries(
  Object.entries(TOPIC_TITLE).map(([id, title]) => [title.toLowerCase(), Number(id)]),
) as Record<string, number>;

function parseGroup(input?: string): EvalGroup {
  const value = (input || "VOCAB_MATCHING").toUpperCase();
  if (value === "LISTENING_SPEAKING") return value;
  if (value === "ALL") return value;
  return "VOCAB_MATCHING";
}

function parseQuestionType(input?: string): QuestionType {
  const value = String(input || "").toUpperCase().trim();
  if (value === "VOCAB" || value === "MATCHING" || value === "LISTENING" || value === "SPEAKING") {
    return value;
  }
  return "UNKNOWN";
}

function shouldUseRow(group: EvalGroup, qType: QuestionType): boolean {
  if (group === "ALL") return true;
  if (group === "VOCAB_MATCHING") {
    // Legacy vocab/matching manual files may not include question_type.
    if (qType === "UNKNOWN") return true;
    return qType === "VOCAB" || qType === "MATCHING";
  }
  return qType === "LISTENING" || qType === "SPEAKING";
}

function detectCsvSeparator(filePath: string): ";" | "," {
  const firstLine = (fs.readFileSync(filePath, "utf8").split(/\r?\n/, 1)[0] || "").trim();
  if (firstLine.includes(";") && !firstLine.includes(",")) return ";";
  return ",";
}

function buildTopicInputText(row: TopicEvalRow): string {
  const qType = parseQuestionType(row.question_type);
  const sentence = String(row.sentence || row.transcript || row.text || "").trim();
  const answer = String(row.answer || "").trim();

  if (qType === "VOCAB") {
    const match = sentence.match(/what\s+is\s+the\s+meaning\s+of:\s*(.+)$/i);
    if (match?.[1]) {
      return `${match[1].trim()} ${answer}`.trim();
    }
    return `${sentence} ${answer}`.trim();
  }

  if (qType === "MATCHING") {
    return `${sentence} ${answer}`.trim();
  }

  return sentence;
}

function resolveActualTopicId(row: TopicEvalRow): number | null {
  const byId = Number(row.actual_topic_id);
  if (Number.isFinite(byId) && byId > 0) return byId;

  const byName = String(row.actual_topic || "").trim().toLowerCase();
  if (!byName) return null;

  return TITLE_TO_ID[byName] || null;
}

function metric(tp: number, fp: number, fn: number) {
  const precision = tp / (tp + fp || 1);
  const recall = tp / (tp + fn || 1);
  const f1 = (2 * precision * recall) / (precision + recall || 1);
  return { precision, recall, f1 };
}

async function evaluate() {
  const group = parseGroup(process.argv[2]);
  const testFile = process.argv[3]
    ? path.resolve(process.cwd(), process.argv[3])
    : DEFAULT_TEST_FILE;

  if (!fs.existsSync(testFile)) {
    throw new Error(`Test file not found: ${testFile}`);
  }

  const separator = detectCsvSeparator(testFile);
  const candidateTopics = Object.keys(topicTrainingData).map(Number).sort((a, b) => a - b);

  await initTopicClassifier();

  const rows: TopicEvalRow[] = [];

  await new Promise((resolve) => {
    fs.createReadStream(testFile)
      .pipe(csv({ separator }))
      .on("data", (row) => rows.push(row))
      .on("end", resolve);
  });

  const stats: Record<number, { tp: number; fp: number; fn: number }> = {};
  for (const topicId of candidateTopics) {
    stats[topicId] = { tp: 0, fp: 0, fn: 0 };
  }

  let used = 0;
  let skippedNoLabel = 0;
  let skippedByGroup = 0;
  let correct = 0;

  const confusion: Record<string, number> = {};
  const outputRows: any[] = [];

  for (const row of rows) {
    const qType = parseQuestionType(row.question_type);

    if (!shouldUseRow(group, qType)) {
      skippedByGroup++;
      continue;
    }

    const actualTopicId = resolveActualTopicId(row);
    if (!actualTopicId) {
      skippedNoLabel++;
      continue;
    }

    const inputText = buildTopicInputText(row);
    if (!inputText) {
      skippedNoLabel++;
      continue;
    }

    const predictedTopicId = await classifyTopic(inputText, candidateTopics);
    used++;

    if (predictedTopicId === actualTopicId) {
      correct++;
    } else {
      const key = `${actualTopicId}->${predictedTopicId}`;
      confusion[key] = (confusion[key] || 0) + 1;
    }

    for (const topicId of candidateTopics) {
      if (predictedTopicId === topicId && actualTopicId === topicId) stats[topicId].tp++;
      else if (predictedTopicId === topicId && actualTopicId !== topicId) stats[topicId].fp++;
      else if (predictedTopicId !== topicId && actualTopicId === topicId) stats[topicId].fn++;
    }

    outputRows.push({
      question_type: qType,
      source_text: String(row.sentence || row.transcript || row.text || ""),
      topic_input_text: inputText,
      actual_topic_id: actualTopicId,
      actual_topic: TOPIC_TITLE[actualTopicId] || "UNKNOWN",
      predicted_topic_id: predictedTopicId,
      predicted_topic: TOPIC_TITLE[predictedTopicId] || "UNKNOWN",
      correct: predictedTopicId === actualTopicId ? 1 : 0,
    });
  }

  const accuracy = correct / (used || 1);

  let macroPrecision = 0;
  let macroRecall = 0;
  let macroF1 = 0;

  for (const topicId of candidateTopics) {
    const { tp, fp, fn } = stats[topicId];
    const m = metric(tp, fp, fn);
    macroPrecision += m.precision;
    macroRecall += m.recall;
    macroF1 += m.f1;
  }

  macroPrecision /= candidateTopics.length;
  macroRecall /= candidateTopics.length;
  macroF1 /= candidateTopics.length;

  const outputName = `topic-eval-results-${group.toLowerCase()}.csv`;
  const outputPath = path.resolve(__dirname, `../../../data/${outputName}`);
  fastcsv.write(outputRows, { headers: true }).pipe(fs.createWriteStream(outputPath));

  console.log("Group:", group);
  console.log("Test file:", testFile);
  console.log("Separator:", separator);
  console.log("Total rows:", rows.length);
  console.log("Used rows:", used);
  console.log("Skipped (group filter):", skippedByGroup);
  console.log("Skipped (missing label/text):", skippedNoLabel);
  console.log("Accuracy:", accuracy.toFixed(3));
  console.log("Macro Precision:", macroPrecision.toFixed(3));
  console.log("Macro Recall:", macroRecall.toFixed(3));
  console.log("Macro F1:", macroF1.toFixed(3));

  const topConfusions = Object.entries(confusion)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (topConfusions.length) {
    console.log("\nTop confusion pairs (actual->predicted):");
    for (const [pair, count] of topConfusions) {
      const [actual, predicted] = pair.split("->").map(Number);
      console.log(
        `${actual}(${TOPIC_TITLE[actual] || "UNKNOWN"}) -> ${predicted}(${TOPIC_TITLE[predicted] || "UNKNOWN"}): ${count}`,
      );
    }
  }

  console.log("\nSaved predictions:", outputPath);
}

evaluate().catch((err) => {
  console.error("Topic evaluation failed:", err);
  process.exit(1);
});
