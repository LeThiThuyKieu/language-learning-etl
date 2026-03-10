// sau khi có phân loại câu hỏi theo topic (skill-tree) rồi thì tiếp tục phân loại nó vào 1 trong 4 node (4 dạng bài) theo type
// map question_type -> node index (cũng chính là order_index trong bảng skill-node)
const nodeTypeIndex: Record<string, number> = {
  VOCAB: 1,
  LISTENING: 2,
  SPEAKING: 3,
  MATCHING: 4,
  REVIEW: 5
};

// map skillTreeId -> nodeId
export function mapNodeId(
  skillTreeId: number,
  questionType: string
): number {
  const nodeIndex = nodeTypeIndex[questionType.toUpperCase()] || 1;
  // công thức tính node_id
  const nodeId = (skillTreeId - 1) * 5 + nodeIndex;
  return nodeId;
}
