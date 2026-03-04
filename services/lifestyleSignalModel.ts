import AsyncStorage from "@react-native-async-storage/async-storage";

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

const MODEL_KEY = "lifestyle_signal_model_v2_weights";
const VOCAB_KEY = "lifestyle_signal_model_v2_vocab";

// ============================================================================
// Text Processing Utilities
// ============================================================================

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

// ============================================================================
// Pure JS Neural Network Implementation (No TensorFlow required)
// ============================================================================

/** Random initialization with He Normal */
function heNormal(fanIn: number): number {
  const std = Math.sqrt(2.0 / fanIn);
  const u1 = Math.random();
  const u2 = Math.random();
  return std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x))));
}

function relu(x: number): number {
  return Math.max(0, x);
}

function reluDerivative(x: number): number {
  return x > 0 ? 1 : 0;
}

/** Dense layer */
interface DenseLayer {
  weights: number[][]; // [inputDim][outputDim]
  biases: number[];
  activation: "relu" | "sigmoid" | "none";
}

interface LayerOutput {
  preActivation: number[];
  postActivation: number[];
}

function createDenseLayer(
  inputDim: number,
  outputDim: number,
  activation: "relu" | "sigmoid" | "none"
): DenseLayer {
  const weights: number[][] = [];
  for (let i = 0; i < inputDim; i++) {
    const row: number[] = [];
    for (let j = 0; j < outputDim; j++) {
      row.push(heNormal(inputDim));
    }
    weights.push(row);
  }
  const biases = new Array(outputDim).fill(0);
  return { weights, biases, activation };
}

function forwardDenseLayer(layer: DenseLayer, input: number[]): LayerOutput {
  const outputDim = layer.biases.length;
  const preActivation: number[] = new Array(outputDim).fill(0);

  for (let j = 0; j < outputDim; j++) {
    let sum = layer.biases[j];
    for (let i = 0; i < input.length; i++) {
      sum += input[i] * layer.weights[i][j];
    }
    preActivation[j] = sum;
  }

  let postActivation: number[];
  if (layer.activation === "relu") {
    postActivation = preActivation.map(relu);
  } else if (layer.activation === "sigmoid") {
    postActivation = preActivation.map(sigmoid);
  } else {
    postActivation = [...preActivation];
  }

  return { preActivation, postActivation };
}

/** Embedding layer - maps integer token IDs to dense vectors */
interface EmbeddingLayer {
  embeddings: number[][]; // [vocabSize][embeddingDim]
  vocabSize: number;
  embeddingDim: number;
}

function createEmbeddingLayer(
  vocabSize: number,
  embeddingDim: number
): EmbeddingLayer {
  const embeddings: number[][] = [];
  const scale = 0.05;
  for (let i = 0; i < vocabSize; i++) {
    const row: number[] = [];
    for (let j = 0; j < embeddingDim; j++) {
      // Simple uniform initialization [-0.05, 0.05]
      row.push((Math.random() - 0.5) * 2 * scale);
    }
    embeddings.push(row);
  }
  return { embeddings, vocabSize, embeddingDim };
}

/** Forward pass: Embedding -> GlobalAveragePooling -> Dense layers */
function forwardEmbeddingWithPooling(
  emb: EmbeddingLayer,
  sequence: number[]
): number[] {
  const seqLen = sequence.length;
  const dim = emb.embeddingDim;

  // Global Average Pooling over the embedded sequence
  const pooled = new Array(dim).fill(0);
  let validCount = 0;

  for (let t = 0; t < seqLen; t++) {
    const tokenId = Math.min(Math.max(0, sequence[t]), emb.vocabSize - 1);
    if (tokenId !== 0) {
      // Skip PAD tokens (index 0)
      for (let d = 0; d < dim; d++) {
        pooled[d] += emb.embeddings[tokenId][d];
      }
      validCount++;
    }
  }

  if (validCount > 0) {
    for (let d = 0; d < dim; d++) {
      pooled[d] /= validCount;
    }
  }

  return pooled;
}

/** Serializable model state */
interface ModelState {
  embedding: {
    embeddings: number[][];
    vocabSize: number;
    embeddingDim: number;
  };
  denseLayers: Array<{
    weights: number[][];
    biases: number[];
    activation: string;
  }>;
  maxSequenceLength: number;
  embeddingDim: number;
  version: string;
}

// ============================================================================
// Synthetic Data Generation
// ============================================================================

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

// ============================================================================
// Main LifestyleSignalModel Class
// ============================================================================

