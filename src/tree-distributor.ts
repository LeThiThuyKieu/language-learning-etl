import mysql from "mysql2/promise";

//Lấy danh sách tree theo level_id
export async function getTreesByLevel(
  mysqlConn: mysql.Connection,
  levelId: number
): Promise<number[]> {
  const [rows]: any = await mysqlConn.execute(
    `SELECT id FROM skill_tree WHERE level_id = ? ORDER BY id`,
    [levelId]
  );

  return rows.map((r: any) => r.id);
}

// chia đều các question vào các tree tương ứng với level của nó
// export function distributeByTree(
//   questions: any[],
//   treeIds: number[]
// ): Record<number, any[]> {
//   if (!treeIds.length) return {};
//   const perTree = Math.ceil(questions.length / treeIds.length);
//   const map: Record<number, any[]> = {};
//   treeIds.forEach((treeId, index) => {
//     const start = index * perTree;
//     const end = start + perTree;
//     map[treeId] = questions.slice(start, end);
//   });
//   return map;
// }

export function distributeByTree(
  questions: any[],
  treeIds: number[]
): Record<number, any[]> {
  if (!treeIds.length) return {};

  const map: Record<number, any[]> = {};
  
  // Khởi tạo mảng rỗng cho tất cả treeId có trong level
  treeIds.forEach(id => {
    map[id] = [];
  });

  // Chia câu hỏi theo kiểu xoay vòng (Round-robin)
  questions.forEach((q, index) => {
    const targetTreeId = treeIds[index % treeIds.length];
    map[targetTreeId].push(q);
  });

  return map;
}