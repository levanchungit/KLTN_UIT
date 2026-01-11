import AsyncStorage from "@react-native-async-storage/async-storage";
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-react-native";
import { parseAmountVN } from "../utils/textPreprocessing";

interface AmountExtractionResult {
  amount: number | null;
  confidence: number;
  tokens: string[];
  labels: string[];
}

type SavedTensor = {
  shape: number[];
  dtype: tf.DataType;
  data: number[];
};

type SavedState = {
  weights: SavedTensor[];
  maxSeqLength: number;
  embeddingDim: number;
};

const MODEL_KEY = "amount_extractor_v2_weights";
const VOCAB_KEY = "amount_extractor_v2_vocab";
const META_KEY = "amount_extractor_v2_meta";

const PAD = "[PAD]";
const UNK = "[UNK]";

function isLetterOrDigit(ch: string) {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return true;
  return ch.toLowerCase() !== ch.toUpperCase();
}

function isDigit(ch: string) {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function normalizeToken(t: string) {
  return (t || "").toLowerCase().trim();
}

function stripNumberSeparators(s: string) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (isDigit(ch)) out += ch;
  }
  return out;
}

function tryParseIntSafe(s: string): number | null {
  const cleaned = stripNumberSeparators(s);
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function unitMultiplier(unit: string) {
  const u = normalizeToken(unit);
  if (
    u === "k" ||
    u === "nghin" ||
    u === "nghìn" ||
    u === "ngan" ||
    u === "ngàn"
  )
    return 1_000;
  if (u === "tr" || u === "trieu" || u === "triệu") return 1_000_000;
  if (u === "d" || u === "đ" || u === "dong" || u === "đồng") return 1;
  return 1;
}

function tokensToAmount(spanTokens: string[]): number | null {
  const toks = spanTokens.map(normalizeToken).filter(Boolean);
  if (toks.length === 0) return null;

  // Find first numeric token
  const firstNumIdx = toks.findIndex((t) => tryParseIntSafe(t) != null);
  if (firstNumIdx < 0) return null;

  const baseNum = tryParseIntSafe(toks[firstNumIdx]);
  if (baseNum == null) return null;

  // If there is a unit token, apply multiplier.
  const unitIdx = toks.findIndex(
    (t, i) => i > firstNumIdx && unitMultiplier(t) !== 1
  );
  if (unitIdx >= 0) {
    const mul = unitMultiplier(toks[unitIdx]);

    // Handle shorthand like "4 tr 8" => 4.8 million, "4 tr 50" => 4.50 million
    const afterUnit = toks.slice(unitIdx + 1);
    const fracToken = afterUnit.find((t) => tryParseIntSafe(t) != null);
    if (mul === 1_000_000 && fracToken != null) {
      const fracRaw = stripNumberSeparators(fracToken);
      if (fracRaw) {
        const frac = Number(fracRaw);
        const denom = Math.pow(10, fracRaw.length);
        const val = (baseNum + frac / denom) * mul;
        return Math.round(val);
      }
    }

    return Math.round(baseNum * mul);
  }

  // No explicit unit => assume number already VND (common OCR/text)
  return Math.round(baseNum);
}

function oneHot(labelId: number, numLabels: number) {
  const v = new Array<number>(numLabels).fill(0);
  v[labelId] = 1;
  return v;
}

function findSubsequence(haystack: string[], needle: string[]) {
  if (needle.length === 0) return -1;
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (normalizeToken(haystack[i + j]) !== normalizeToken(needle[j])) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

class PhoBERTAmountExtractor {
  private model: tf.LayersModel | null = null;
  private vocabMap: Map<string, number> = new Map();
  private isInitialized: boolean = false;
  private maxSeqLength = 20; // Reduced from 28
  private embeddingDim = 32; // Reduced from 64
  private labelMap: Map<number, string> = new Map([
    [0, "O"], // Khác
    [1, "B-AMT"], // Bắt đầu số tiền
    [2, "I-AMT"], // Bên trong số tiền
  ]);

  // A tiny synthetic dataset is used to bootstrap offline inference.
  // Real user feedback should be logged elsewhere and can be used to retrain later.

  private initPromise: Promise<void> | null = null;

  /**
   * Khởi tạo mô hình (lazy, cached)
   */
  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      if (this.isInitialized) return;

      try {
        // Khởi tạo TensorFlow
        await tf.ready();

        // Try load saved model/vocab
        const vocabJson = await AsyncStorage.getItem(VOCAB_KEY);
        const stateJson = await AsyncStorage.getItem(MODEL_KEY);

        if (vocabJson && stateJson) {
          this.vocabMap = new Map(JSON.parse(vocabJson));
          const state = JSON.parse(stateJson) as SavedState;
          this.maxSeqLength = state.maxSeqLength || this.maxSeqLength;
          this.embeddingDim = state.embeddingDim || this.embeddingDim;

          this.model?.dispose?.();
          this.model = this.createModel(
            this.vocabMap.size,
            this.maxSeqLength,
            this.embeddingDim
          );
          const tensors = state.weights.map((w) =>
            tf.tensor(w.data, w.shape, w.dtype)
          );
          this.model.setWeights(tensors);
          tensors.forEach((t) => t.dispose());

          this.isInitialized = true;
          return;
        }

        // Cold start: defer synthetic training to background
        console.log("No saved amount model, will train in background...");
        setTimeout(() => {
          (async () => {
            try {
              await this.trainSynthetic();
              await this.saveModel();
              this.isInitialized = true;
            } catch (err) {
              console.warn("Amount extractor training failed:", err);
            }
          })();
        }, 4000);
      } catch (error) {
        console.warn("❌ Failed to initialize PhoBERT extractor:", error);
      }
    })();
    return this.initPromise;
  }

  private createModel(
    vocabSize: number,
    maxSeqLength: number,
    embeddingDim: number
  ) {
    const model = tf.sequential({
      layers: [
        tf.layers.embedding({
          inputDim: Math.max(2, vocabSize),
          outputDim: embeddingDim,
          inputLength: maxSeqLength,
          maskZero: true,
        }),
        tf.layers.bidirectional({
          layer: tf.layers.lstm({
            units: 20, // Reduced from 32
            returnSequences: true,
            dropout: 0.1,
            recurrentInitializer: "glorotNormal",
            kernelInitializer: "glorotUniform",
          }),
        }),
        tf.layers.timeDistributed({
          layer: tf.layers.dense({
            units: 3,
            activation: "softmax",
          }),
        }),
      ],
    });

    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: "categoricalCrossentropy",
      metrics: ["accuracy"],
    });
    return model;
  }

  /**
   * Tokenize Vietnamese text
   */
  private tokenize(text: string): string[] {
    const s = (text || "").toLowerCase();
    const tokens: string[] = [];
    let buf = "";
    let mode: "none" | "word" | "num" = "none";

    const flush = () => {
      const t = buf.trim();
      if (t) tokens.push(t);
      buf = "";
      mode = "none";
    };

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];

      // Number token: digits + separators (.,)
      if (isDigit(ch)) {
        if (mode !== "num") flush();
        mode = "num";
        buf += ch;
        continue;
      }

      if (mode === "num" && (ch === "." || ch === ",")) {
        const prev = s[i - 1];
        const next = s[i + 1];
        if (isDigit(prev) && isDigit(next)) {
          buf += ch;
          continue;
        }
      }

      if (isLetterOrDigit(ch)) {
        if (mode !== "word") flush();
        mode = "word";
        buf += ch;
        continue;
      }

      // Separator/punctuation
      flush();
    }
    flush();

    // Split compact money tokens like "4tr8" -> ["4","tr","8"] and "450k" -> ["450","k"]
    const out: string[] = [];
    for (const t of tokens) {
      const tt = normalizeToken(t);
      // If token contains both digits and letters, split into parts
      let hasDigit = false;
      let hasLetter = false;
      for (let i = 0; i < tt.length; i++) {
        if (isDigit(tt[i])) hasDigit = true;
        else if (isLetterOrDigit(tt[i])) hasLetter = true;
      }

      if (!hasDigit || !hasLetter) {
        out.push(tt);
        continue;
      }

      let part = "";
      let partMode: "num" | "word" | "none" = "none";
      const pushPart = () => {
        if (part) out.push(part);
        part = "";
        partMode = "none";
      };

      for (let i = 0; i < tt.length; i++) {
        const ch = tt[i];
        const nextMode = isDigit(ch) ? "num" : "word";
        if (partMode !== "none" && nextMode !== partMode) pushPart();
        partMode = nextMode;
        part += ch;
      }
      pushPart();
    }

    return out.filter(Boolean);
  }

  /**
   * Convert tokens to indices
   */
  private tokensToIndices(tokens: string[]): number[] {
    const unkId = this.vocabMap.get(UNK) ?? 1;
    return tokens.map((t) => this.vocabMap.get(normalizeToken(t)) ?? unkId);
  }

  private buildVocabularyFromTokens(tokenLists: string[][]) {
    this.vocabMap.clear();
    this.vocabMap.set(PAD, 0);
    this.vocabMap.set(UNK, 1);

    const freq = new Map<string, number>();
    for (const tokens of tokenLists) {
      for (const t of tokens) {
        const k = normalizeToken(t);
        if (!k) continue;
        freq.set(k, (freq.get(k) || 0) + 1);
      }
    }
    const sorted = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]);
    let idx = 2;
    for (const [tok] of sorted.slice(0, 3998)) {
      if (!this.vocabMap.has(tok)) this.vocabMap.set(tok, idx++);
    }
  }

  private makeSyntheticTextSample() {
    const verbs = [
      "mua",
      "chi",
      "trả",
      "thanh toán",
      "nạp",
      "đổ xăng",
      "ăn",
      "uống",
      "nhận",
    ];
    const objects = [
      "cafe",
      "trà sữa",
      "tiền điện",
      "tiền nước",
      "internet",
      "ăn trưa",
      "grab",
      "xe bus",
      "tiền nhà",
      "học phí",
      "mua sắm",
    ];
    const receiptHeads = [
      "tổng",
      "tổng cộng",
      "thành tiền",
      "thanh toán",
      "cộng tiền hàng",
    ];
    const units = ["k", "nghìn", "ngàn", "tr", "triệu", "đ"];

    const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

    const baseVerb = pick(verbs);
    const obj = pick(objects);

    // Choose amount style
    const style = Math.floor(Math.random() * 5);

    const amountTokens: string[] = [];
    let text = "";

    const num = (min: number, max: number) =>
      Math.floor(min + Math.random() * (max - min));

    if (style === 0) {
      // 45k
      const n = num(10, 500);
      amountTokens.push(String(n), "k");
      text = `${baseVerb} ${obj} ${n}k`;
    } else if (style === 1) {
      // 4tr8 / 4tr50
      const n = num(1, 12);
      const frac =
        Math.random() < 0.6 ? String(num(1, 9)) : String(num(10, 99));
      amountTokens.push(String(n), "tr", frac);
      text = `${baseVerb} ${obj} ${n}tr${frac}`;
    } else if (style === 2) {
      // 2 triệu
      const n = num(1, 15);
      amountTokens.push(String(n), "triệu");
      text = `${baseVerb} ${obj} ${n} triệu`;
    } else if (style === 3) {
      // 32000đ / 32.000đ
      const n = num(10_000, 4_000_000);
      const withSep = Math.random() < 0.7;
      const nStr = withSep
        ? String(n)
            .split("")
            .reverse()
            .map((ch, i) => (i > 0 && i % 3 === 0 ? ch + "." : ch))
            .reverse()
            .join("")
        : String(n);
      amountTokens.push(nStr, "đ");
      text = `${baseVerb} ${obj} ${nStr}đ`;
    } else {
      // Receipt-ish line
      const head = pick(receiptHeads);
      const unit = pick(units);
      if (unit === "tr" || unit === "triệu") {
        const n = num(1, 12);
        amountTokens.push(String(n), unit);
        text = `${head} ${n} ${unit}`;
      } else if (unit === "k" || unit === "nghìn" || unit === "ngàn") {
        const n = num(10, 900);
        amountTokens.push(String(n), unit);
        text = `${head} ${n} ${unit}`;
      } else {
        const n = num(10_000, 9_000_000);
        const nStr = String(n)
          .split("")
          .reverse()
          .map((ch, i) => (i > 0 && i % 3 === 0 ? ch + "." : ch))
          .reverse()
          .join("");
        amountTokens.push(nStr, "đ");
        text = `${head}: ${nStr}đ`;
      }
    }

    return { text, amountTokens };
  }

  private async trainSynthetic(): Promise<void> {
    const NUM_SAMPLES = 900;
    const samples = new Array(NUM_SAMPLES)
      .fill(0)
      .map(() => this.makeSyntheticTextSample());

    const tokenLists: string[][] = [];
    const tokenLabels: number[][] = [];

    for (const s of samples) {
      const toks = this.tokenize(s.text);
      tokenLists.push(toks);

      const labels = new Array(toks.length).fill(0);
      const start = findSubsequence(toks, s.amountTokens);
      if (start >= 0) {
        labels[start] = 1;
        for (
          let i = start + 1;
          i < Math.min(toks.length, start + s.amountTokens.length);
          i++
        ) {
          labels[i] = 2;
        }
      }
      tokenLabels.push(labels);
    }

    this.buildVocabularyFromTokens(tokenLists);
    this.model?.dispose?.();
    this.model = this.createModel(
      this.vocabMap.size,
      this.maxSeqLength,
      this.embeddingDim
    );

    const xsArr: number[][] = [];
    const ysArr: number[][][] = [];

    for (let i = 0; i < tokenLists.length; i++) {
      const toks = tokenLists[i];
      const labels = tokenLabels[i];
      const ids = this.tokensToIndices(toks);

      const x = new Array<number>(this.maxSeqLength).fill(0);
      const y: number[][] = new Array(this.maxSeqLength)
        .fill(0)
        .map(() => oneHot(0, 3));

      const L = Math.min(this.maxSeqLength, ids.length);
      for (let j = 0; j < L; j++) {
        x[j] = ids[j];
        y[j] = oneHot(labels[j] ?? 0, 3);
      }

      xsArr.push(x);
      ysArr.push(y);
    }

    const xs = tf.tensor2d(xsArr, [xsArr.length, this.maxSeqLength], "int32");
    const ys = tf.tensor3d(
      ysArr,
      [ysArr.length, this.maxSeqLength, 3],
      "float32"
    );

    await this.model.fit(xs, ys, {
      epochs: 3, // Reduced from 7
      batchSize: 48, // Increased for faster batches
      shuffle: true,
      validationSplit: 0.08,
    });

    xs.dispose();
    ys.dispose();

    await AsyncStorage.setItem(
      META_KEY,
      JSON.stringify({
        version: 2,
        trainedAt: Date.now(),
        samples: NUM_SAMPLES,
      })
    );
  }

  /**
   * Extract amount using few-shot learning
   */
  async extractAmount(text: string): Promise<AmountExtractionResult> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const tokens = this.tokenize(text);
      if (tokens.length === 0) {
        return { amount: null, confidence: 0, tokens: [], labels: [] };
      }

      if (!this.model) {
        const fallbackAmount = parseAmountVN(text);
        return {
          amount: fallbackAmount,
          confidence: fallbackAmount ? 0.35 : 0,
          tokens,
          labels: tokens.map(() => "O"),
        };
      }

      const ids = this.tokensToIndices(tokens);
      const xArr = new Array<number>(this.maxSeqLength).fill(0);
      const L = Math.min(this.maxSeqLength, ids.length);
      for (let i = 0; i < L; i++) xArr[i] = ids[i];

      const x = tf.tensor2d([xArr], [1, this.maxSeqLength], "int32");
      const y = this.model.predict(x) as tf.Tensor;
      const probs = (await y.array()) as number[][][]; // [1][T][3]
      x.dispose();
      y.dispose();

      const labelIds = probs[0].map((p) => {
        const a = p[0] ?? 0;
        const b = p[1] ?? 0;
        const c = p[2] ?? 0;
        return b >= a && b >= c ? 1 : c >= a && c >= b ? 2 : 0;
      });

      // Find best span starting with B
      let bestStart = -1;
      let bestEnd = -1;
      let bestScore = 0;
      for (let i = 0; i < Math.min(tokens.length, this.maxSeqLength); i++) {
        if (labelIds[i] !== 1) continue;
        let j = i + 1;
        while (
          j < Math.min(tokens.length, this.maxSeqLength) &&
          labelIds[j] === 2
        )
          j++;

        // Average prob of the chosen label across span
        let s = 0;
        for (let k = i; k < j; k++) {
          const lid = labelIds[k];
          const pk = probs[0][k]?.[lid] ?? 0;
          s += pk;
        }
        const avg = s / Math.max(1, j - i);
        if (avg > bestScore) {
          bestScore = avg;
          bestStart = i;
          bestEnd = j;
        }
      }

      const labels = tokens.map((_, idx) => {
        const lid = labelIds[idx] ?? 0;
        return this.labelMap.get(lid) || "O";
      });

      if (bestStart < 0 || bestEnd < 0) {
        const fallbackAmount = parseAmountVN(text);
        return {
          amount: fallbackAmount,
          confidence: fallbackAmount ? 0.25 : 0,
          tokens,
          labels,
        };
      }

      const spanTokens = tokens.slice(bestStart, bestEnd);
      const amount = tokensToAmount(spanTokens);

      if (!amount) {
        const fallbackAmount = parseAmountVN(text);
        return {
          amount: fallbackAmount,
          confidence: fallbackAmount ? 0.25 : 0,
          tokens,
          labels,
        };
      }

      // Keep confidence in [0..1]
      const confidence = Math.max(0, Math.min(1, bestScore));

      return {
        amount,
        confidence,
        tokens,
        labels,
      };
    } catch (error) {
      console.error("❌ PhoBERT extraction failed:", error);

      // Fallback to basic parser
      const amount = parseAmountVN(text);
      return {
        amount,
        confidence: amount ? 0.5 : 0,
        tokens: [],
        labels: [],
      };
    }
  }

  /**
   * Save model to storage
   */
  private async saveModel(): Promise<void> {
    try {
      await AsyncStorage.setItem(
        VOCAB_KEY,
        JSON.stringify(Array.from(this.vocabMap.entries()))
      );

      if (!this.model) return;
      const tensors = this.model.getWeights();
      const weights: SavedTensor[] = [];
      for (const t of tensors) {
        const data = Array.from(t.dataSync() as any).map((v) => Number(v));
        weights.push({
          shape: t.shape,
          dtype: (t.dtype as tf.DataType) || "float32",
          data,
        });
      }

      const state: SavedState = {
        weights,
        maxSeqLength: this.maxSeqLength,
        embeddingDim: this.embeddingDim,
      };

      await AsyncStorage.setItem(MODEL_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("❌ Failed to save model:", error);
    }
  }

  /**
   * Get model info
   */
  getModelInfo() {
    return {
      isInitialized: this.isInitialized,
      vocabSize: this.vocabMap.size,
      modelVersion: 2,
      maxSeqLength: this.maxSeqLength,
    };
  }
}

// Export singleton
export const phobertExtractor = new PhoBERTAmountExtractor();
