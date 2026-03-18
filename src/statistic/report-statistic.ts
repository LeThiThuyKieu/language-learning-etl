//Bảng thông kê các chỉ số của thuật toán: thời gian chạy, độ trùng lặp, độ lệch chuẩn của thời gian chạy
import fs from "fs";
import path from "path";
import { QuestionStatistics } from "./question-statistic.ts";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

//Độ trùng lặp được tính bằng cách lấy tổng số câu hỏi đã chọn (5 node x 10 câu = 50) trừ đi số lượng câu hỏi duy nhất,
//sau đó chia cho tổng số câu hỏi đã chọn. 
//Kết quả sẽ là tỷ lệ phần trăm câu hỏi bị trùng lặp trong bộ câu hỏi mẫu.
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
  const duplicateRate = 1 - unique.size / allQuestions.length;
  return duplicateRate;
}

// Đo độ ổn định của thời gian sinh đề thi bằng cách tính độ lệch chuẩn của thời gian chạy qua nhiều lần thực hiện.
//Độ lệch chuẩn được tính bằng cách lấy căn bậc hai của phương sai
//trong đó phương sai là trung bình cộng của bình phương khoảng cách từ mỗi giá trị đến giá trị trung bình.
function stdDeviation(arr: number[]) {
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance =
    arr.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) /
    arr.length;
  return Math.sqrt(variance);
}

//Đo độ hiệu quả của thuật toán bằng cách tính thời gian trung bình để sinh một bộ câu hỏi mẫu cho mỗi cấp độ.
(async () => {
  const stats = new QuestionStatistics();

  const RUNS = 50; 
  const resultRows: any[] = [];

  for (let level = 1; level <= 3; level++) {
    console.log(`Running level ${level}...`);

    let times: number[] = []; //Thời gian sinh đề (tree)
    let duplicates: number[] = []; //Tỷ lệ trùng lặp của các đề
    let success = 0;  //Số lần chạy thành công
    for (let i = 0; i < RUNS; i++) {
      const start = Date.now();
      try {
        const trees = await stats.getSampleQuestionsByLevel(level);
        const end = Date.now();
        const time = end - start;
        times.push(time);
        const dup = getDuplicateRate(trees);
        duplicates.push(dup);
        success++;
      } catch (e) {
        console.error("Error run:", e);
      }
    }

    const avgTime =
      times.reduce((a, b) => a + b, 0) / times.length;

    const avgDuplicate =
      duplicates.reduce((a, b) => a + b, 0) / duplicates.length;

    const std = stdDeviation(times);

    resultRows.push({
      level,
      runs: RUNS,
      success,
      avg_time: avgTime.toFixed(2),
      avg_iteration: 50, // 5 node x 10 câu
      avg_duplicate: (avgDuplicate * 100).toFixed(2),
      std_dev: std.toFixed(4),
    });
  }

  // ghi CSV
  const filePath = path.resolve(__dirname, "../../data/report.csv");
  let csv =
    "Level,Runs,Success,AvgTime(ms),AvgIteration,AvgDuplicate(%),StdDev\n";
  for (const row of resultRows) {
    csv += `${row.level},${row.runs},${row.success},${row.avg_time},${row.avg_iteration},${row.avg_duplicate},${row.std_dev}\n`;
  }
  fs.writeFileSync(filePath, csv, "utf-8");

  console.log("Report saved to:", filePath);
  process.exit(0);
})();