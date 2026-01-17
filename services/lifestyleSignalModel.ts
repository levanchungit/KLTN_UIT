import AsyncStorage from "@react-native-async-storage/async-storage";
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-react-native";

export type LifestyleSignals = {
  hasRent: boolean;
  rentEstimate?: number;
  foodOutFrequency: "low" | "medium" | "high";
  socialSpending: "low" | "medium" | "high";
  hasSavingsGoal: boolean;
  hasDebt: boolean;
  luxuryInterest: "low" | "medium" | "high";
  location: "hanoi" | "hcm" | "other";
  minimalLiving: boolean;
};

const MODEL_KEY = "lifestyle_signal_model_v1_weights";
const VOCAB_KEY = "lifestyle_signal_model_v1_vocab";

type SavedTensor = {
  shape: number[];
  dtype: tf.DataType;
  data: number[];
};

type SavedState = {
  weights: SavedTensor[];
  maxSequenceLength: number;
  embeddingDim: number;
};

function isLetterOrDigit(ch: string) {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return true;
  return ch.toLowerCase() !== ch.toUpperCase();
}

function normalizeText(text: string) {
  const lower = (text || "").toLowerCase();
  let out = "";
  let prevSpace = true;
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    if (isLetterOrDigit(ch)) {
      out += ch;
      prevSpace = false;
      continue;
    }
    if (!prevSpace) {
      out += " ";
      prevSpace = true;
    }
  }
  return out.trim();
}

function tokenize(text: string) {
  const t = normalizeText(text);
  if (!t) return [] as string[];
  const parts = t.split(" ");
  const tokens: string[] = [];
  for (const p of parts) if (p) tokens.push(p);
  return tokens;
}

function buildWordIndex(texts: string[], maxVocab = 1500, minFreq = 1) {
  // Reduced from 3000
  const freq = new Map<string, number>();
  for (const text of texts) {
    for (const tok of tokenize(text)) {
      freq.set(tok, (freq.get(tok) || 0) + 1);
    }
  }
  const sorted = Array.from(freq.entries())
    .filter(([, c]) => c >= minFreq)
    .sort((a, b) => b[1] - a[1]);

  const wordIndex = new Map<string, number>();
  // 0 = PAD, 1 = UNK
  let idx = 2;
  for (const [w] of sorted.slice(0, Math.max(0, maxVocab - 2))) {
    wordIndex.set(w, idx++);
  }
  return wordIndex;
}

function textToSequence(
  text: string,
  wordIndex: Map<string, number>,
  maxLen: number
) {
  const toks = tokenize(text);
  const seq = new Array<number>(maxLen).fill(0);
  const unk = 1;
  const L = Math.min(maxLen, toks.length);
  for (let i = 0; i < L; i++) {
    seq[i] = wordIndex.get(toks[i]) ?? unk;
  }
  return seq;
}

// Output layout (16 dims):
// [0] hasRent
// [1] hasDebt
// [2] hasSavingsGoal
// [3] minimalLiving
// [4..6] foodOut one-hot: low/med/high
// [7..9] social one-hot: low/med/high
// [10..12] luxury one-hot: low/med/high
// [13..15] location one-hot: hanoi/hcm/other
const OUT_DIM = 16;

function oneHot3(idx: 0 | 1 | 2) {
  const v = [0, 0, 0];
  v[idx] = 1;
  return v;
}

function pick3(probs: number[], start: number) {
  const a = probs[start] ?? 0;
  const b = probs[start + 1] ?? 0;
  const c = probs[start + 2] ?? 0;
  const m = Math.max(a, b, c);
  if (m === a) return 0;
  if (m === b) return 1;
  return 2;
}

function decodeSignals(
  probs: number[]
): Omit<LifestyleSignals, "rentEstimate"> {
  const hasRent = (probs[0] ?? 0) >= 0.5;
  const hasDebt = (probs[1] ?? 0) >= 0.5;
  const hasSavingsGoal = (probs[2] ?? 0) >= 0.5;
  const minimalLiving = (probs[3] ?? 0) >= 0.5;

  const foodIdx = pick3(probs, 4);
  const socialIdx = pick3(probs, 7);
  const luxuryIdx = pick3(probs, 10);
  const locIdx = pick3(probs, 13);

  const foodOutFrequency =
    foodIdx === 2 ? "high" : foodIdx === 1 ? "medium" : "low";
  const socialSpending =
    socialIdx === 2 ? "high" : socialIdx === 1 ? "medium" : "low";
  const luxuryInterest =
    luxuryIdx === 2 ? "high" : luxuryIdx === 1 ? "medium" : "low";
  const location = locIdx === 0 ? "hanoi" : locIdx === 1 ? "hcm" : "other";

  return {
    hasRent,
    hasDebt,
    hasSavingsGoal,
    minimalLiving,
    foodOutFrequency,
    socialSpending,
    luxuryInterest,
    location,
  };
}

