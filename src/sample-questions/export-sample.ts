import { QuestionStatistics } from "../statistic/question-statistic.ts";

(async () => {
    const stats = new QuestionStatistics();
    const levelId = 1; // example for level 1
    const sample = await stats.getSampleQuestionsByLevel(levelId);
    console.log(JSON.stringify(sample, null, 2));
    process.exit(0);
})();