import fs from 'fs';
import path from 'path';
import { createWriteStream } from 'fs';

interface MatchingPair {
  left: string;
  right: string;
}

interface DestinationData {
  page: number;
  kind: string;
  pairs: MatchingPair[];
}

interface ExtractedPair {
  sentence_left: string;
  sentence_right: string;
  difficulty: string;
}

const BASE_DIR = path.join(process.cwd(), 'data', 'destination_text_matching');
const OUTPUT_DIR = path.join(process.cwd(), 'data', 'archive');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'matching_raw_from_destination.csv');

const FILES_CONFIG = [
  { fileName: 'Destination B1.json', difficulty: 'easy' },
  { fileName: 'Destination B2.json', difficulty: 'medium' },
  { fileName: 'Destination C1-C2.json', difficulty: 'hard' }
];

// Đọc các file json và trích xuất cặp câu matching (left-right)
// Loại bỏ các dòng có left giống nhau - chỉ giữ lại left đầu tiên
function extractPairsFromFile(filePath: string, difficulty: string, seenLefts: Set<string>): ExtractedPair[] {
  try {
    console.log(`Reading file: ${filePath}`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as DestinationData[];
    const pairs: ExtractedPair[] = [];
    let skippedCount = 0;

    data.forEach((item) => {
      if (item.pairs && Array.isArray(item.pairs)) {
        item.pairs.forEach((pair) => {
          const leftValue = (pair.left || '').trim();
          
          // Nếu left đã gặp rồi, bỏ qua
          if (seenLefts.has(leftValue)) {
            skippedCount++;
            return;
          }
          
          seenLefts.add(leftValue);
          pairs.push({
            sentence_left: pair.left || '',
            sentence_right: pair.right || '',
            difficulty
          });
        });
      }
    });

    console.log(`Extracted ${pairs.length} pairs from ${path.basename(filePath)} (skipped ${skippedCount} duplicate left values)`);
    return pairs;
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    throw error;
  }
}

// Xử lý escape cho các trường có dấu phẩy, dấu nháy kép hoặc xuống dòng để đảm bảo định dạng CSV đúng
function escapeCsvField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return `"${field}"`;
}

// Lưu các cặp câu đã trích xuất vào file CSV
function saveToCsv(pairs: ExtractedPair[], outputPath: string): void {
  try {
    const stream = createWriteStream(outputPath, { encoding: 'utf-8' });

    // Write header
    stream.write('sentence_left,sentence_right,difficulty\n');

    // Write data row
    pairs.forEach((pair) => {
      const row = `${escapeCsvField(pair.sentence_left)},${escapeCsvField(pair.sentence_right)},${pair.difficulty}\n`;
      stream.write(row);
    });

    stream.end();

    console.log(`Saved ${pairs.length} pairs to ${outputPath}`);
  } catch (error) {
    console.error(`Error saving to CSV:`, error);
    throw error;
  }
}

// Main function để trích xuất các cặp từ các file và luu vào CSV
async function extractAllPairs(): Promise<void> {
  try {
    console.log('Starting extraction of matching pairs...\n');

    // Verify output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      console.log(`Created output directory: ${OUTPUT_DIR}`);
    }

    let allPairs: ExtractedPair[] = [];
    const seenLefts = new Set<string>(); // Track seen left values across all files

    // Extract from each file
    for (const config of FILES_CONFIG) {
      const filePath = path.join(BASE_DIR, config.fileName);
      if (!fs.existsSync(filePath)) {
        console.warn(`File not found: ${filePath}`);
        continue;
      }
      const pairs = extractPairsFromFile(filePath, config.difficulty, seenLefts);
      allPairs = allPairs.concat(pairs);
    }

    console.log(`\nTotal pairs extracted: ${allPairs.length}`);

    // Save to CSV
    saveToCsv(allPairs, OUTPUT_FILE);
    console.log(`\n Extraction completed successfully!`);
    console.log(`Output file: ${OUTPUT_FILE}`);

  } catch (error) {
    console.error('Extraction failed:', error);
    process.exit(1);
  }
}

// Run the extraction process
extractAllPairs();