function createModel(
  vocabSize: number,
  maxSequenceLength: number,
  embeddingDim: number
) {
  const model = tf.sequential();
  model.add(
    tf.layers.embedding({
      inputDim: Math.max(2, vocabSize + 2),
      outputDim: embeddingDim,
      inputLength: maxSequenceLength,
    })
  );
  model.add(tf.layers.globalAveragePooling1d({}));
  model.add(tf.layers.dense({ units: 64, activation: "relu" }));
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: OUT_DIM, activation: "sigmoid" }));
  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: "binaryCrossentropy",
  });
  return model;
}

function makeSyntheticDataset(n = 600) {
  const loc: Array<{ phrase: string; idx: 0 | 1 | 2 }> = [
    { phrase: "ở hà nội", idx: 0 },
    { phrase: "sống hà nội", idx: 0 },
    { phrase: "ở sài gòn", idx: 1 },
    { phrase: "tp hcm", idx: 1 },
    { phrase: "tỉnh", idx: 2 },
    { phrase: "quê", idx: 2 },
  ];

  const rent = ["thuê trọ", "thuê nhà", "ở chung cư", "ở căn hộ"];
  const debt = ["đang trả góp", "có nợ", "vay ngân hàng", "trả nợ"];
  const save = ["muốn tiết kiệm", "đầu tư", "tích lũy", "mục tiêu mua nhà"];
  const minimal = ["sống tối giản", "tiết kiệm", "đơn giản"];

  const foodLow = ["ăn ở nhà", "tự nấu", "ăn đơn giản"];
  const foodMed = [
    "thỉnh thoảng ăn ngoài",
    "đôi khi đi ăn",
    "1-2 lần/tuần ăn ngoài",
  ];
  const foodHigh = [
    "ăn ngoài nhiều",
    "order đồ ăn",
    "đi ăn nhà hàng thường xuyên",
  ];

  const socialLow = ["ít đi chơi", "ít cafe", "ít tụ tập"];
  const socialMed = [
    "thỉnh thoảng cafe",
    "đôi khi gặp bạn",
    "thi thoảng đi chơi",
  ];
  const socialHigh = ["hay cafe", "tiệc tùng", "nhậu", "karaoke"];

  const luxLow = ["không mua sắm", "ít shopping", "không du lịch"];
  const luxMed = [
    "thỉnh thoảng mua sắm",
    "đôi khi du lịch",
    "thỉnh thoảng shopping",
  ];
  const luxHigh = [
    "thích du lịch",
    "shopping nhiều",
    "mua đồ cao cấp",
    "du lịch nước ngoài",
  ];

  function sample<T>(arr: T[]) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  const xsText: string[] = [];
  const ys: number[][] = [];

  for (let i = 0; i < n; i++) {
    const locPick = sample(loc);

    const hasRent = Math.random() < 0.55;
    const hasDebt = Math.random() < 0.35;
    const hasSavingsGoal = Math.random() < 0.45;
    const minimalLiving = Math.random() < 0.25;

    const foodIdx: 0 | 1 | 2 = (
      Math.random() < 0.25 ? 0 : Math.random() < 0.6 ? 1 : 2
    ) as any;

    const socialIdx: 0 | 1 | 2 = (
      Math.random() < 0.35 ? 0 : Math.random() < 0.7 ? 1 : 2
    ) as any;

    const luxIdx: 0 | 1 | 2 = (
      Math.random() < 0.35 ? 0 : Math.random() < 0.7 ? 1 : 2
    ) as any;

    const parts: string[] = [locPick.phrase];
    if (hasRent) parts.push(sample(rent));
    if (hasDebt) parts.push(sample(debt));
    if (hasSavingsGoal) parts.push(sample(save));
    if (minimalLiving) parts.push(sample(minimal));

    parts.push(
      foodIdx === 2
        ? sample(foodHigh)
        : foodIdx === 1
        ? sample(foodMed)
        : sample(foodLow)
    );
    parts.push(
      socialIdx === 2
        ? sample(socialHigh)
        : socialIdx === 1
        ? sample(socialMed)
        : sample(socialLow)
    );
    parts.push(
      luxIdx === 2
        ? sample(luxHigh)
        : luxIdx === 1
        ? sample(luxMed)
        : sample(luxLow)
    );

    // Join with commas (natural-ish)
    const text = parts.join(", ");

    const y: number[] = new Array(OUT_DIM).fill(0);
    y[0] = hasRent ? 1 : 0;
    y[1] = hasDebt ? 1 : 0;
    y[2] = hasSavingsGoal ? 1 : 0;
    y[3] = minimalLiving ? 1 : 0;

    const food = oneHot3(foodIdx);
    const soc = oneHot3(socialIdx);
    const lux = oneHot3(luxIdx);
    const l = oneHot3(locPick.idx);
    y.splice(4, 3, ...food);
    y.splice(7, 3, ...soc);
    y.splice(10, 3, ...lux);
    y.splice(13, 3, ...l);

    xsText.push(text);
    ys.push(y);
  }

  return { xsText, ys };
}

