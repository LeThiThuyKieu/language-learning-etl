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
   *  - node 1,2,3,4 : mỗi node lấy random ra 10 câu hỏi trong bộ câu hỏi trong node đó
   *  - nút review lấy random 10 trong số 40 câu đã được chọn từ các node 1,2,3,4
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
        `SELECT id, title FROM skill_tree 
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
        let accumulated: any[] = []; //mang chứa 40 câu để chọn 10 câu cho node REVIEW
        for (const node of nodes) {
          if (node.node_type === "REVIEW") continue;
          // lấy 10 câu random từ MySQL
          const [qs]: any = await db.query(
            `SELECT id, mongo_question_id, question_type, correct_answer
					 FROM questions
					 WHERE level_id = ? AND node_id = ?
					 ORDER BY RAND()
					 LIMIT 10`,
            [levelId, node.id],
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

          accumulated.push(...enrichedQuestions);
        }

        // xử lý node REVIEW
        const reviewNode = nodes.find((n: any) => n.node_type === "REVIEW");
        if (reviewNode && accumulated.length > 0) {
          const shuffled = [...accumulated].sort(() => 0.5 - Math.random());
          const reviewQs = shuffled.slice(0, 10);
          treeItem.nodes.push({
            id: reviewNode.id,
            title: reviewNode.title,
            node_type: reviewNode.node_type,
            questions: reviewQs,
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