class LifestyleSignalModel {
  private wordIndex: Map<string, number> = new Map();
  private embeddingLayer: EmbeddingLayer | null = null;
  private denseLayers: DenseLayer[] = [];
  private isReady = false;
  private isTraining = false;
  private initPromise: Promise<void> | null = null;

  private maxSequenceLength = 18;
  private embeddingDim = 32;

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      if (this.isReady) return;

      // Try load saved model
      try {
        const vocabData = await AsyncStorage.getItem(VOCAB_KEY);
        const modelData = await AsyncStorage.getItem(MODEL_KEY);
        if (vocabData && modelData) {
          this.wordIndex = new Map(JSON.parse(vocabData));
          const state: ModelState = JSON.parse(modelData);
          this.maxSequenceLength =
            state.maxSequenceLength || this.maxSequenceLength;
          this.embeddingDim = state.embeddingDim || this.embeddingDim;

          // Restore embedding layer
          this.embeddingLayer = {
            embeddings: state.embedding.embeddings,
            vocabSize: state.embedding.vocabSize,
            embeddingDim: state.embedding.embeddingDim,
          };

          // Restore dense layers
          this.denseLayers = state.denseLayers.map((l) => ({
            weights: l.weights,
            biases: l.biases,
            activation: l.activation as "relu" | "sigmoid" | "none",
          }));

          this.isReady = true;
          console.log("[LifestyleSignalModel] Loaded saved model successfully");
          return;
        }
      } catch {
        // ignore
      }

