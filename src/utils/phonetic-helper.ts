import * as fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dictPath = path.resolve(__dirname, "../../data/json/en_US.json");
const rawData = JSON.parse(fs.readFileSync(dictPath, "utf-8"));
// Lấy object đầu tiên trong mảng en_US
const dictionary = rawData.en_US[0]; 

export function generateRealIPA(sentence: string): string {
  const words = sentence
    .toLowerCase()
    .replace(/[.,!?;:]/g, "") 
    .trim()
    .split(/\s+/);

  const ipaResult = words.map((word) => {
    // Tra từ trong dictionary đã được "lấy ra" từ en_US[0]
    let ipa = dictionary[word];

    if (!ipa) {
      const strippedWord = word.replace(/'/g, "");
      ipa = dictionary[strippedWord] || word;
    }

    if (ipa.includes(",")) {
      ipa = ipa.split(",")[0];
    }

    return ipa.replace(/\//g, "").trim();
  });

  return `/${ipaResult.join(" ")}/`;
}