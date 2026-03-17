import * as fs from "fs";
import csv from "csv-parser";
import path from "path";
import { fileURLToPath } from "url";

import {
  initDifficultyClassifier,
  classifyDifficulty,
} from "../difficulty-embedding-classifier.ts";
import type { DifficultyModality } from "../difficulty-embedding-classifier.ts";

interface TestRow {
  sentence?: string;
  transcript?: string;
  difficulty: "easy" | "medium" | "hard";
}


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_TEST_FILE = path.resolve(__dirname, "../../../data/test_listening_difficulty.csv");

function parseModality(input?: string): DifficultyModality {
  const value = (input || "GENERAL").toUpperCase();
  if (value === "LISTENING" || value === "SPEAKING") return value;
  return "GENERAL";
}

function getSentence(row: TestRow): string {
  return row.sentence || row.transcript || "";
}

async function evaluate() {
  const modality = parseModality(process.argv[2]);
  const testFile = process.argv[3]
    ? path.resolve(process.cwd(), process.argv[3])
    : DEFAULT_TEST_FILE;

  await initDifficultyClassifier();

  const rows: TestRow[] = [];

  await new Promise((resolve) => {
    fs.createReadStream(testFile)
      .pipe(csv())
      .on("data", (row) => rows.push(row))
      .on("end", resolve);
  });

  let correct = 0;

  const stats: any = {
    easy: { tp: 0, fp: 0, fn: 0 },
    medium: { tp: 0, fp: 0, fn: 0 },
    hard: { tp: 0, fp: 0, fn: 0 },
  };

  for (const row of rows) {
    const sentence = getSentence(row);
    if (!sentence || !row.difficulty) continue;

    const predicted = await classifyDifficulty(sentence, modality);
    const actual = row.difficulty;

    if (predicted === actual) correct++;

    for (const label of ["easy", "medium", "hard"]) {
      if (predicted === label && actual === label) stats[label].tp++;
      else if (predicted === label && actual !== label) stats[label].fp++;
      else if (predicted !== label && actual === label) stats[label].fn++;
    }
  }

  const accuracy = correct / rows.length;

  console.log("Modality:", modality);
  console.log("Test file:", testFile);
  console.log("Total samples:", rows.length);
  console.log("Accuracy:", accuracy.toFixed(3));

  for (const label of ["easy", "medium", "hard"]) {
    const { tp, fp, fn } = stats[label];

    const precision = tp / (tp + fp || 1);
    const recall = tp / (tp + fn || 1);
    const f1 = (2 * precision * recall) / (precision + recall || 1);

    console.log(`\n${label.toUpperCase()}`);
    console.log("Precision:", precision.toFixed(3));
    console.log("Recall:", recall.toFixed(3));
    console.log("F1:", f1.toFixed(3));
  }
}

evaluate();