class LifestyleSignalModel {
  private wordIndex: Map<string, number> = new Map();
  private model: tf.LayersModel | null = null;
  private isReady = false;
  private isTraining = false;
  private initPromise: Promise<void> | null = null;

  private maxSequenceLength = 18; // Reduced from 24
  private embeddingDim = 32; // Reduced from 48

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      if (this.isReady) return;
      await tf.ready();

      // Try load
      try {
        const vocabData = await AsyncStorage.getItem(VOCAB_KEY);
        const modelData = await AsyncStorage.getItem(MODEL_KEY);
        if (vocabData && modelData) {
          this.wordIndex = new Map(JSON.parse(vocabData));
          const state = JSON.parse(modelData) as SavedState;
          this.maxSequenceLength =
            state.maxSequenceLength || this.maxSequenceLength;
          this.embeddingDim = state.embeddingDim || this.embeddingDim;

          this.model = createModel(
            this.wordIndex.size,
            this.maxSequenceLength,
            this.embeddingDim
          );
          const tensors = state.weights.map((w) =>
            tf.tensor(w.data, w.shape, w.dtype)
          );
          this.model.setWeights(tensors);
          tensors.forEach((t) => t.dispose());

          this.isReady = true;
          return;
        }
      } catch {
        // ignore
      }

      // Train in background to avoid UI freeze
      console.log("No saved lifestyle model, will train in background...");
      setTimeout(() => {
        this.train().catch((err) =>
          console.warn("Lifestyle model training failed:", err)
        );
      }, 6000);
    })();
    return this.initPromise;
  }

  private async train(): Promise<void> {
    if (this.isTraining) return;
    this.isTraining = true;

    try {
      const { xsText, ys } = makeSyntheticDataset(700);
      this.wordIndex = buildWordIndex(xsText, 3000, 1);

      this.model?.dispose?.();
      this.model = createModel(
        this.wordIndex.size,
        this.maxSequenceLength,
        this.embeddingDim
      );

      const xsArr = xsText.map((t) =>
        textToSequence(t, this.wordIndex, this.maxSequenceLength)
      );
      const xs = tf.tensor2d(
        xsArr,
        [xsArr.length, this.maxSequenceLength],
        "int32"
      );
      const y = tf.tensor2d(ys, [ys.length, OUT_DIM], "float32");

      await this.model.fit(xs, y, {
        epochs: 4, // Reduced from 8
        batchSize: 48, // Increased for faster batches
        shuffle: true,
        validationSplit: 0.1,
      });

      xs.dispose();
      y.dispose();

      await AsyncStorage.setItem(
        VOCAB_KEY,
        JSON.stringify(Array.from(this.wordIndex.entries()))
      );

      const tensors = this.model.getWeights();
      const weights: SavedTensor[] = [];
      for (const t of tensors) {
        weights.push({
          shape: t.shape,
          dtype: (t.dtype as tf.DataType) || "float32",
          data: Array.from(t.dataSync() as any),
        });
      }
      const state: SavedState = {
        weights,
        maxSequenceLength: this.maxSequenceLength,
        embeddingDim: this.embeddingDim,
      };
      await AsyncStorage.setItem(MODEL_KEY, JSON.stringify(state));

      this.isReady = true;
    } finally {
      this.isTraining = false;
    }
  }

  async infer(description: string): Promise<LifestyleSignals> {
    await this.initialize();

    // Default baseline (safe)
    const fallback: LifestyleSignals = {
      hasRent: false,
      rentEstimate: 0,
      foodOutFrequency: "low",
      socialSpending: "low",
      hasSavingsGoal: false,
      hasDebt: false,
      luxuryInterest: "low",
      location: "other",
      minimalLiving: false,
    };

    if (!this.model) return fallback;

    const seq = textToSequence(
      description || "",
      this.wordIndex,
      this.maxSequenceLength
    );
    const x = tf.tensor2d([seq], [1, this.maxSequenceLength], "int32");
    const y = this.model.predict(x) as tf.Tensor;
    const probs = Array.from(await y.data()) as number[];
    x.dispose();
    y.dispose();

    const decoded = decodeSignals(probs);

    // Convert to rent estimate (no regex; just location prior)
    let rentEstimate = 0;
    if (decoded.hasRent) {
      rentEstimate =
        decoded.location === "hanoi"
          ? 3_000_000
          : decoded.location === "hcm"
          ? 4_000_000
          : 3_500_000;
    }

    return {
      ...decoded,
      rentEstimate,
    };
  }
}

export const lifestyleSignalModel = new LifestyleSignalModel();
