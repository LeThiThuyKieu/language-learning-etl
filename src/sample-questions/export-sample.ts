import fs from "fs";
import path from "path";
import { QuestionStatistics } from "../statistic/question-statistic.ts";

function shuffle(arr: any[]) {
  return [...arr].sort(() => 0.5 - Math.random());
}

function formatTree(tree: any) {
  let content = "";

  content += `TREE ${tree.id}\n`;
  content += "====================================\n\n";

  for (const node of tree.nodes) {
    content += `NODE ${node.node_type}\n\n`;
    let index = 1;
    
    // NODE REVIEW sử dụng format thống nhất cho tất cả loại câu
    const isReviewNode = node.node_type === "REVIEW";
    
    for (const q of node.questions) {
      if (q.question_type === "VOCAB") {
        const opts = Array.isArray(q.options) ? q.options : [];

        // remove duplicate
        const uniqueOptions = [...new Set([...opts, q.correct_answer])];

        // đảm bảo correct answer tồn tại
        if (!uniqueOptions.includes(q.correct_answer)) {
          uniqueOptions.push(q.correct_answer);
        }

        const options = shuffle(uniqueOptions).slice(0, 4);
        const letters = ["A", "B", "C", "D"];
        content += `Q${index}: ${q.question_text}\n`;

        options.forEach((opt, i) => {
          content += `${letters[i]}. ${opt}\n`;
        });

        const answerLetter = letters[options.indexOf(q.correct_answer)];

        content += `Answer: ${answerLetter}\n\n`;
      } else if (q.question_type === "LISTENING") {
        const listeningText = String(q.question_text || "").replace(/\\n/g, "\n");
        content += `Q${index}: ${listeningText}\n`;
        content += `Answer: ${q.correct_answer}\n\n`;
      } else if (q.question_type === "MATCHING") {
        if (isReviewNode) {
          // In REVIEW node, dùng Q format
          content += `Q${index}: ${q.question_text}\n`;
          content += `Answer: ${q.correct_answer}\n\n`;
        } else {
          // In MATCHING node, dùng số + arrow format
          content += `${index}. ${q.question_text} -> ${q.correct_answer}\n`;
        }
      } else if (q.question_type === "SPEAKING") {
        content += `Q${index}: [Speaking] ${q.question_text || "Describe the image"}\n`;
        content += `${q.correct_answer}\n\n`;
      }
      index++;
    }
    content += "\n\n";
  }

  return content;
}

(async () => {
  const stats = new QuestionStatistics();
  const baseDir = path.resolve("data/language_learning_exam");
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir);
  }

  let globalTreeIndex = 1;
  for (let level = 1; level <= 3; level++) {
    console.log(`Export level ${level}...`);
    const trees = await stats.getSampleQuestionsByLevel(level);
    const levelDir = path.join(baseDir, `level_${level}`);
    if (!fs.existsSync(levelDir)) {
      fs.mkdirSync(levelDir);
    }

    for (const tree of trees) {
      const content = formatTree(tree);
      const filePath = path.join(levelDir, `tree_${globalTreeIndex}.txt`);
      fs.writeFileSync(filePath, content, "utf-8");
      globalTreeIndex++;
    }
  }

  console.log("Export completed.");
  process.exit(0);
})();
