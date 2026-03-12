import { pipeline } from "@xenova/transformers";
import {
  difficultyTrainingData,
  listeningDifficultyTrainingData,
  speakingDifficultyTrainingData,
} from "./difficulty-data.ts";

let extractor: any = null;

export type DifficultyLabel = "easy" | "medium" | "hard";
export type DifficultyModality = "GENERAL" | "LISTENING" | "SPEAKING";

// Bucket embedding theo từng modality. Mỗi level lưu một vector centroid.
const difficultyEmbeddings: Record<DifficultyLabel, number[]> = {
  easy: [],
  medium: [],
  hard: [],
};
const listeningDifficultyEmbeddings: Record<DifficultyLabel, number[]> = {
  easy: [],
  medium: [],
  hard: [],
};
const speakingDifficultyEmbeddings: Record<DifficultyLabel, number[]> = {
  easy: [],
  medium: [],
  hard: [],
};

// Nguồn dữ liệu train theo từng modality.
const modalityDatasets: Record<DifficultyModality, Record<DifficultyLabel, string[]>> = {
  GENERAL: difficultyTrainingData,
  LISTENING: listeningDifficultyTrainingData,
  SPEAKING: speakingDifficultyTrainingData,
};

// Bucket embedding dùng lúc chạy theo modality.
const modalityEmbeddingBuckets: Record<
  DifficultyModality,
  Record<DifficultyLabel, number[]>
> = {
  GENERAL: difficultyEmbeddings,
  LISTENING: listeningDifficultyEmbeddings,
  SPEAKING: speakingDifficultyEmbeddings,
};

// Trạng thái lazy-load và chống build trùng khi có nhiều request đồng thời.
const modalityEmbeddingReady: Record<DifficultyModality, boolean> = {
  GENERAL: false,
  LISTENING: false,
  SPEAKING: false,
};

const modalityEmbeddingBuildPromises: Partial<
  Record<DifficultyModality, Promise<void>>
> = {};

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

const embeddingLevelAnchors: Record<DifficultyLabel, number> = {
  easy: 0.2,
  medium: 0.5,
  hard: 0.82,
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
  return modalityEmbeddingBuckets[modality];
}

async function ensureEmbeddingsForModality(modality: DifficultyModality) {
  // Bước 1: nếu modality đã được khởi tạo thì thoát ngay.
  if (modalityEmbeddingReady[modality]) return;

  // Bước 2: nếu có request khác đang build modality này thì chờ.
  const inFlight = modalityEmbeddingBuildPromises[modality];
  if (inFlight) {
    await inFlight;
    return;
  }

  // Bước 3: build embeddings một lần rồi đánh dấu modality đã sẵn sàng.
  const buildPromise = (async () => {
    await buildEmbeddings(
      modalityDatasets[modality],
      modalityEmbeddingBuckets[modality],
    );
    modalityEmbeddingReady[modality] = true;
  })();

  modalityEmbeddingBuildPromises[modality] = buildPromise;

  try {
    await buildPromise;
  } finally {
    delete modalityEmbeddingBuildPromises[modality];
  }
}

function embeddingDifficultyScore(
  sentenceVector: number[],
  bucket: Record<DifficultyLabel, number[]>,
) {
  const levels: DifficultyLabel[] = ["easy", "medium", "hard"];

  // Bước 1: tính similarity đã chuẩn hóa cho từng level.
  const normalizedByLevel: Record<DifficultyLabel, number> = {
    easy: 0,
    medium: 0,
    hard: 0,
  };

  for (const level of levels) {
    const cosine = cosineSimilarity(sentenceVector, bucket[level]);
    normalizedByLevel[level] = clamp01((cosine + 1) / 2);
  }

  // Bước 2: dùng softmax để đổi similarity thành xác suất mượt giữa các level.
  const temperature = 6;
  let denominator = 0;
  const softmaxByLevel: Record<DifficultyLabel, number> = {
    easy: 0,
    medium: 0,
    hard: 0,
  };

  for (const level of levels) {
    const value = Math.exp(normalizedByLevel[level] * temperature);
    softmaxByLevel[level] = value;
    denominator += value;
  }

  if (!denominator) return 0.5;

  // Bước 3: tính điểm độ khó kỳ vọng theo trọng số anchor easy/medium/hard.
  return clamp01(
    levels.reduce(
      (sum, level) =>
        sum +
        (softmaxByLevel[level] / denominator) * embeddingLevelAnchors[level],
      0,
    ),
  );
}

export async function initDifficultyClassifier() {
  if (extractor) return;

  // Bước 1: load model embedding một lần cho toàn bộ tiến trình.
  console.log("Loading difficulty model...");

  extractor = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2",
  );

  // Bước 2: build CEFR lexicon một lần; embedding theo modality sẽ lazy-load sau.
  buildCefrLexicon();

  console.log("Difficulty classifier ready (embeddings lazy-loaded by modality)");
}

export async function classifyDifficulty(
  sentence: string,
  modality: DifficultyModality = "GENERAL",
): Promise<DifficultyLabel> {
  if (!extractor) {
    throw new Error("Call initDifficultyClassifier() first");
  }

  // Bước 1: đảm bảo embeddings của modality hiện tại đã sẵn sàng.
  await ensureEmbeddingsForModality(modality);

  // Bước 2: tạo embedding cho câu và suy ra điểm độ khó từ embedding.
  const sentenceVector = await createEmbedding(sentence);

  const bucket = getEmbeddingBucket(modality);
  const embeddingScore = embeddingDifficultyScore(sentenceVector, bucket);

  // Bước 3: kết hợp điểm embedding với các tín hiệu ngôn ngữ theo luật.
  const signals = {
    embeddingScore,
    sentenceLengthScore: sentenceLengthScore(sentence),
    cefrVocabularyScore: inferVocabularyScore(sentence),
    grammarComplexityScore: grammarComplexityScore(sentence),
  };

  const weights = modalityWeights[modality];

  // Bước 4: trộn điểm theo trọng số và map ngưỡng sang easy/medium/hard.
  const finalScore =
    weights.embedding * signals.embeddingScore +
    weights.sentenceLength * signals.sentenceLengthScore +
    weights.cefrVocabulary * signals.cefrVocabularyScore +
    weights.grammarComplexity * signals.grammarComplexityScore;

  return labelFromScore(clamp01(finalScore));
}