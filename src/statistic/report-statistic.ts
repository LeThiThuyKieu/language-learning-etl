// Bảng thông kê các chỉ số của thuật toán: thời gian chạy, độ trùng lặp, độ lệch chuẩn của thời gian chạy
import fs from "fs";
import path from "path";
import { QuestionStatistics } from "./question-statistic.ts"; // Đảm bảo đúng đường dẫn file của bạn
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getDuplicateRate(trees: any[]) {
  let allQuestions: string[] = [];
  for (const tree of trees) {
    for (const node of tree.nodes) {
      for (const q of node.questions) {
        allQuestions.push(q.id.toString());
      }
    }
  }
  const unique = new Set(allQuestions);
  if (allQuestions.length === 0) return 0;
  return 1 - unique.size / allQuestions.length;
}

function stdDeviation(arr: number[]) {
  if (arr.length === 0) return 0;
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

(async () => {
  const stats = new QuestionStatistics();

  /**
   * giả sử các level chạy 10, 20, 50, 100, 500 lần để lấy mẫu kiểm tra thống kê
   * Tổng cộng sẽ có 15 dòng kết quả (5 mức runs x 3 levels)
   */
  const runTests = [10, 20, 50, 100, 500]; 
  const levels = [1, 2, 3];

  const resultRows: any[] = [];

  for (const numRuns of runTests) {
    for (const level of levels) {
      console.log(`Đang chạy: Level ${level} với ${numRuns} lượt...`);

      let times: number[] = [];
      let duplicates: number[] = [];
      let success = 0;

      for (let i = 0; i < numRuns; i++) {
        const start = Date.now();
        try {
          const trees = await stats.getSampleQuestionsByLevel(level);
          const end = Date.now();
          
          times.push(end - start);
          duplicates.push(getDuplicateRate(trees));
          success++;
        } catch (e) {
          console.error(`Lỗi: Level ${level}, Lượt ${i+1}/${numRuns}:`, e);
        }
      }

      const avgTime = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
      const avgDuplicate = duplicates.length > 0 ? duplicates.reduce((a, b) => a + b, 0) / duplicates.length : 0;
      const std = stdDeviation(times);

      resultRows.push({
        level: level,
        runs: numRuns,
        success,
        avg_time: avgTime.toFixed(2),
        avg_iteration: 50, // 5 nodes * 10 questions
        avg_duplicate: (avgDuplicate * 100).toFixed(2),
        std_dev: std.toFixed(4),
      });
    }
  }

  // Ghi file CSV
  const filePath = path.resolve(__dirname, "../../data/report.csv");
  let csv = "Weight constraint (level),Number of runs,Success,AvgTime(ms),AvgIteration,AvgDuplicate(%),StdDev\n";
  
  for (const row of resultRows) {
    csv += `${row.level},${row.runs},${row.success},${row.avg_time},${row.avg_iteration},${row.avg_duplicate},${row.std_dev}\n`;
  }

  fs.writeFileSync(filePath, csv, "utf-8");
  console.log("------------------------------------------");
  console.log("THỐNG KÊ HOÀN TẤT!");
  console.log("Kết quả lưu tại:", filePath);
  process.exit(0);
})();