// Logic AI phân loại topic
import { pipeline } from "@xenova/transformers";
import { topicTrainingData } from "./topic-data.ts";

let extractor: any = null;
// Lưu vector centroid embedding của từng topic
const topicEmbeddings: Record<number, number[]> = {};
// Lưu embedding từng câu mẫu của topic để chấm kiểu nearest-neighbor
const topicSampleEmbeddings: Record<number, number[][]> = {};
// Từ khóa đại diện cho từng topic (lấy từ training samples)
const topicKeywordSets: Record<number, Set<string>> = {};
// Trạng thái lazy-load embedding theo topic
const topicReady: Record<number, boolean> = {};
const topicBuildPromises: Record<number, Promise<void>> = {};

const SCORE_WEIGHTS = {
  centroid: 0.55,
  nearestSample: 0.3,
  keywordOverlap: 0.15,
};

function getDynamicScoreWeights(tokenCount: number) {
  // Với input rất ngắn (1-2 từ), ưu tiên lexical overlap để giảm lệch topic.
  if (tokenCount <= 2) {
    return {
      centroid: 0.2,
      nearestSample: 0.2,
      keywordOverlap: 0.6,
    };
  }

  // Input ngắn vừa (3-4 từ): cân bằng giữa ngữ nghĩa và lexical.
  if (tokenCount <= 4) {
    return {
      centroid: 0.4,
      nearestSample: 0.25,
      keywordOverlap: 0.35,
    };
  }

  return SCORE_WEIGHTS;
}

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

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s']/g, " ");
}

function tokenize(text: string): string[] {
  return normalizeText(text).split(/\s+/).filter(Boolean);
}

function keywordOverlapScore(sentenceTokens: Set<string>, topicId: number): number {
  const keywords = topicKeywordSets[topicId];
  if (!keywords || keywords.size === 0 || sentenceTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of sentenceTokens) {
    if (keywords.has(token)) overlap++;
  }

  return overlap / sentenceTokens.size;
}

// Create embedding vector
async function createEmbedding(text: string): Promise<number[]> {
  const output = await extractor(text, {
    pooling: "mean",
    normalize: true,
  });

  return Array.from(output.data);
}

async function buildTopicAssets(topicId: number): Promise<void> {
  if (topicReady[topicId]) return;

  const inFlight = topicBuildPromises[topicId];
  if (inFlight) {
    await inFlight;
    return;
  }

  const buildPromise = (async () => {
    const samples = topicTrainingData[topicId] || [];
    if (!samples.length) {
      topicEmbeddings[topicId] = [];
      topicSampleEmbeddings[topicId] = [];
      topicKeywordSets[topicId] = new Set();
      topicReady[topicId] = true;
      return;
    }

    const sampleVectors: number[][] = [];
    const keywordSet = new Set<string>();

    for (const sample of samples) {
      const emb = await createEmbedding(sample);
      sampleVectors.push(emb);

      for (const token of tokenize(sample)) {
        if (token.length >= 3) keywordSet.add(token);
      }
    }

    const centroid = sampleVectors[0].map((_: number, i: number) =>
      sampleVectors.reduce((sum: number, vector: number[]) => sum + vector[i], 0) /
      sampleVectors.length,
    );

    topicEmbeddings[topicId] = centroid;
    topicSampleEmbeddings[topicId] = sampleVectors;
    topicKeywordSets[topicId] = keywordSet;
    topicReady[topicId] = true;
  })();

  topicBuildPromises[topicId] = buildPromise;

  try {
    await buildPromise;
  } finally {
    delete topicBuildPromises[topicId];
  }
}

function nearestSampleSimilarity(
  sentenceVector: number[],
  sampleVectors: number[][],
): number {
  if (!sampleVectors.length) return 0;

  let best = -1;
  for (const sampleVector of sampleVectors) {
    const score = cosineSimilarity(sentenceVector, sampleVector);
    if (score > best) best = score;
  }

  return best;
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

  // Chỉ load model ở init. Embedding topic sẽ build lazy khi classify.
  console.log("Topic classifier ready (topic embeddings lazy-loaded)");
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

  // Build embedding cho đúng tập candidateTopics để giảm thời gian và tránh dư thừa.
  await Promise.all(candidateTopics.map((topicId) => buildTopicAssets(topicId)));

  const tokenList = tokenize(sentence);
  const sentenceTokens = new Set(tokenList);
  const dynamicWeights = getDynamicScoreWeights(tokenList.length);
  const sentenceVector = await createEmbedding(sentence);

  let bestTopic = candidateTopics[0];
  let bestScore = -Infinity;

  for (const topicId of candidateTopics) {
    const topicVector = topicEmbeddings[topicId];
    if (!topicVector || !topicVector.length) continue;

    const centroidScore = cosineSimilarity(sentenceVector, topicVector);
    const nearestSampleScore = nearestSampleSimilarity(
      sentenceVector,
      topicSampleEmbeddings[topicId] || [],
    );
    const keywordScore = keywordOverlapScore(sentenceTokens, topicId);

    const score =
      dynamicWeights.centroid * centroidScore +
      dynamicWeights.nearestSample * nearestSampleScore +
      dynamicWeights.keywordOverlap * keywordScore;

    if (score > bestScore) {
      bestScore = score;
      bestTopic = topicId;
    }
  }

  return bestTopic;
}
