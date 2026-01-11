import AsyncStorage from "@react-native-async-storage/async-storage";
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-react-native";

export type TransactionAction =
  | "CREATE_TRANSACTION"
  | "VIEW_STATS"
  | "EDIT_TRANSACTION"
  | "DELETE_TRANSACTION";

type SavedTensor = {
  shape: number[];
  dtype: tf.DataType;
  data: number[];
};

type SavedState = {
  weights: SavedTensor[];
  vocab: Array<[string, number]>;
  maxSeqLength: number;
  embeddingDim: number;
  labels: TransactionAction[];
};

const MODEL_KEY = "transaction_intent_v1_weights";

const PAD = "[PAD]";
const UNK = "[UNK]";

function isLetterOrDigit(ch: string) {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return true;
  return ch.toLowerCase() !== ch.toUpperCase();
}

function normalizeToken(t: string) {
  return (t || "").toLowerCase().trim();
}

function tokenize(text: string): string[] {
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
    const isDigit = ch >= "0" && ch <= "9";

    if (isDigit) {
      if (mode !== "num") flush();
      mode = "num";
      buf += ch;
      continue;
    }

    if (isLetterOrDigit(ch)) {
      if (mode !== "word") flush();
      mode = "word";
      buf += ch;
      continue;
    }

    flush();
  }
  flush();
  return tokens.map(normalizeToken).filter(Boolean);
}

function buildVocab(tokenLists: string[][], maxVocab = 1500) {
  // Reduced from 2500
  const vocab = new Map<string, number>();
  vocab.set(PAD, 0);
  vocab.set(UNK, 1);

  const freq = new Map<string, number>();
  for (const list of tokenLists) {
    for (const t of list) {
      const k = normalizeToken(t);
      if (!k) continue;
      freq.set(k, (freq.get(k) || 0) + 1);
    }
  }

  const sorted = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]);
  let idx = 2;
  for (const [tok] of sorted.slice(0, Math.max(0, maxVocab - 2))) {
    if (!vocab.has(tok)) vocab.set(tok, idx++);
  }
  return vocab;
}

function argmax(xs: number[]) {
  let best = 0;
  let bestVal = xs[0] ?? -Infinity;
  for (let i = 1; i < xs.length; i++) {
    const v = xs[i] ?? -Infinity;
    if (v > bestVal) {
      bestVal = v;
      best = i;
    }
  }
  return best;
}

class TransactionIntentClassifier {
  private model: tf.LayersModel | null = null;
  private vocab = new Map<string, number>();
  private labels: TransactionAction[] = [
    "CREATE_TRANSACTION",
    "VIEW_STATS",
    "EDIT_TRANSACTION",
    "DELETE_TRANSACTION",
  ];

  private isReady = false;
  private isTraining = false;

  private maxSeqLength = 16; // Reduced from 20
  private embeddingDim = 32; // Reduced from 48

