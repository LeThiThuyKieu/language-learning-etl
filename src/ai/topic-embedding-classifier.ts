// Logic AI phân loại topic
import { pipeline } from "@xenova/transformers";
import { topicTrainingData } from "./topic-data.ts";

let extractor: any = null;
// Lưu vector embedding của từng topic
const topicEmbeddings: Record<number, number[]> = {};

// Cosine Similarity
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return -1;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

// Create embedding vector
async function createEmbedding(text: string): Promise<number[]> {
  const output = await extractor(text, {
    pooling: "mean",
    normalize: true,
  });

  return Array.from(output.data);
}

// Init classifier
export async function initTopicClassifier() {
  if (extractor) {
    console.log("Topic classifier already initialized");
    return;
  }

  console.log("Loading embedding model...");

  //model
  extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

  console.log("Building topic embeddings...");

  for (const topicIdStr in topicTrainingData) {
    const topicId = Number(topicIdStr);
    const samples = topicTrainingData[topicId];

    // Ghép các câu mẫu thành 1 đoạn text
    const combinedText = samples.join(". ");

    const embedding = await createEmbedding(combinedText);
    topicEmbeddings[topicId] = embedding;
  }
  console.log(`Loaded ${Object.keys(topicEmbeddings).length} topic embeddings`);
}

// Classify sentence trong số các tree thuộc level đó, return skill_tree_id
export async function classifyTopic(
  sentence: string,
  candidateTopics: number[],
): Promise<number> {
  if (!candidateTopics.length) {
    throw new Error("No candidate topics provided");
  }

  if (!extractor) {
    throw new Error("Topic classifier not initialized.");
  }

  const sentenceVector = await createEmbedding(sentence);

  let bestTopic = candidateTopics[0];
  let bestScore = -Infinity;

  for (const topicId of candidateTopics) {
    const topicVector = topicEmbeddings[topicId];
    if (!topicVector) continue;
    const score = cosineSimilarity(sentenceVector, topicVector);
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topicId;
    }
  }

  return bestTopic;
}
