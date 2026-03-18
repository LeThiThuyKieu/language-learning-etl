import * as fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dictPath = path.resolve(__dirname, "../../data/json/en_US.json");
const rawData = JSON.parse(fs.readFileSync(dictPath, "utf-8"));
const dictionary = rawData.en_US[0];

// Chuẩn hóa IPA
function normalizeIPA(ipa: string): string {
  return ipa
    .replace(/\//g, "")        // bỏ dấu /
    .replace(/ɹ/g, "r")        // American -> dễ đọc
    .replace(/ɫ/g, "l")
    .replace(/ɝ/g, "ər")
    .replace(/ɚ/g, "ər")
    .replace(/\s+/g, " ")      // gọn khoảng trắng
    .trim();
}

export function generateRealIPA(sentence: string): string {
  const words = sentence
    .toLowerCase()
    .replace(/[.,!?;:]/g, "")
    .trim()
    .split(/\s+/);

  const ipaResult = words.map((word) => {
    let ipa = dictionary[word];

    // fallback khi có dấu '
    if (!ipa) {
      const strippedWord = word.replace(/'/g, "");
      ipa = dictionary[strippedWord];
    }

    // nếu vẫn không có → giữ nguyên word 
    if (!ipa) return word;

    // lấy IPA đầu tiên nếu có nhiều
    if (ipa.includes(",")) {
      ipa = ipa.split(",")[0];
    }

    return normalizeIPA(ipa);
  });

  // remove duplicate khoảng trắng lần cuối
  const finalIPA = ipaResult.join(" ").replace(/\s+/g, " ").trim();

  return `/${finalIPA}/`;
}