  private createModel(
    vocabSize: number,
    maxSeqLength: number,
    embeddingDim: number
  ) {
    const model = tf.sequential();
    model.add(
      tf.layers.embedding({
        inputDim: Math.max(2, vocabSize),
        outputDim: embeddingDim,
        inputLength: maxSeqLength,
        maskZero: true,
      })
    );
    model.add(tf.layers.globalAveragePooling1d({}));
    model.add(tf.layers.dense({ units: 64, activation: "relu" }));
    model.add(tf.layers.dropout({ rate: 0.15 }));
    model.add(
      tf.layers.dense({ units: this.labels.length, activation: "softmax" })
    );

    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: "categoricalCrossentropy",
      metrics: ["accuracy"],
    });

    return model;
  }

  private tokensToIds(tokens: string[]) {
    const unkId = this.vocab.get(UNK) ?? 1;
    return tokens.map((t) => this.vocab.get(normalizeToken(t)) ?? unkId);
  }

  private makeSyntheticSamples(n = 700) {
    const view = [
      "xem thống kê",
      "xem báo cáo",
      "thống kê tháng này",
      "báo cáo chi tiêu",
      "phân tích chi tiêu",
      "tổng kết",
    ];
    const edit = [
      "sửa giao dịch",
      "chỉnh sửa giao dịch",
      "cập nhật giao dịch",
      "đổi số tiền giao dịch",
      "đổi danh mục",
    ];
    const del = [
      "xóa giao dịch",
      "hủy giao dịch",
      "xóa giao dịch cuối",
      "xóa giao dịch vừa tạo",
    ];

    const create = [
      "mua cafe 45k",
      "ăn trưa 50k",
      "trả tiền nhà 4tr",
      "đổ xăng 70k",
      "nhận lương 15tr",
      "chi 120k mua đồ",
      "mua sắm 300k",
    ];

    const noise = [
      "giúp tôi",
      "nhắc nhở",
      "ok",
      "hôm nay",
      "ngày mai",
      "cảm ơn",
      "cho tôi xem",
    ];

    const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

    const out: Array<{ text: string; label: TransactionAction }> = [];

    for (let i = 0; i < n; i++) {
      const r = Math.random();
      if (r < 0.15)
        out.push({ text: pick(view) + " " + pick(noise), label: "VIEW_STATS" });
      else if (r < 0.25)
        out.push({
          text: pick(edit) + " " + pick(noise),
          label: "EDIT_TRANSACTION",
        });
      else if (r < 0.35)
        out.push({
          text: pick(del) + " " + pick(noise),
          label: "DELETE_TRANSACTION",
        });
      else
        out.push({
          text: pick(create) + " " + (Math.random() < 0.4 ? pick(noise) : ""),
          label: "CREATE_TRANSACTION",
        });
    }

    return out;
  }

  private async trainSynthetic() {
    if (this.isTraining) return;
    this.isTraining = true;

    try {
      const samples = this.makeSyntheticSamples(800);
      const tokenLists = samples.map((s) => tokenize(s.text));
      this.vocab = buildVocab(tokenLists, 2500);

      this.model?.dispose?.();
      this.model = this.createModel(
        this.vocab.size,
        this.maxSeqLength,
        this.embeddingDim
      );

      const xsArr: number[][] = [];
      const ysArr: number[][] = [];

      for (const s of samples) {
        const toks = tokenize(s.text);
        const ids = this.tokensToIds(toks);

        const x = new Array<number>(this.maxSeqLength).fill(0);
        for (let i = 0; i < Math.min(ids.length, this.maxSeqLength); i++)
          x[i] = ids[i];
        xsArr.push(x);

        const y = new Array<number>(this.labels.length).fill(0);
        y[this.labels.indexOf(s.label)] = 1;
        ysArr.push(y);
      }

      const xs = tf.tensor2d(xsArr, [xsArr.length, this.maxSeqLength], "int32");
      const ys = tf.tensor2d(
        ysArr,
        [ysArr.length, this.labels.length],
        "float32"
      );

      await this.model.fit(xs, ys, {
        epochs: 4, // Reduced from 8
        batchSize: 48, // Increased for faster batches
        shuffle: true,
        validationSplit: 0.1,
      });

      xs.dispose();
      ys.dispose();

      const tensors = this.model.getWeights();
      const weights: SavedTensor[] = tensors.map((t) => ({
        shape: t.shape,
        dtype: (t.dtype as tf.DataType) || "float32",
        data: Array.from(t.dataSync() as any).map((v) => Number(v)),
      }));

      const state: SavedState = {
        weights,
        vocab: Array.from(this.vocab.entries()),
        maxSeqLength: this.maxSeqLength,
        embeddingDim: this.embeddingDim,
        labels: this.labels,
      };

      await AsyncStorage.setItem(MODEL_KEY, JSON.stringify(state));
      this.isReady = true;
    } finally {
      this.isTraining = false;
    }
  }

  async initialize(): Promise<void> {
    if (this.isReady) return;
    await tf.ready();

    try {
      const stateJson = await AsyncStorage.getItem(MODEL_KEY);
      if (stateJson) {
        const state = JSON.parse(stateJson) as SavedState;
        this.maxSeqLength = state.maxSeqLength || this.maxSeqLength;
        this.embeddingDim = state.embeddingDim || this.embeddingDim;
        this.labels = state.labels || this.labels;
        this.vocab = new Map(state.vocab || []);

        this.model?.dispose?.();
        this.model = this.createModel(
          this.vocab.size,
          this.maxSeqLength,
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
      // ignore load errors
    }

    await this.trainSynthetic();
  }

  async predictAction(
    text: string
  ): Promise<{ action: TransactionAction; confidence: number }> {
    await this.initialize();

    if (!this.model) {
      return { action: "CREATE_TRANSACTION", confidence: 0 };
    }

    const toks = tokenize(text);
    const ids = this.tokensToIds(toks);
    const x = new Array<number>(this.maxSeqLength).fill(0);
    for (let i = 0; i < Math.min(ids.length, this.maxSeqLength); i++)
      x[i] = ids[i];

    const xt = tf.tensor2d([x], [1, this.maxSeqLength], "int32");
    const yt = this.model.predict(xt) as tf.Tensor;
    const probs = Array.from(await yt.data()) as number[];
    xt.dispose();
    yt.dispose();

    const idx = argmax(probs);
    const confidence = Math.max(0, Math.min(1, probs[idx] ?? 0));
    const action = this.labels[idx] || "CREATE_TRANSACTION";
    return { action, confidence };
  }
}

export const transactionIntentClassifier = new TransactionIntentClassifier();
