import mysql from "mysql2/promise";
import * as dotenv from "dotenv";

dotenv.config({ quiet: true });

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
					st.title AS tree_title,
					COUNT(*) AS total
				FROM questions q
				JOIN skill_node sn ON q.node_id = sn.id
				JOIN skill_tree st ON sn.skill_tree_id = st.id
				GROUP BY q.level_id, st.id, st.title
				ORDER BY q.level_id, total DESC
			`);
			return rows;
		} finally {
			await db.end();
		}
	}
}
