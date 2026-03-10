import fs from "fs";
import path from "path";
import csv from "csv-parser";
import * as fastcsv from "fast-csv";
import { fileURLToPath } from "url";

import { initTopicClassifier, classifyTopic } from "../topic-embedding-classifier.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Map topic id -> title
const topicTitle: Record<number, string> = {
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
  25: "Global Issues"
};

const DATASET = path.resolve(__dirname, "../../../data/dataset_final.csv");
const OUTPUT = path.resolve(__dirname, "../../../data/topic-evaluation-vocab-matching.csv");

async function evaluateDataset() {

  console.log("Loading classifier...");
  await initTopicClassifier();

  const rows: any[] = [];

  await new Promise((resolve) => {
    fs.createReadStream(DATASET)
      .pipe(csv())
      .on("data", (data) => rows.push(data))
      .on("end", resolve);
  });

  console.log("Total dataset:", rows.length);

  // random shuffle
  rows.sort(() => 0.5 - Math.random());

  // lấy 200 câu
  const sample = rows.slice(0, 200);

  const results: any[] = [];

  for (const item of sample) {

    const sentence = item.sentence;

    const predictedTopic = await classifyTopic(sentence);

    results.push({
      sentence: sentence,
      predicted_topic_id: predictedTopic,
      predicted_topic: topicTitle[predictedTopic]
    });

    console.log(sentence.substring(0,40), "→", topicTitle[predictedTopic]);
  }

  const ws = fs.createWriteStream(OUTPUT);

  fastcsv.write(results, { headers: true }).pipe(ws);

  console.log("\nEvaluation file created:");
  console.log(OUTPUT);
}

evaluateDataset();