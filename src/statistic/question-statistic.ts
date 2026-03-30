import mysql from "mysql2/promise";
import * as dotenv from "dotenv";
import mongoose from "mongoose";
import { Schema } from "mongoose";

dotenv.config({ quiet: true });

const QuestionMongoSchema = new Schema({
  question_text: String,
  distractors: [String],
  explanation: String,
  metadata: Object,
});

const QuestionModel = mongoose.model("questions", QuestionMongoSchema);

export class QuestionStatistics {
  private async createConnection() {
    return mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });
  }

  async countTotalQuestions(): Promise<number> {
    const db = await this.createConnection();
    try {
      const [rows]: any = await db.query(
        "SELECT COUNT(*) as total FROM questions",
      );
      return rows[0]?.total || 0;
    } finally {
      await db.end();
    }
  }

  async countByLevel() {
    const db = await this.createConnection();
    try {
      const [rows]: any = await db.query(`
				SELECT level_id, COUNT(*) as total
				FROM questions
				GROUP BY level_id
				ORDER BY level_id
			`);
      return rows;
    } finally {
      await db.end();
    }
  }

  async countByType() {
    const db = await this.createConnection();
    try {
      const [rows]: any = await db.query(`
				SELECT question_type, COUNT(*) as total
				FROM questions
				GROUP BY question_type
				ORDER BY question_type
			`);
      return rows;
    } finally {
      await db.end();
    }
  }

  async countByNodeType() {
    const db = await this.createConnection();
    try {
      const [rows]: any = await db.query(`
        SELECT sn.node_type, COUNT(*) AS total
        FROM questions q
        JOIN skill_node sn ON q.node_id = sn.id
        GROUP BY sn.node_type
        ORDER BY total DESC
      `);
      return rows;
    } finally {
      await db.end();
    }
  }

  async countTypeByLevel() {
    const db = await this.createConnection();
    try {
      const [rows]: any = await db.query(`
        SELECT level_id, question_type, COUNT(*) AS total
        FROM questions
        GROUP BY level_id, question_type
        ORDER BY level_id, question_type
      `);
      return rows;
    } finally {
      await db.end();
    }
  }

  async countNodeTypeByLevel() {
    const db = await this.createConnection();
    try {
      const [rows]: any = await db.query(`
        SELECT q.level_id, sn.node_type, COUNT(*) AS total
        FROM questions q
        JOIN skill_node sn ON q.node_id = sn.id
        GROUP BY q.level_id, sn.node_type
        ORDER BY q.level_id, sn.node_type
      `);
      return rows;
    } finally {
      await db.end();
    }
  }

  async countSkillByLevel() {
    const db = await this.createConnection();
    try {
      const [rows]: any = await db.query(`
        SELECT
          st.level_id,
          sn.node_type AS skill,
          COUNT(q.id) AS total
        FROM skill_node sn
        JOIN skill_tree st ON sn.skill_tree_id = st.id
        LEFT JOIN questions q ON q.node_id = sn.id
        GROUP BY st.level_id, sn.node_type
        ORDER BY st.level_id, sn.node_type
      `);
      return rows;
    } finally {
      await db.end();
    }
  }

  async countNodeByLevelWithSkill() {
    const db = await this.createConnection();
    try {
      const [rows]: any = await db.query(`
        SELECT
          st.level_id,
          sn.id AS node_id,
          sn.title AS node_title,
          sn.node_type AS skill,
          sn.order_index,
          COUNT(q.id) AS total
        FROM skill_node sn
        JOIN skill_tree st ON sn.skill_tree_id = st.id
        LEFT JOIN questions q ON q.node_id = sn.id
        GROUP BY
          st.level_id,
          sn.id,
          sn.title,
          sn.node_type,
          sn.order_index
        ORDER BY st.level_id, sn.order_index, sn.id
      `);
      return rows;
    } finally {
      await db.end();
    }
  }

  async countSkillQuestionType() {
    const db = await this.createConnection();
    try {
      const [rows]: any = await db.query(`
        SELECT
          sn.node_type AS skill,
          q.question_type,
          COUNT(*) AS total
        FROM questions q
        JOIN skill_node sn ON q.node_id = sn.id
        GROUP BY sn.node_type, q.question_type
        ORDER BY sn.node_type, q.question_type
      `);
      return rows;
    } finally {
      await db.end();
    }
  }

  async countByNode(limit: number = 20) {
    const db = await this.createConnection();
    try {
      const [rows]: any = await db.query(
        `
				SELECT node_id, COUNT(*) as total
				FROM questions
				GROUP BY node_id
				ORDER BY total DESC
				LIMIT ?
			`,
        [limit],
      );
      return rows;
    } finally {
      await db.end();
    }
  }

  async countTreeByLevel() {
    const db = await this.createConnection();
    try {
      const [rows]: any = await db.query(`
				SELECT
					q.level_id,
					st.id AS tree_id,
					COUNT(*) AS total
				FROM questions q
				JOIN skill_node sn ON q.node_id = sn.id
				JOIN skill_tree st ON sn.skill_tree_id = st.id
        GROUP BY q.level_id, st.id
				ORDER BY q.level_id, total DESC
			`);
      return rows;
    } finally {
      await db.end();
    }
  }

  async countSkillInTree() {
    const db = await this.createConnection();
    try {
      const [rows]: any = await db.query(`
        SELECT
          q.level_id,
          st.id AS tree_id,
          sn.id AS node_id,
          sn.title AS skill_title,
          sn.node_type,
          MIN(sn.order_index) AS node_order,
          COUNT(*) AS total
        FROM questions q
        JOIN skill_node sn ON q.node_id = sn.id
        JOIN skill_tree st ON sn.skill_tree_id = st.id
        GROUP BY
          q.level_id,
          st.id,
          sn.id,
          sn.title,
          sn.node_type
        ORDER BY q.level_id, st.id, node_order
      `);
      return rows;
    } finally {
      await db.end();
    }
  }

  /**
   * Xây dựng bộ câu hỏi mẫu cho một cấp độ nhất định.
   * Quy tắc:
   *  - mỗi tree có 5 node (node 1: VOCAB, node 2: LISTENING, node 3:SPEAKING, node 4: MATCHING, node 5: REVIEW)
   *  - node 1: lấy 10 câu, node 2: lấy 1 câu, node 3: lấy 1 câu, node 4: lấy 10 câu, node 5: 10 câu (4 câu vocab +4 câu matching + 1 câu listening +1 câu speaking)
   *  - node Review: 4 câu vocab có thể lấy random từ bộ vocab nhưng điều kiện chung level, 4 câu matching có thể lấy random từ bộ matching nhưng điều kiện chung level, 1 câu listening và 1 câu speaking có thể lấy random từ toàn bộ câu listening/speaking của level đó 
   *  - node Review: các câu của node này phải khác hoàn toàn với các câu đã lấy ở node 1,2,3,4 của cùng tree đó (để đảm bảo tính review thực sự, ko bị trùng lắp câu đã học)
   */
  async getSampleQuestionsByLevel(levelId: number) {
    const db = await this.createConnection();
    try {
      // kết nối Mongo
      if (mongoose.connection.readyState === 0) {
        await mongoose.connect(process.env.MONGODB_URI!);
      }

      // lấy tất cả tree của level
      const [trees]: any = await db.query(
        `SELECT id FROM skill_tree 
			 WHERE level_id = ? 
			 ORDER BY order_index`,
        [levelId],
      );

      const result: any[] = [];
      for (const tree of trees) {
        const [nodes]: any = await db.query(
          `SELECT id, title, node_type 
				 FROM skill_node 
				 WHERE skill_tree_id = ? 
				 ORDER BY order_index`,
          [tree.id],
        );

        const treeItem: any = { ...tree, nodes: [] };
        const usedQuestionIds = new Set<number>(); // track câu đã dùng
        const questionsByType = {
          VOCAB: [] as any[],
          LISTENING: [] as any[],
          SPEAKING: [] as any[],
          MATCHING: [] as any[],
        };

        for (const node of nodes) {
          if (node.node_type === "REVIEW") continue;

          // định nghĩa số lượng câu cần lấy cho mỗi loại node
          let limit = 10;
          if (node.node_type === "LISTENING" || node.node_type === "SPEAKING") {
            limit = 1;
          }

          // lấy câu random từ MySQL
          const [qs]: any = await db.query(
            `SELECT id, mongo_question_id, question_type, correct_answer
					 FROM questions
					 WHERE level_id = ? AND node_id = ?
					 ORDER BY RAND()
					 LIMIT ?`,
            [levelId, node.id, limit],
          );

          if (qs.length === 0) {
            treeItem.nodes.push({ ...node, questions: [] });
            continue;
          }

          // lấy toàn bộ mongo_id
          const ids = qs.map((q: any) => q.mongo_question_id);

          // query Mongo 1 lần
          const mongoDocs: any[] = await QuestionModel.find({
            _id: { $in: ids },
          }).lean();

          const mongoMap = new Map(
            mongoDocs.map((d: any) => [d._id.toString(), d]),
          );

          // ghép dữ liệu
          const enrichedQuestions = qs.map((q: any) => {
            const mongoDoc = mongoMap.get(q.mongo_question_id);
            return {
              id: q.id,
              question_text: mongoDoc?.question_text || "",
              options: mongoDoc?.distractors || [],
              correct_answer: q.correct_answer,
              question_type: q.question_type,
              audio_url: mongoDoc?.metadata?.audio_url || "",
              phonetic: mongoDoc?.metadata?.phonetic || "",
            };
          });

          treeItem.nodes.push({
            id: node.id,
            title: node.title,
            node_type: node.node_type,
            questions: enrichedQuestions,
          });

          // lưu vào questionsByType để dùng cho REVIEW node
          questionsByType[node.node_type as keyof typeof questionsByType] =
            enrichedQuestions;

          // track câu đã dùng
          qs.forEach((q: any) => usedQuestionIds.add(q.id));
        }

        // xử lý node REVIEW
        const reviewNode = nodes.find((n: any) => n.node_type === "REVIEW");
        if (reviewNode) {
          const reviewQuestions: any[] = [];

          // lấy 4 câu VOCAB chưa dùng
          if (questionsByType.VOCAB.length > 0) {
            const [vocabQuestions]: any = await db.query(
              `SELECT id, mongo_question_id, question_type, correct_answer
               FROM questions
               WHERE level_id = ? AND question_type = 'VOCAB' AND id NOT IN (?)
               ORDER BY RAND()
               LIMIT 4`,
              [levelId, usedQuestionIds.size > 0 ? Array.from(usedQuestionIds) : [0]],
            );

            if (vocabQuestions.length > 0) {
              const vocabIds = vocabQuestions.map((q: any) => q.mongo_question_id);
              const vocabMongoDocs = await QuestionModel.find({
                _id: { $in: vocabIds },
              }).lean();

              const vocabMongoMap = new Map(
                vocabMongoDocs.map((d: any) => [d._id.toString(), d]),
              );

              vocabQuestions.forEach((q: any) => {
                const mongoDoc = vocabMongoMap.get(q.mongo_question_id);
                reviewQuestions.push({
                  id: q.id,
                  question_text: mongoDoc?.question_text || "",
                  options: mongoDoc?.distractors || [],
                  correct_answer: q.correct_answer,
                  question_type: q.question_type,
                  audio_url: mongoDoc?.metadata?.audio_url || "",
                  phonetic: mongoDoc?.metadata?.phonetic || "",
                });
              });
            }
          }

          // lấy 4 câu MATCHING chưa dùng
          if (questionsByType.MATCHING.length > 0) {
            const [matchingQuestions]: any = await db.query(
              `SELECT id, mongo_question_id, question_type, correct_answer
               FROM questions
               WHERE level_id = ? AND question_type = 'MATCHING' AND id NOT IN (?)
               ORDER BY RAND()
               LIMIT 4`,
              [levelId, usedQuestionIds.size > 0 ? Array.from(usedQuestionIds) : [0]],
            );

            if (matchingQuestions.length > 0) {
              const matchingIds = matchingQuestions.map((q: any) => q.mongo_question_id);
              const matchingMongoDocs = await QuestionModel.find({
                _id: { $in: matchingIds },
              }).lean();

              const matchingMongoMap = new Map(
                matchingMongoDocs.map((d: any) => [d._id.toString(), d]),
              );

              matchingQuestions.forEach((q: any) => {
                const mongoDoc = matchingMongoMap.get(q.mongo_question_id);
                reviewQuestions.push({
                  id: q.id,
                  question_text: mongoDoc?.question_text || "",
                  options: mongoDoc?.distractors || [],
                  correct_answer: q.correct_answer,
                  question_type: q.question_type,
                  audio_url: mongoDoc?.metadata?.audio_url || "",
                  phonetic: mongoDoc?.metadata?.phonetic || "",
                });
              });
            }
          }

          // lấy 1 câu LISTENING chưa dùng
          if (questionsByType.LISTENING.length > 0) {
            const [listeningQuestions]: any = await db.query(
              `SELECT id, mongo_question_id, question_type, correct_answer
               FROM questions
               WHERE level_id = ? AND question_type = 'LISTENING' AND id NOT IN (?)
               ORDER BY RAND()
               LIMIT 1`,
              [levelId, usedQuestionIds.size > 0 ? Array.from(usedQuestionIds) : [0]],
            );

            if (listeningQuestions.length > 0) {
              const listeningIds = listeningQuestions.map((q: any) => q.mongo_question_id);
              const listeningMongoDocs = await QuestionModel.find({
                _id: { $in: listeningIds },
              }).lean();

              const listeningMongoMap = new Map(
                listeningMongoDocs.map((d: any) => [d._id.toString(), d]),
              );

              listeningQuestions.forEach((q: any) => {
                const mongoDoc = listeningMongoMap.get(q.mongo_question_id);
                reviewQuestions.push({
                  id: q.id,
                  question_text: mongoDoc?.question_text || "",
                  options: mongoDoc?.distractors || [],
                  correct_answer: q.correct_answer,
                  question_type: q.question_type,
                  audio_url: mongoDoc?.metadata?.audio_url || "",
                  phonetic: mongoDoc?.metadata?.phonetic || "",
                });
              });
            }
          }

          // lấy 1 câu SPEAKING chưa dùng
          if (questionsByType.SPEAKING.length > 0) {
            const [speakingQuestions]: any = await db.query(
              `SELECT id, mongo_question_id, question_type, correct_answer
               FROM questions
               WHERE level_id = ? AND question_type = 'SPEAKING' AND id NOT IN (?)
               ORDER BY RAND()
               LIMIT 1`,
              [levelId, usedQuestionIds.size > 0 ? Array.from(usedQuestionIds) : [0]],
            );

            if (speakingQuestions.length > 0) {
              const speakingIds = speakingQuestions.map((q: any) => q.mongo_question_id);
              const speakingMongoDocs = await QuestionModel.find({
                _id: { $in: speakingIds },
              }).lean();

              const speakingMongoMap = new Map(
                speakingMongoDocs.map((d: any) => [d._id.toString(), d]),
              );

              speakingQuestions.forEach((q: any) => {
                const mongoDoc = speakingMongoMap.get(q.mongo_question_id);
                reviewQuestions.push({
                  id: q.id,
                  question_text: mongoDoc?.question_text || "",
                  options: mongoDoc?.distractors || [],
                  correct_answer: q.correct_answer,
                  question_type: q.question_type,
                  audio_url: mongoDoc?.metadata?.audio_url || "",
                  phonetic: mongoDoc?.metadata?.phonetic || "",
                });
              });
            }
          }

          treeItem.nodes.push({
            id: reviewNode.id,
            title: reviewNode.title,
            node_type: reviewNode.node_type,
            questions: reviewQuestions,
          });
        }

        result.push(treeItem);
      }

      return result;
    } finally {
      await db.end();
    }
  }
}
