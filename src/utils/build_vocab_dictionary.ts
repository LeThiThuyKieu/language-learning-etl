import fs from "fs";
import path from "path";
import csv from "csv-parser";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputFile = path.resolve(__dirname, "../../data/archive/vocab_raw.csv");
const outputFile = path.resolve(
  __dirname,
  "../../data/json/vocab_difficulty.json"
);

const vocabMap: Record<string, string> = {};

fs.createReadStream(inputFile)
  .pipe(
    csv({
      mapHeaders: ({ header }) => header.trim().replace(/^\uFEFF/, ""),
    })
  )
  .on("data", (row) => {
    const word = row.word?.toLowerCase().trim();
    const difficulty = row.difficulty?.toLowerCase().trim();

    if (!word || !difficulty) return;

    // tránh duplicate
    if (!vocabMap[word]) {
      vocabMap[word] = difficulty;
    }
  })
  .on("end", () => {
    fs.writeFileSync(
      outputFile,
      JSON.stringify(vocabMap, null, 2),
      "utf8"
    );

    console.log("vocab_difficulty.json created!");
    console.log("Total words:", Object.keys(vocabMap).length);
  });