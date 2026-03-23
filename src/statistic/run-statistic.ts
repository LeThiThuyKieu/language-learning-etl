import { QuestionStatistics } from "./question-statistic.ts";
import { ChartGenerator } from "./chart.ts";

async function run() {
  const stats = new QuestionStatistics();
  const chart = new ChartGenerator();
  const NODE_LOWER_BOUND = 100;
  const NODE_UPPER_BOUND = 1000;
  const EXCLUDED_SKILLS = ["REVIEW"];

  const total = await stats.countTotalQuestions();
  const byLevel: any[] = (await stats.countByLevel()) as any[];
  const skillByLevel: any[] = (await stats.countSkillByLevel()) as any[];
  const nodeByLevelWithSkill: any[] =
    (await stats.countNodeByLevelWithSkill()) as any[];
  const skillQuestionType: any[] = (await stats.countSkillQuestionType()) as any[];

  const skillByLevelFiltered = skillByLevel.filter(
    (item: any) => !EXCLUDED_SKILLS.includes(String(item.skill)),
  );
  const nodeByLevelWithSkillFiltered = nodeByLevelWithSkill.filter(
    (item: any) => !EXCLUDED_SKILLS.includes(String(item.skill)),
  );
  const skillQuestionTypeFiltered = skillQuestionType.filter(
    (item: any) => !EXCLUDED_SKILLS.includes(String(item.skill)),
  );

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

  const levelTotalMap = new Map<number, number>();
  for (const row of byLevel) {
    levelTotalMap.set(Number(row.level_id), Number(row.total));
  }

  const levelLabels = byLevelWithPercent.map(
    (item: any) => `Level ${item.level_id} (${item.percent}%)`,
  );
  const levelData = byLevelWithPercent.map((item: any) => Number(item.total));

  await chart.generatePieChart(
    levelLabels,
    levelData,
    "Phân bố số lượng câu hỏi theo cấp độ",
    "question-by-level.png",
  );

  const sortedLevels: number[] = [];
  for (const item of byLevel) {
    const levelId = Number(item.level_id);
    if (!sortedLevels.includes(levelId)) {
      sortedLevels.push(levelId);
    }
  }
  sortedLevels.sort((a, b) => a - b);
  const levelAxisLabels = sortedLevels.map((levelId) => `Level ${levelId}`);

  // 1) Skill ratio in each level (mandatory)
  const skillSeries: string[] = [];
  for (const item of skillByLevelFiltered) {
    const skill = String(item.skill);
    if (!skillSeries.includes(skill)) {
      skillSeries.push(skill);
    }
  }
  skillSeries.sort();

  const skillRatioByLevelDatasets = skillSeries.map((skill) => ({
    label: skill,
    data: sortedLevels.map((levelId) => {
      const row = skillByLevelFiltered.find(
        (item: any) =>
          Number(item.level_id) === levelId && String(item.skill) === skill,
      );
      const value = row ? Number(row.total) : 0;
      const levelTotal = levelTotalMap.get(levelId) || 0;
      const percent = levelTotal > 0 ? (value * 100) / levelTotal : 0;
      return Number(percent.toFixed(2));
    }),
  }));

  await chart.generateStackedBarChart(
    levelAxisLabels,
    skillRatioByLevelDatasets,
    "Tỷ lệ skill trong từng cấp độ (%)",
    "skill-ratio-by-level.png",
  );

  // 2) Node balance metrics inside each skill
  const median = (arr: number[]) => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  };

  const stdDeviation = (arr: number[]) => {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((sum, value) => sum + value, 0) / arr.length;
    const variance =
      arr.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) /
      arr.length;
    return Math.sqrt(variance);
  };

  const countsBySkill = new Map<string, number[]>();
  for (const row of nodeByLevelWithSkillFiltered) {
    const skill = String(row.skill);
    const count = Number(row.total);
    const current = countsBySkill.get(skill) || [];
    current.push(count);
    countsBySkill.set(skill, current);
  }

  const skillLabels = Array.from(countsBySkill.keys()).sort();
  const skillBalanceSummary = skillLabels.map((skill) => {
    const values = countsBySkill.get(skill) || [];
    const min = values.length > 0 ? Math.min(...values) : 0;
    const max = values.length > 0 ? Math.max(...values) : 0;
    const med = median(values);
    const std = stdDeviation(values);
    const mean =
      values.length > 0
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : 0;
    const balanceScore = mean > 0 ? std / mean : 0;
    return {
      skill,
      min,
      median: Number(med.toFixed(2)),
      max,
      std: Number(std.toFixed(2)),
      mean: Number(mean.toFixed(2)),
      balance_score: Number(balanceScore.toFixed(4)),
    };
  });

  await chart.generateGroupedBarChart(
    skillLabels,
    [
      {
        label: "Min",
        data: skillBalanceSummary.map((item) => item.min),
      },
      {
        label: "Median",
        data: skillBalanceSummary.map((item) => item.median),
      },
      {
        label: "Max",
        data: skillBalanceSummary.map((item) => item.max),
      },
      {
        label: "Std",
        data: skillBalanceSummary.map((item) => item.std),
      },
    ],
    "Độ cân bằng node trong từng skill (min/median/max/std)",
    "node-balance-by-skill.png",
  );

  // 3) Question count by node in each level
  for (const levelId of sortedLevels) {
    const rows = nodeByLevelWithSkillFiltered
      .filter((item: any) => Number(item.level_id) === levelId)
      .sort((a: any, b: any) => Number(a.order_index) - Number(b.order_index));

    const labels = rows.map(
      (item: any) => `Node ${item.node_id} - ${item.skill}`,
    );
    const data = rows.map((item: any) => Number(item.total));

    await chart.generateBarChart(
      labels,
      data,
      `Số lượng câu hỏi theo node - Level ${levelId}`,
      `node-distribution-level-${levelId}.png`,
    );
  }

  // 4) Node coverage
  const coverageRows = sortedLevels.map((levelId) => {
    const rows = nodeByLevelWithSkillFiltered.filter(
      (item: any) => Number(item.level_id) === levelId,
    );
    const totalNodes = rows.length;
    const aboveLowerBound = rows.filter(
      (item: any) => Number(item.total) > NODE_LOWER_BOUND,
    ).length;
    const belowUpperBound = rows.filter(
      (item: any) => Number(item.total) < NODE_UPPER_BOUND,
    ).length;

    const aboveLowerBoundPercent =
      totalNodes > 0 ? (aboveLowerBound * 100) / totalNodes : 0;
    const belowUpperBoundPercent =
      totalNodes > 0 ? (belowUpperBound * 100) / totalNodes : 0;

    return {
      level_id: levelId,
      total_nodes: totalNodes,
      above_lower_bound_percent: Number(aboveLowerBoundPercent.toFixed(2)),
      below_upper_bound_percent: Number(belowUpperBoundPercent.toFixed(2)),
    };
  });

  await chart.generateGroupedBarChart(
    levelAxisLabels,
    [
      {
        label: `% Node > ${NODE_LOWER_BOUND} questions`,
        data: coverageRows.map((item) => item.above_lower_bound_percent),
      },
      {
        label: `% Node < ${NODE_UPPER_BOUND} questions`,
        data: coverageRows.map((item) => item.below_upper_bound_percent),
      },
    ],
    `Độ phủ dữ liệu node theo cấp độ (> ${NODE_LOWER_BOUND}, < ${NODE_UPPER_BOUND})`,
    "node-coverage-by-level.png",
  );

  // 5) Skill x Question type
  const skillQuestionTypeLabels = skillQuestionTypeFiltered.map(
    (item: any) => `${String(item.skill)} - ${String(item.question_type)}`,
  );
  const skillQuestionTypeData = skillQuestionTypeFiltered.map((item: any) =>
    Number(item.total),
  );

  await chart.generatePieChart(
    skillQuestionTypeLabels,
    skillQuestionTypeData,
    "Phân bố skill x loại câu hỏi",
    "skill-x-question-type.png",
  );

  // 6) Balance score (std/mean) by level
  const balanceScoreByLevel = sortedLevels.map((levelId) => {
    const counts = nodeByLevelWithSkillFiltered
      .filter((item: any) => Number(item.level_id) === levelId)
      .map((item: any) => Number(item.total));
    const mean =
      counts.length > 0
        ? counts.reduce((sum, value) => sum + value, 0) / counts.length
        : 0;
    const std = stdDeviation(counts);
    const balanceScore = mean > 0 ? std / mean : 0;
    return Number(balanceScore.toFixed(4));
  });

  await chart.generateBarChart(
    levelAxisLabels,
    balanceScoreByLevel,
    "Chỉ số cân bằng theo cấp độ (std/mean)",
    "balance-score-by-level.png",
  );

  void total;
  void byLevelWithPercent;
  void skillRatioByLevelDatasets;
  void skillBalanceSummary;
  void coverageRows;
  void skillQuestionTypeFiltered;
  void balanceScoreByLevel;
}

run().catch((error) => {
  console.error("Statistic run failed:", error);
  process.exit(1);
});
