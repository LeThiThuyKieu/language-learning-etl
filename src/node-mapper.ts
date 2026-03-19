import mysql from "mysql2/promise";

/**
 * 1. Lấy toàn bộ Map của Level từ Database để đảm bảo ID luôn chính xác 100%
 * Dùng cái này khi bắt đầu quá trình import/distribute một Level.
 */
export async function getLevelNodeMap(
  db: mysql.Connection,
  levelId: number
): Promise<Record<string, number>> {
  const [nodes]: any = await db.query(
    `
    SELECT sn.id, sn.skill_tree_id, sn.node_type 
    FROM skill_node sn
    JOIN skill_tree st ON sn.skill_tree_id = st.id
    WHERE st.level_id = ?`,
    [levelId]
  );

  const nodeMap: Record<string, number> = {};
  nodes.forEach((node: any) => {
    // Key format: "treeId_TYPE" -> Ví dụ: "10_VOCAB"
    const key = `${node.skill_tree_id}_${node.node_type.toUpperCase()}`;
    nodeMap[key] = node.id;
  });

  return nodeMap;
}

/**
 * 2. Hàm lấy ID an toàn. 
 * Ưu tiên lấy từ Map (DB), nếu không thấy mới dùng công thức tính toán (Fallback).
 */
const NODE_TYPE_INDEX: Record<string, number> = {
  VOCAB: 1,
  LISTENING: 2,
  SPEAKING: 3,
  MATCHING: 4,
  REVIEW: 5,
};
const NODE_PER_TREE = 5;

export function getNodeId(
  skillTreeId: number,
  questionType: string,
  nodeMap?: Record<string, number> // Tham số optional
): number {
  const type = String(questionType || "").trim().toUpperCase();

  // Cách 1: Thử lấy từ Map đã fetch từ DB
  if (nodeMap) {
    const key = `${skillTreeId}_${type}`;
    if (nodeMap[key]) return nodeMap[key];
  }

  // Cách 2: Nếu không có Map hoặc không tìm thấy, dùng công thức 
  const nodeIndex = NODE_TYPE_INDEX[type] ?? 1;
  return (skillTreeId - 1) * NODE_PER_TREE + nodeIndex;
}