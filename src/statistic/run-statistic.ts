import { QuestionStatistics } from "./question-statistic.ts";
import { ChartGenerator } from "./chart.ts";

async function run() {
  const stats = new QuestionStatistics();
  const chart = new ChartGenerator();

  const total = await stats.countTotalQuestions();
  const byLevel = await stats.countByLevel();
  const byType = await stats.countByType();
  const topNodes = await stats.countByNode(20);
  const treeByLevel = await stats.countTreeByLevel();

  const withPercent = (rows: any[], totalBase: number, key: string) => {
    return rows.map((item) => {
      const value = Number(item[key]);
      const percent = totalBase > 0 ? (value * 100) / totalBase : 0;
      return {
        ...item,
        percent: Number(percent.toFixed(2)),
      };
    });
  };

  const byLevelWithPercent = withPercent(byLevel, total, "total");
  const byTypeWithPercent = withPercent(byType, total, "total");
  const topNodesWithPercent = withPercent(topNodes, total, "total");

  const levelTotalMap = new Map<number, number>();
  for (const row of byLevel) {
    levelTotalMap.set(Number(row.level_id), Number(row.total));
  }

  const treeByLevelWithPercent = treeByLevel.map((row: any) => {
    const levelId = Number(row.level_id);
    const levelTotal = levelTotalMap.get(levelId) || 0;
    const treeTotal = Number(row.total);
    const percentInLevel = levelTotal > 0 ? (treeTotal * 100) / levelTotal : 0;
    return {
      ...row,
      percent_in_level: Number(percentInLevel.toFixed(2)),
    };
  });

  const levelLabels = byLevelWithPercent.map(
    (item: any) => `Level ${item.level_id} (${item.percent}%)`,
  );
  const levelData = byLevelWithPercent.map((item: any) => Number(item.total));

  const typeLabels = byTypeWithPercent.map(
    (item: any) => `${item.question_type} (${item.percent}%)`,
  );
  const typeData = byTypeWithPercent.map((item: any) => Number(item.total));

  const nodeLabels = topNodesWithPercent.map(
    (item: any) => `Node ${item.node_id} (${item.percent}%)`,
  );
  const nodeData = topNodesWithPercent.map((item: any) => Number(item.total));

  await chart.generatePieChart(
    typeLabels,
    typeData,
    "Question Distribution by Type",
    "question-by-type.png",
  );

  await chart.generatePieChart(
    levelLabels,
    levelData,
    "Question Distribution by Level",
    "question-by-level.png",
  );

  await chart.generateBarChart(
    nodeLabels,
    nodeData,
    "Top 20 Nodes by Question Count",
    "top-nodes.png",
  );

  for (const level of byLevel) {
    const levelId = Number(level.level_id);
    const rows = treeByLevelWithPercent.filter(
      (item: any) => Number(item.level_id) === levelId,
    );

    const labels = rows.map(
      (item: any) => `${item.tree_title} (${item.percent_in_level}%)`,
    );
    const data = rows.map((item: any) => Number(item.total));

    await chart.generateBarChart(
      labels,
      data,
      `Tree Distribution in Level ${levelId}`,
      `tree-by-level-${levelId}.png`,
    );
  }

  console.log("=== QUESTION STATS ===");
  console.log("Total:", total);
  console.log("By level (%):", byLevelWithPercent);
  console.log("By type (%):", byTypeWithPercent);
  console.log("Top nodes (% of total):", topNodesWithPercent);
  console.log("Tree ratio in each level (% in level):", treeByLevelWithPercent);
  console.log("Charts saved at ./charts");
}

run().catch((error) => {
  console.error("Statistic run failed:", error);
  process.exit(1);
});
