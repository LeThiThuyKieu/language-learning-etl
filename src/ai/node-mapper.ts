// map question_type -> node index (order_index trong bảng skill_node)
const NODE_TYPE_INDEX: Record<string, number> = {
  VOCAB: 1,
  LISTENING: 2,
  SPEAKING: 3,
  MATCHING: 4,
  REVIEW: 5,
};

const NODE_PER_TREE = 5; //1 tree có 5 node tương ứng với 5 question type ở trên

export function mapNodeId(
  skillTreeId: number,
  questionType: string
): number {
  const normalizedType = String(questionType || "")
    .trim()
    .toUpperCase();
  const nodeIndex = NODE_TYPE_INDEX[normalizedType] ?? 1;
  return (skillTreeId - 1) * NODE_PER_TREE + nodeIndex;
}