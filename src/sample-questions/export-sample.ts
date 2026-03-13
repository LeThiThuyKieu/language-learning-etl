import fs from "fs";
import path from "path";
import { QuestionStatistics } from "../statistic/question-statistic.ts";

function shuffle(arr: any[]) {
  return [...arr].sort(() => 0.5 - Math.random());
}

function formatTree(tree: any) {
  let content = "";

  content += `TREE ${tree.id}: ${tree.title}\n`;
  content += "====================================\n\n";

  for (const node of tree.nodes) {
    content += `NODE ${node.node_type}\n\n`;
    let index = 1;
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
        content += `Q${index}: ${q.question_text}\n`;
        content += `Answer: ${q.correct_answer}\n\n`;
      } else if (q.question_type === "MATCHING") {
        content += `${index}. ${q.question_text} -> ${q.correct_answer}\n`;
      } else if (q.question_type === "SPEAKING") {
        content += `${index}. ${q.correct_answer}\n`;
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
