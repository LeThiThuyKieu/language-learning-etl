import { pipeline } from "@xenova/transformers";
import {
  difficultyTrainingData,
  listeningDifficultyTrainingData,
  speakingDifficultyTrainingData,
} from "./difficulty-data.ts";

let extractor: any = null;

export type DifficultyLabel = "easy" | "medium" | "hard";
export type DifficultyModality = "GENERAL" | "LISTENING" | "SPEAKING";

const difficultyEmbeddings: Record<string, number[]> = {};
const listeningDifficultyEmbeddings: Record<string, number[]> = {};
const speakingDifficultyEmbeddings: Record<string, number[]> = {};

const CEFR_LEVEL_WEIGHT: Record<string, number> = {
  a1: 0.15,
  a2: 0.3,
  b1: 0.5,
  b2: 0.7,
  c1: 0.88,
  c2: 1,
};

const CEFR_LEXICON: Record<string, Set<string>> = {
  easy: new Set(),
  medium: new Set(),
  hard: new Set(),
};

const levelThresholds = {
  easy: 0.35,
  medium: 0.49,
};

const modalityWeights = {
  GENERAL: {
    embedding: 0.35,
    sentenceLength: 0.2,
    cefrVocabulary: 0.25,
    grammarComplexity: 0.2,
  },
  LISTENING: {
    embedding: 0.3,
    sentenceLength: 0.2,
    cefrVocabulary: 0.25,
    grammarComplexity: 0.25,
  },
  SPEAKING: {
    embedding: 0.15,
    sentenceLength: 0.1,
    cefrVocabulary: 0.35,
    grammarComplexity: 0.4,
  },
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function normalizeText(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9\s']/g, " ");
}

function cosineSimilarity(a: number[], b: number[]) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function createEmbedding(text: string): Promise<number[]> {
  const output = await extractor(text, {
    pooling: "mean",
    normalize: true,
  });

  return Array.from(output.data as Iterable<number>);
}

function sentenceLengthScore(sentence: string) {
  const words = sentence.split(/\s+/).filter(Boolean);
  return clamp01((words.length - 6) / 16);
}

function grammarComplexityScore(sentence: string) {
  const cleaned = normalizeText(sentence);
  const tokens = cleaned.split(/\s+/).filter(Boolean);

  if (!tokens.length) return 0;

  const subordinateMarkers = [
    "which",
    "that",
    "although",
    "unless",
    "while",
    "because",
    "if",
    "since",
    "until",
    "before",
    "after",
    "when",
    "where",
    "whether",
  ];

  const punctuation = (sentence.match(/[,:;()-]/g) || []).length;

  const subordinateCount = tokens.filter((t) =>
    subordinateMarkers.includes(t),
  ).length;

  const morphologyPattern = /(tion|sion|ment|ness|ity|ence|ance)$/;

  const morphologyCount = tokens.filter((t) =>
    morphologyPattern.test(t),
  ).length;

  const clauseScore = clamp01((punctuation + subordinateCount) / 5);
  const morphologyScore = clamp01(morphologyCount / tokens.length);

  return clamp01(0.7 * clauseScore + 0.3 * morphologyScore);
}

function inferVocabularyScore(sentence: string) {
  const tokens = normalizeText(sentence).split(/\s+/).filter(Boolean);

  if (!tokens.length) return 0;

  let total = 0;

  for (const token of tokens) {
    if (CEFR_LEXICON.hard.has(token)) {
      total += CEFR_LEVEL_WEIGHT.c1;
    } else if (CEFR_LEXICON.medium.has(token)) {
      total += CEFR_LEVEL_WEIGHT.b1;
    } else if (CEFR_LEXICON.easy.has(token)) {
      total += CEFR_LEVEL_WEIGHT.a2;
    } else {
      total += 0.45;
    }
  }

  return clamp01(total / tokens.length);
}

function labelFromScore(score: number): DifficultyLabel {
  if (score < levelThresholds.easy) return "easy";
  if (score < levelThresholds.medium) return "medium";
  return "hard";
}

function buildCefrLexicon() {
  if (CEFR_LEXICON.easy.size > 0) return;

  const datasets = [
    difficultyTrainingData,
    listeningDifficultyTrainingData,
    speakingDifficultyTrainingData,
  ];

  for (const dataset of datasets) {
    for (const level of ["easy", "medium", "hard"] as DifficultyLabel[]) {
      for (const sample of dataset[level]) {
        const words = normalizeText(sample).split(/\s+/);

        for (const w of words) {
          if (w.length >= 3) CEFR_LEXICON[level].add(w);
        }
      }
    }
  }
}

async function buildEmbeddings(
  dataset: Record<DifficultyLabel, string[]>,
  bucket: Record<DifficultyLabel, number[]>,
) {
  for (const level of ["easy", "medium", "hard"] as DifficultyLabel[]) {
    const samples = dataset[level];

    const vectors: number[][] = [];

    for (const s of samples) {
      const emb = await createEmbedding(s);
      vectors.push(emb);
    }

    const avg = vectors[0].map((_: number, i: number) =>
      vectors.reduce((sum: number, v: number[]) => sum + v[i], 0) /
      vectors.length,
    );

    bucket[level] = avg;
  }
}

function getEmbeddingBucket(modality: DifficultyModality) {
  if (modality === "LISTENING") return listeningDifficultyEmbeddings;
  if (modality === "SPEAKING") return speakingDifficultyEmbeddings;
  return difficultyEmbeddings;
}

export async function initDifficultyClassifier() {
  if (extractor) return;

  console.log("Loading difficulty model...");

  extractor = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2",
  );

  buildCefrLexicon();

  await buildEmbeddings(difficultyTrainingData, difficultyEmbeddings);
  await buildEmbeddings(
    listeningDifficultyTrainingData,
    listeningDifficultyEmbeddings,
  );
  await buildEmbeddings(
    speakingDifficultyTrainingData,
    speakingDifficultyEmbeddings,
  );

  console.log("Difficulty classifier ready");
}

export async function classifyDifficulty(
  sentence: string,
  modality: DifficultyModality = "GENERAL",
): Promise<DifficultyLabel> {
  if (!extractor) {
    throw new Error("Call initDifficultyClassifier() first");
  }

  const sentenceVector = await createEmbedding(sentence);

  const bucket = getEmbeddingBucket(modality);

  let bestScore = -Infinity;

  for (const level of ["easy", "medium", "hard"] as DifficultyLabel[]) {
    const score = cosineSimilarity(sentenceVector, bucket[level]);

    if (score > bestScore) {
      bestScore = score;
    }
  }

  const embeddingScore = clamp01((bestScore + 1) / 2);

  const signals = {
    embeddingScore,
    sentenceLengthScore: sentenceLengthScore(sentence),
    cefrVocabularyScore: inferVocabularyScore(sentence),
    grammarComplexityScore: grammarComplexityScore(sentence),
  };

  const weights = modalityWeights[modality];

  const finalScore =
    weights.embedding * signals.embeddingScore +
    weights.sentenceLength * signals.sentenceLengthScore +
    weights.cefrVocabulary * signals.cefrVocabularyScore +
    weights.grammarComplexity * signals.grammarComplexityScore;

  return labelFromScore(clamp01(finalScore));
}