      // Train in background to avoid UI freeze
      console.log(
        "[LifestyleSignalModel] No saved model, will train in background..."
      );
      setTimeout(() => {
        this.train().catch((err) =>
          console.warn("[LifestyleSignalModel] Training failed:", err)
        );
      }, 6000);
    })();
    return this.initPromise;
  }

  private _buildModel(vocabSize: number): void {
    const actualVocabSize = Math.max(2, vocabSize + 2);

    // Embedding layer
    this.embeddingLayer = createEmbeddingLayer(
      actualVocabSize,
      this.embeddingDim
    );

    // Dense layers: embeddingDim -> 64 (relu) -> OUT_DIM (sigmoid)
    this.denseLayers = [
      createDenseLayer(this.embeddingDim, 64, "relu"),
      createDenseLayer(64, OUT_DIM, "sigmoid"),
    ];

    console.log(
      `[LifestyleSignalModel] Model built: Embedding(${actualVocabSize}x${this.embeddingDim}) -> GAP -> Dense(64, relu) -> Dense(${OUT_DIM}, sigmoid)`
    );
  }

  private _forward(sequence: number[]): {
    pooled: number[];
    layerOutputs: LayerOutput[];
    output: number[];
  } {
    if (!this.embeddingLayer) throw new Error("Model not built");

    // Embedding + Global Average Pooling
    const pooled = forwardEmbeddingWithPooling(this.embeddingLayer, sequence);

    // Dense layers
    const layerOutputs: LayerOutput[] = [];
    let currentInput = pooled;
    for (const layer of this.denseLayers) {
      const out = forwardDenseLayer(layer, currentInput);
      layerOutputs.push(out);
      currentInput = out.postActivation;
    }

    return { pooled, layerOutputs, output: currentInput };
  }

  private async train(): Promise<void> {
    if (this.isTraining) return;
    this.isTraining = true;

    try {
      console.log("[LifestyleSignalModel] Starting training...");
      const { xsText, ys } = makeSyntheticDataset(700);
      this.wordIndex = buildWordIndex(xsText, 3000, 1);

      this._buildModel(this.wordIndex.size);

      const xsSeq = xsText.map((t) =>
        textToSequence(t, this.wordIndex, this.maxSequenceLength)
      );

      const learningRate = 0.001;
      const epochs = 4;
      const batchSize = 48;

      for (let epoch = 0; epoch < epochs; epoch++) {
        // Shuffle indices
        const indices = Array.from({ length: xsSeq.length }, (_, i) => i);
        for (let i = indices.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [indices[i], indices[j]] = [indices[j], indices[i]];
        }

        let epochLoss = 0;

        for (let b = 0; b < xsSeq.length; b += batchSize) {
          const batchEnd = Math.min(b + batchSize, xsSeq.length);
          const batchIndices = indices.slice(b, batchEnd);
          const currentBatchSize = batchIndices.length;

          // Accumulate gradients for dense layers
          const denseWeightGrads = this.denseLayers.map((l) =>
            l.weights.map((row) => new Array(row.length).fill(0))
          );
          const denseBiasGrads = this.denseLayers.map((l) =>
            new Array(l.biases.length).fill(0)
          );

          // Accumulate gradients for embedding layer
          const embGrads = new Map<number, number[]>(); // tokenId -> gradient vector

          for (const idx of batchIndices) {
            const sequence = xsSeq[idx];
            const target = ys[idx];

            const { pooled, layerOutputs, output } =
              this._forward(sequence);

            // Binary cross-entropy loss
            for (let k = 0; k < output.length; k++) {
              const p = Math.max(1e-7, Math.min(1 - 1e-7, output[k]));
              epochLoss -= target[k] * Math.log(p) + (1 - target[k]) * Math.log(1 - p);
            }

            // Backprop: output layer gradient for sigmoid + BCE = output - target
            let delta = output.map((o, k) => o - target[k]);

            // Backprop through dense layers
            for (let l = this.denseLayers.length - 1; l >= 0; l--) {
              const layerInput =
                l === 0 ? pooled : layerOutputs[l - 1].postActivation;

              for (let i = 0; i < layerInput.length; i++) {
                for (let j = 0; j < delta.length; j++) {
                  denseWeightGrads[l][i][j] += layerInput[i] * delta[j];
                }
              }
              for (let j = 0; j < delta.length; j++) {
                denseBiasGrads[l][j] += delta[j];
              }

              if (l > 0) {
                const prevDelta = new Array(layerInput.length).fill(0);
                for (let i = 0; i < layerInput.length; i++) {
                  let sum = 0;
                  for (let j = 0; j < delta.length; j++) {
                    sum += this.denseLayers[l].weights[i][j] * delta[j];
                  }
                  prevDelta[i] =
                    sum * reluDerivative(layerOutputs[l - 1].preActivation[i]);
                }
                delta = prevDelta;
              } else {
                // Delta for pooled (embedding gradient)
                const pooledDelta = new Array(pooled.length).fill(0);
                for (let i = 0; i < pooled.length; i++) {
                  let sum = 0;
                  for (let j = 0; j < delta.length; j++) {
                    sum += this.denseLayers[0].weights[i][j] * delta[j];
                  }
                  pooledDelta[i] = sum; // No activation derivative for pooled (it's linear)
                }

                // Distribute gradient to embedding (through average pooling)
                let validCount = 0;
                for (const tokenId of sequence) {
                  if (tokenId !== 0) validCount++;
                }
                if (validCount > 0) {
                  for (const tokenId of sequence) {
                    if (tokenId === 0) continue;
                    if (!embGrads.has(tokenId)) {
                      embGrads.set(
                        tokenId,
                        new Array(this.embeddingDim).fill(0)
                      );
                    }
                    const grad = embGrads.get(tokenId)!;
                    for (let d = 0; d < this.embeddingDim; d++) {
                      grad[d] += pooledDelta[d] / validCount;
                    }
                  }
                }
              }
            }
          }

          // Apply dense layer gradients
          for (let l = 0; l < this.denseLayers.length; l++) {
            for (let i = 0; i < this.denseLayers[l].weights.length; i++) {
              for (
                let j = 0;
                j < this.denseLayers[l].weights[i].length;
                j++
              ) {
                this.denseLayers[l].weights[i][j] -=
                  (learningRate * denseWeightGrads[l][i][j]) / currentBatchSize;
              }
            }
            for (let j = 0; j < this.denseLayers[l].biases.length; j++) {
              this.denseLayers[l].biases[j] -=
                (learningRate * denseBiasGrads[l][j]) / currentBatchSize;
            }
          }

          // Apply embedding gradients
          if (this.embeddingLayer) {
            for (const [tokenId, grad] of embGrads) {
              if (tokenId >= 0 && tokenId < this.embeddingLayer.vocabSize) {
                for (let d = 0; d < this.embeddingDim; d++) {
                  this.embeddingLayer.embeddings[tokenId][d] -=
                    (learningRate * grad[d]) / currentBatchSize;
                }
              }
            }
          }
        }

        const avgLoss = epochLoss / xsSeq.length;
        console.log(
          `[LifestyleSignalModel] Epoch ${epoch + 1}/${epochs}: loss=${avgLoss.toFixed(4)}`
        );

        // Yield control to avoid blocking UI
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      // Save model
      await AsyncStorage.setItem(
        VOCAB_KEY,
        JSON.stringify(Array.from(this.wordIndex.entries()))
      );

      const state: ModelState = {
        embedding: {
          embeddings: this.embeddingLayer!.embeddings,
          vocabSize: this.embeddingLayer!.vocabSize,
          embeddingDim: this.embeddingLayer!.embeddingDim,
        },
        denseLayers: this.denseLayers.map((l) => ({
          weights: l.weights,
          biases: l.biases,
          activation: l.activation,
        })),
        maxSequenceLength: this.maxSequenceLength,
        embeddingDim: this.embeddingDim,
        version: "2.0",
      };
      await AsyncStorage.setItem(MODEL_KEY, JSON.stringify(state));

      this.isReady = true;
      console.log("[LifestyleSignalModel] Training completed and saved");
    } finally {
      this.isTraining = false;
    }
  }

  async infer(description: string): Promise<LifestyleSignals> {
    await this.initialize();

    // Default baseline (safe fallback)
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

    if (!this.embeddingLayer || this.denseLayers.length === 0) {
      // Model not ready yet, use keyword-based fallback
      return this._keywordBasedInfer(description);
    }

    const seq = textToSequence(
      description || "",
      this.wordIndex,
      this.maxSequenceLength
    );
    const { output: probs } = this._forward(seq);

    const decoded = decodeSignals(probs);

    // Convert to rent estimate
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

  /**
   * Keyword-based fallback when model hasn't trained yet
   */
  private _keywordBasedInfer(description: string): LifestyleSignals {
    const lower = (description || "").toLowerCase();

    const hasRent =
      lower.includes("thuê") ||
      lower.includes("trọ") ||
      lower.includes("chung cư") ||
      lower.includes("căn hộ");

    const hasDebt =
      lower.includes("nợ") ||
      lower.includes("trả góp") ||
      lower.includes("vay");

    const hasSavingsGoal =
      lower.includes("tiết kiệm") ||
      lower.includes("đầu tư") ||
      lower.includes("tích lũy") ||
      lower.includes("mục tiêu");

    const minimalLiving =
      lower.includes("tối giản") ||
      lower.includes("đơn giản") ||
      lower.includes("tiết kiệm");

    let foodOutFrequency: "low" | "medium" | "high" = "low";
    if (
      lower.includes("ăn ngoài nhiều") ||
      lower.includes("nhà hàng") ||
      lower.includes("order")
    ) {
      foodOutFrequency = "high";
    } else if (
      lower.includes("thỉnh thoảng ăn") ||
      lower.includes("đôi khi")
    ) {
      foodOutFrequency = "medium";
    }

    let socialSpending: "low" | "medium" | "high" = "low";
    if (
      lower.includes("tiệc") ||
      lower.includes("nhậu") ||
      lower.includes("karaoke")
    ) {
      socialSpending = "high";
    } else if (lower.includes("cafe") || lower.includes("gặp bạn")) {
      socialSpending = "medium";
    }

    let luxuryInterest: "low" | "medium" | "high" = "low";
    if (
      lower.includes("du lịch nước ngoài") ||
      lower.includes("cao cấp") ||
      lower.includes("shopping nhiều")
    ) {
      luxuryInterest = "high";
    } else if (
      lower.includes("du lịch") ||
      lower.includes("mua sắm") ||
      lower.includes("shopping")
    ) {
      luxuryInterest = "medium";
    }

    let location: "hanoi" | "hcm" | "other" = "other";
    if (lower.includes("hà nội") || lower.includes("ha noi")) {
      location = "hanoi";
    } else if (
      lower.includes("sài gòn") ||
      lower.includes("hcm") ||
      lower.includes("tp.hcm") ||
      lower.includes("tp hcm")
    ) {
      location = "hcm";
    }

    let rentEstimate = 0;
    if (hasRent) {
      // Try to extract amount from text
      const rentMatch = lower.match(
        /thuê\s*(?:trọ|nhà|phòng)?\s*(\d+)\s*(?:tr|triệu)/
      );
      if (rentMatch) {
        rentEstimate = parseInt(rentMatch[1]) * 1_000_000;
      } else {
        rentEstimate =
          location === "hanoi"
            ? 3_000_000
            : location === "hcm"
              ? 4_000_000
              : 3_500_000;
      }
    }

    return {
      hasRent,
      rentEstimate,
      foodOutFrequency,
      socialSpending,
      hasSavingsGoal,
      hasDebt,
      luxuryInterest,
      location,
      minimalLiving,
    };
  }
}

export const lifestyleSignalModel = new LifestyleSignalModel();
