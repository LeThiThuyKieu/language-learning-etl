// Gộp file CEFR + xoá duplicate + gộp label + map difficulty (1-3) + shuffle

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Đọc file 
const filePath = path.resolve(__dirname, "../../data/cefr/CEFR-SP_SCoRE_train.txt");
const data = fs.readFileSync(filePath, "utf-8");

const allLines = data
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

console.log(`Tổng dòng ban đầu: ${allLines.length}`);

// 2. Hàm map difficulty (1-3)
function mapDifficulty(label: number): number {
  if (label <= 2) return 1; // easy
  if (label <= 4) return 2; // medium
  return 3; // hard
}

// 3. Xử lý + xoá duplicate
const seen = new Set<string>();
const uniqueLines: string[] = [];

allLines.forEach((line) => {
  const parts = line.split(/\s+/);
  if (parts.length < 3) return;
  const label1 = Number(parts[parts.length - 2]);
  const label2 = Number(parts[parts.length - 1]);
  if (isNaN(label1) || isNaN(label2)) {
    console.log("Lỗi parse:", line);
    return;
  }

  // Gộp label
  const mergedLabel = Math.round((label1 + label2) / 2);

  // Map difficulty
  const difficulty = mapDifficulty(mergedLabel);

  // Lấy sentence
  const sentence = parts.slice(0, -2).join(" ");
  const key = sentence.toLowerCase();

  if (!seen.has(key)) {
    seen.add(key);
    uniqueLines.push(`${sentence} ${difficulty}`);
  }
});

console.log(`Sau khi xoá duplicate: ${uniqueLines.length}`);

// 4. Shuffle
uniqueLines.sort(() => Math.random() - 0.5);

// 5. Ghi file
const outputPath = path.resolve(
  __dirname,
  "../../data/data-listening-speaking-add.txt",
);

fs.writeFileSync(outputPath, uniqueLines.join("\n"));

console.log("Done merge + deduplicate + map difficulty + shuffle!");