import { pipeline } from "@xenova/transformers";
import { difficultyTrainingData } from "./difficulty-data.ts";

let extractor: any = null;
const difficultyEmbeddings: Record<string, number[]> = {};

// cosine similarity
function cosineSimilarity(a: number[], b: number[]): number {
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

//create embedding
async function createEmbedding(text: string): Promise<number[]> {
  const output = await extractor(text, {
    pooling: "mean",
    normalize: true
  });
  return Array.from(output.data);
}

export async function initDifficultyClassifier() {
  if (extractor) {
    console.log("Difficulty classifier already initialized");
    return;
  }
  console.log("Loading difficulty embedding model...");

  extractor = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2"
  );
  console.log("Building difficulty embeddings...");

for (const level of Object.keys(difficultyTrainingData) as Array<"easy" | "medium" | "hard">){
    const samples = difficultyTrainingData[level];
    const combinedText = samples.join(". ");
    const embedding = await createEmbedding(combinedText);
    difficultyEmbeddings[level] = embedding;
  }

  console.log("Difficulty classifier ready");
}

export async function classifyDifficulty(
  sentence: string
): Promise<"easy" | "medium" | "hard"> {
  if (!extractor) {
    throw new Error(
      "Difficulty classifier not initialized. Call initDifficultyClassifier() first."
    );
  }
  const sentenceVector = await createEmbedding(sentence);
  let bestLevel: "easy" | "medium" | "hard" = "easy";
  let bestScore = -Infinity;
  for (const level in difficultyEmbeddings) {
    const score = cosineSimilarity(
      sentenceVector,
      difficultyEmbeddings[level]
    );

    if (score > bestScore) {
      bestScore = score;
      bestLevel = level as "easy" | "medium" | "hard";
    }
  }

  return bestLevel;
}