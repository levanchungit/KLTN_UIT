import { db, openDb } from "@/db";
import type { Category } from "@/repos/categoryRepo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-react-native";

interface TrainingData {
  note: string;
  categoryId: string;
  amount?: number; // Optional: for contextual learning
}

interface PredictionResult {
  categoryId: string;
  confidence: number;
  categoryName?: string;
  categoryIcon?: string;
}

interface CategoryProfile {
  categoryId: string;
  categoryName: string;
  vector: number[]; // Vector TF-IDF trung bình cho danh mục này
  sampleCount: number;
}

const MODEL_STORAGE_KEY = "transaction_classifier_neural_weights";
const VOCAB_STORAGE_KEY = "transaction_classifier_neural_vocab";
const LABELS_STORAGE_KEY = "transaction_classifier_neural_labels";
const META_STORAGE_KEY = "transaction_classifier_neural_meta";
const MIN_TRAINING_SAMPLES = 10; // Số mẫu tối thiểu để huấn luyện

type SavedTensor = {
  shape: number[];
  dtype: tf.DataType;
  data: number[];
};

type SavedNeuralState = {
  weights: SavedTensor[];
  maxSequenceLength: number;
  embeddingDim: number;
};

type SavedMeta = {
  version: number;
  trainedAt: number;
  samples: number;
  categories: number;
};

function isLetterOrDigit(ch: string) {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return true;
  // Unicode-safe-ish letter check (works for Vietnamese letters too)
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
    // whitespace / punctuation -> single space
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
  for (const p of parts) {
    if (p) tokens.push(p);
  }
  return tokens;
}

function buildWordIndex(texts: string[], maxVocab = 1500, minFreq = 1) {
  // Optimized for performance
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
    const id = wordIndex.get(toks[i]) ?? unk;
    seq[i] = id;
  }
  return seq;
}

function argTopK(probs: number[], k: number) {
  const idxs = probs.map((_, i) => i);
  idxs.sort((a, b) => probs[b] - probs[a]);
  return idxs.slice(0, k);
}

/**
 * Augment note with amount context for better classification
 * "trà sữa" + 45000 → "trà sữa 45k"
 * "trà sữa" + 150000 → "trà sữa 150k"
 */
function augmentNoteWithAmount(note: string, amount?: number | null): string {
  if (!amount || amount <= 0) return note;

  // Format amount to Vietnamese style
  const amountStr =
    amount >= 1000000
      ? `${(amount / 1000000).toFixed(1)}tr`
      : amount >= 1000
      ? `${Math.round(amount / 1000)}k`
      : `${amount}`;

  // Append amount to note if not already present
  if (!note.match(/\d+k|\d+tr|\d+đ/i)) {
    return `${note} ${amountStr}`;
  }

  return note;
}

class TransactionClassifier {
  private wordIndex: Map<string, number> = new Map();
  private labelCategoryIds: string[] = [];
  private model: tf.LayersModel | null = null;
  private isModelReady = false;
  private isTraining = false;
  private maxSequenceLength = 20; // Reduced for faster processing
  private embeddingDim = 32; // Optimized for speed/accuracy balance

  private retrainTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTrainAt = 0;
  private initPromise: Promise<void> | null = null;

  // Cache categories to avoid DB queries on every prediction
  private categoryCache: Map<string, Category> | null = null;
  private categoryCacheTimestamp = 0;
  private readonly CATEGORY_CACHE_TTL = 60_000; // 1 minute

  constructor() {
    // Lazy init: don't block UI at import time
  }

  /**
   * Khởi tạo bộ phân loại - tải mô hình hiện có hoặc chuẩn bị cho huấn luyện
   * Lazy initialization: only run once on first prediction
   */
  private async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      try {
        await tf.ready();
        await this.loadModel();
        if (!this.isModelReady) {
          console.log("No existing model found. Will train on first use.");
        }
      } catch (error) {
        console.error("Lỗi khi khởi tạo bộ phân loại:", error);
      }
    })();
    return this.initPromise;
  }

  /**
   * Lấy dữ liệu huấn luyện từ cơ sở dữ liệu
   * Ưu tiên: Sửa của người dùng (chosen_category_id) > Giao dịch
   * CHỈ train trên categories và transactions của user hiện tại
   */
  private async fetchTrainingData(): Promise<{
    data: TrainingData[];
    corrections: Set<string>; // Track which notes are from corrections
    categories: Category[];
  }> {
    await openDb();

    // Get current user ID to filter categories and transactions
    const { getCurrentUserId } = await import("@/utils/auth");
    const userId = await getCurrentUserId();
    if (!userId) {
      throw new Error("User not logged in - cannot train model");
    }

    // Lấy ONLY danh mục của user hiện tại (không lấy từ Firebase sync)
    const categories: Category[] = await db.getAllAsync<Category>(
      "SELECT * FROM categories WHERE (type = 'expense' OR type = 'income') AND user_id = ?",
      [userId]
    );

    // Lấy các sửa của người dùng HIỆN TẠI (ưu tiên cao nhất để học)
    // Đây là phản hồi rõ ràng khi họ sửa dự đoán sai
    const corrections = await db.getAllAsync<{
      text: string;
      chosen_category_id: string;
    }>(
      `
      SELECT text, chosen_category_id 
      FROM ml_training_samples
      WHERE chosen_category_id IS NOT NULL
        AND text IS NOT NULL 
        AND text != ''
        AND user_id = ?
      ORDER BY created_at DESC
      LIMIT 500
    `,
      [userId]
    );

    // Theo dõi ghi chú từ sửa để xây dựng có trọng số
    const correctionNotes = new Set(corrections.map((c) => c.text));

    // Lấy các giao dịch có ghi chú (chi/thu) CỦA USER HIỆN TẠI
    // REDUCED from 1000 to 300 to give user corrections more weight
    // NOW INCLUDES AMOUNT for contextual learning
    const transactions = await db.getAllAsync<{
      note: string;
      category_id: string;
      amount: number;
    }>(
      `
      SELECT t.note, t.category_id, t.amount
      FROM transactions t
      WHERE (t.type = 'expense' OR t.type = 'income')
        AND t.note IS NOT NULL 
        AND t.note != ''
        AND t.category_id IS NOT NULL
        AND t.user_id = ?
      ORDER BY t.occurred_at DESC
      LIMIT 300
    `,
      [userId]
    );

    // Kết hợp dữ liệu: sửa trước (phản hồi), rồi giao dịch
    // QUAN TRỌNG: Khử trùng lặp để tránh đếm một ghi chú hai lần
    const dataMap = new Map<string, TrainingData>();

    // Thêm sửa trước (ưu tiên cao hơn)
    corrections.forEach((c) => {
      const key = `${c.text}||${c.chosen_category_id}`;
      dataMap.set(key, {
        note: c.text,
        categoryId: c.chosen_category_id,
      });
    });

    console.log(
      `📝 Loaded ${corrections.length} corrections: ${corrections
        .slice(0, 3)
        .map(
          (c) =>
            `"${c.text}" → catId:${c.chosen_category_id.substring(0, 15)}...`
        )
        .join(", ")}`
    );

    // Add transactions (skip if already in corrections)
    // Augment note with amount for contextual learning
    transactions.forEach((t) => {
      const augmentedNote = augmentNoteWithAmount(t.note, t.amount);
      const key = `${augmentedNote}||${t.category_id}`;
      if (!dataMap.has(key)) {
        dataMap.set(key, {
          note: augmentedNote,
          categoryId: t.category_id,
          amount: t.amount,
        });
      }
    });

    console.log(
      `💡 Sample augmented notes: ${Array.from(dataMap.values())
        .slice(0, 3)
        .map((d) => `"${d.note}"`)
        .join(", ")}`
    );

    const data: TrainingData[] = Array.from(dataMap.values());

    return { data, corrections: correctionNotes, categories };
  }

  private createModel(numLabels: number, vocabSize: number) {
    const model = tf.sequential();
    model.add(
      tf.layers.embedding({
        inputDim: Math.max(2, vocabSize + 2),
        outputDim: this.embeddingDim,
        inputLength: this.maxSequenceLength,
      })
    );
    model.add(tf.layers.globalAveragePooling1d({}));
    model.add(tf.layers.dense({ units: 48, activation: "relu" }));
    model.add(tf.layers.dropout({ rate: 0.2 }));
    model.add(tf.layers.dense({ units: numLabels, activation: "softmax" }));
    model.compile({
      optimizer: tf.train.adam(0.003), // Increased from 0.001 for faster learning
      loss: "categoricalCrossentropy",
      metrics: ["accuracy"],
    });
    return model;
  }

  /**
   * Train the model with transaction history
   */
  async trainModel(forceRetrain = false): Promise<{
    success: boolean;
    accuracy?: number;
    samples?: number;
    message?: string;
  }> {
    if (this.isTraining) {
      return { success: false, message: "Model is already training" };
    }

    if (this.isModelReady && !forceRetrain) {
      return { success: true, message: "Model is already trained" };
    }

    this.isTraining = true;

    try {
      // Ensure TensorFlow is ready before training
      await this.initialize();

      // Fetch training data
      const { data, corrections, categories } = await this.fetchTrainingData();

      if (data.length < MIN_TRAINING_SAMPLES) {
        console.warn(
          `Warning: Only ${data.length} transactions with notes. Model may be less accurate.`
        );
        // Vẫn tiếp tục train với số lượng ít
      }

      // Labels: all category ids seen in training data intersected with existing categories
      const categorySet = new Set(categories.map((c) => c.id));
      const seen = new Set(data.map((d) => d.categoryId));
      let labels = Array.from(seen).filter((id) => categorySet.has(id));

      // If not enough categories with data, add synthetic training for ALL categories
      if (labels.length < 2 && categories.length >= 2) {
        console.log(
          `⚠️ Only ${labels.length} category with data. Creating synthetic training for all ${categories.length} categories.`
        );

        // Add synthetic samples for each category
        const syntheticData: TrainingData[] = [];
        for (const cat of categories) {
          // Generate synthetic note from category name
          const syntheticNote = cat.name.toLowerCase();
          syntheticData.push({
            note: syntheticNote,
            categoryId: cat.id,
          });
        }

        // Merge with existing data
        data.push(...syntheticData);
        labels = categories.map((c) => c.id);

        console.log(
          `✅ Added ${syntheticData.length} synthetic samples. Total: ${data.length} samples, ${labels.length} categories.`
        );
      }

      if (labels.length < 2) {
        return {
          success: false,
          message:
            "Không đủ danh mục có dữ liệu để huấn luyện (cần >= 2 danh mục).",
        };
      }

      const notes = data.map((d) => d.note);
      // minFreq=1 so a single correction can introduce new tokens
      this.wordIndex = buildWordIndex(notes, 4000, 1);

      const labelIndex = new Map<string, number>();
      labels.forEach((id, i) => labelIndex.set(id, i));

      // Build tensors with data duplication for corrections (since sampleWeight is not supported)
      const xsArr: number[][] = [];
      const ysArr: number[][] = [];

      for (const sample of data) {
        const li = labelIndex.get(sample.categoryId);
        if (li === undefined) continue;
        const seq = textToSequence(
          sample.note,
          this.wordIndex,
          this.maxSequenceLength
        );
        const y = new Array(labels.length).fill(0);
        y[li] = 1;

        // If this is a user correction, repeat it 50x to emphasize learning strongly
        // This ensures user feedback dominates over historical transactions
        const repeats = corrections.has(sample.note) ? 50 : 1;
        for (let r = 0; r < repeats; r++) {
          xsArr.push(seq);
          ysArr.push([...y]); // Clone array
        }
      }

      const xs = tf.tensor2d(
        xsArr,
        [xsArr.length, this.maxSequenceLength],
        "int32"
      );
      const ys = tf.tensor2d(ysArr, [ysArr.length, labels.length], "float32");

      // CRITICAL: Only create new model if don't have one OR labels changed
      // Check BEFORE updating this.labelCategoryIds to compare old vs new
      const needNewModel =
        !this.model ||
        this.labelCategoryIds.length !== labels.length ||
        !this.labelCategoryIds.every((id, i) => id === labels[i]);

      if (needNewModel) {
        console.log(
          `🆕 Creating new model (labels: ${this.labelCategoryIds.length} → ${labels.length})`
        );
        this.model?.dispose?.();
        this.model = this.createModel(labels.length, this.wordIndex.size);
      } else {
        console.log(
          `♻️ Warm-start: retraining with ${corrections.size} corrections, ${data.length} total samples`
        );
      }

      // Update labelCategoryIds AFTER the check
      this.labelCategoryIds = labels;

      // Ensure model exists before training
      if (!this.model) {
        throw new Error("Model creation failed");
      }

      // IMPORTANT: Set model ready BEFORE training so predictions can work while training
      // Model is usable even with random weights (will give low confidence predictions)
      this.isModelReady = true;

      // Optimized epochs for faster training (reduced for better UX)
      const epochs = needNewModel ? 15 : 20;
      console.log(
        `🔄 Training for ${epochs} epochs (${
          needNewModel ? "new model" : "warm-start"
        })`
      );

      const history = await this.model.fit(xs, ys, {
        epochs,
        batchSize: 16, // Larger batch for faster training
        shuffle: true,
        validationSplit: Math.min(0.15, xsArr.length >= 50 ? 0.15 : 0.1),
        callbacks: {
          onEpochEnd: async (epoch, logs) => {
            // Simple early stop when val_loss stops improving
            const vl = (logs as any)?.val_loss;
            const l = (logs as any)?.loss;
            if (
              typeof vl === "number" &&
              vl > 5 &&
              typeof l === "number" &&
              l < 1
            ) {
              // Set stopTraining property instead of calling it as function
              if (this.model) {
                (this.model as any).stopTraining = true;
              }
            }
          },
        },
      });

      xs.dispose();
      ys.dispose();

      const accHist =
        (history.history as any)?.val_accuracy ??
        (history.history as any)?.accuracy;
      const lastAcc = Array.isArray(accHist)
        ? accHist[accHist.length - 1]
        : undefined;
      const accuracy = typeof lastAcc === "number" ? lastAcc : undefined;

      await this.saveModel(xsArr.length);
      // isModelReady already set to true before training
      this.lastTrainAt = Date.now();

      console.log(
        `✅ Training completed: ${xsArr.length} samples (${
          corrections.size
        } corrections), accuracy: ${
          accuracy ? (accuracy * 100).toFixed(1) : "N/A"
        }%`
      );
      console.log(
        `📊 Model now knows ${
          this.labelCategoryIds.length
        } categories: ${this.labelCategoryIds
          .map((id) => categories.find((c) => c.id === id)?.name || id)
          .join(", ")}`
      );

      return {
        success: true,
        accuracy,
        samples: xsArr.length,
        message: `Neural model trained (on-device)${
          accuracy != null
            ? ` with ${(accuracy * 100).toFixed(1)}% accuracy`
            : ""
        }`,
      };
    } catch (error) {
      console.warn("Error training model:", error);
      return {
        success: false,
        message: `Training failed: ${(error as Error).message}`,
      };
    } finally {
      this.isTraining = false;
    }
  }

  /**
   * Predict category for a transaction note
   * FAST: Returns null immediately if model not ready (no blocking training)
   * @param note - Transaction note text
   * @param amount - Optional transaction amount for better context
   */
  async predictCategory(
    note: string,
    amount?: number | null
  ): Promise<PredictionResult | null> {
    // CRITICAL: Skip if model not ready - don't block UI with training!
    if (
      !this.isModelReady ||
      !this.model ||
      this.labelCategoryIds.length === 0
    ) {
      return null;
    }

    try {
      // Augment note with amount for contextual prediction
      const augmentedNote = augmentNoteWithAmount(note, amount);
      console.log(
        `🔍 Predicting for: "${augmentedNote}" (original: "${note}")`
      );

      const seq = textToSequence(
        augmentedNote,
        this.wordIndex,
        this.maxSequenceLength
      );
      const x = tf.tensor2d([seq], [1, this.maxSequenceLength], "int32");
      const y = this.model.predict(x) as tf.Tensor;
      const probs = Array.from(await y.data()) as number[];
      x.dispose();
      y.dispose();

      const topIdx = argTopK(probs, 1)[0];
      const confidence = probs[topIdx] ?? 0;
      if (confidence < 0.1) return null;

      const categoryId = this.labelCategoryIds[topIdx];

      // Get category details from cache
      const category = await this.getCachedCategory(categoryId);

      // Try frequency-based fallback if neural confidence is low
      if (confidence < 0.6) {
        const freqPred = await this.getFrequencyBasedPrediction(note);
        if (freqPred && freqPred.confidence > confidence) {
          console.log(
            `📊 Using frequency-based prediction: ${freqPred.categoryName} (${(
              freqPred.confidence * 100
            ).toFixed(1)}% from ${freqPred.frequency} past transactions)`
          );
          return freqPred;
        }
      }

      console.log(
        `✅ Neural prediction: ${category?.name} (${(confidence * 100).toFixed(
          1
        )}%)`
      );

      return {
        categoryId,
        confidence: Math.min(1.0, confidence),
        categoryName: category?.name,
        categoryIcon: category?.icon || undefined,
      };
    } catch (error) {
      console.error("Error predicting category:", error);
      return null;
    }
  }

  /**
   * Get frequency-based prediction from user's transaction history
   * Returns the most frequently used category for similar notes
   */
  private async getFrequencyBasedPrediction(
    note: string
  ): Promise<
    (PredictionResult & { frequency: number; categoryName: string }) | null
  > {
    try {
      await openDb();
      const { getCurrentUserId } = await import("@/utils/auth");
      const userId = await getCurrentUserId();

      if (!userId) return null;

      // Extract first significant word from note
      const firstWord = note.trim().split(" ")[0].toLowerCase();
      if (!firstWord || firstWord.length < 2) return null;

      // Find most frequent category for similar notes
      const results = await db.getAllAsync<{
        category_id: string;
        count: number;
      }>(
        `
        SELECT t.category_id, COUNT(*) as count
        FROM transactions t
        WHERE LOWER(t.note) LIKE ?
          AND t.category_id IS NOT NULL
          AND t.user_id = ?
        GROUP BY t.category_id
        ORDER BY count DESC
        LIMIT 1
      `,
        [`%${firstWord}%`, userId]
      );

      if (results.length === 0 || results[0].count < 2) {
        return null; // Need at least 2 transactions to trust frequency
      }

      const categoryId = results[0].category_id;
      const frequency = results[0].count;

      // Get category details
      const category = await this.getCachedCategory(categoryId);
      if (!category) return null;

      // Calculate confidence based on frequency (cap at 75%)
      const confidence = Math.min(0.75, 0.4 + frequency * 0.08);

      return {
        categoryId,
        confidence,
        categoryName: category.name,
        categoryIcon: category.icon || undefined,
        frequency,
      };
    } catch (error) {
      console.error("Error in frequency-based prediction:", error);
      return null;
    }
  }

  /**
   * Predict top 3 categories with confidence scores (multi-label)
   * Used for showing user alternative suggestions
   * FAST: Returns empty if model not ready (no blocking training)
   */
  async predictCategoryWithAlternatives(
    note: string
  ): Promise<{ primary: PredictionResult; alternatives: PredictionResult[] }> {
    // CRITICAL: Skip if model not ready - don't block UI!
    if (!this.isModelReady || !this.model) {
      console.warn(
        `⚠️ Model not ready for prediction: ready=${
          this.isModelReady
        }, model=${!!this.model}`
      );
      return {
        primary: {
          categoryId: "",
          confidence: 0,
          categoryName: "Unknown",
        },
        alternatives: [],
      };
    }

    try {
      const seq = textToSequence(note, this.wordIndex, this.maxSequenceLength);
      const x = tf.tensor2d([seq], [1, this.maxSequenceLength], "int32");
      const y = this.model.predict(x) as tf.Tensor;
      const probs = Array.from(await y.data()) as number[];
      x.dispose();
      y.dispose();

      // Lower threshold to 1% to always return predictions (even for new/untrained models)
      const topIdxs = argTopK(probs, 3).filter((i) => (probs[i] ?? 0) >= 0.01);

      console.log(
        `🎯 Model state: ready=${this.isModelReady}, vocabSize=${this.wordIndex.size}, categories=${this.labelCategoryIds.length}`
      );
      console.log(
        `🎯 Top predictions for "${note}": ${topIdxs
          .map(
            (i) =>
              `idx=${i} catId=${this.labelCategoryIds[i]?.substring(
                0,
                20
              )}... conf=${((probs[i] ?? 0) * 100).toFixed(1)}%`
          )
          .join(", ")}`
      );

      if (topIdxs.length === 0) {
        console.warn(`⚠️ No predictions above 1% threshold for "${note}"`);
        return {
          primary: { categoryId: "", confidence: 0, categoryName: "Unknown" },
          alternatives: [],
        };
      }

      // Use cached categories instead of querying DB every time
      const categoryMap = await this.getCachedCategoryMap();

      const preds = topIdxs.map((idx) => {
        const categoryId = this.labelCategoryIds[idx];
        const category = categoryId ? categoryMap.get(categoryId) : undefined;
        return {
          categoryId: categoryId || "",
          confidence: Math.min(1.0, probs[idx] ?? 0),
          categoryName: category?.name || "Unknown",
          categoryIcon: category?.icon || undefined,
        };
      });

      // Deduplicate by categoryId - keep highest confidence
      const deduped = new Map<string, (typeof preds)[number]>();
      for (const pred of preds) {
        if (!pred.categoryId) continue;
        const existing = deduped.get(pred.categoryId);
        if (!existing || pred.confidence > existing.confidence) {
          deduped.set(pred.categoryId, pred);
        }
      }

      const uniquePreds = Array.from(deduped.values()).sort(
        (a, b) => b.confidence - a.confidence
      );

      console.log(
        `🔮 Predictions for "${note}": ${uniquePreds
          .map((p) => `${p.categoryName} ${(p.confidence * 100).toFixed(0)}%`)
          .join(", ")}`
      );

      const primary = uniquePreds[0];
      const alternatives = uniquePreds.slice(1);
      return { primary, alternatives };
    } catch (error) {
      console.error("Error predicting alternatives:", error);
      return {
        primary: { categoryId: "", confidence: 0, categoryName: "Unknown" },
        alternatives: [],
      };
    }
  }

  /**
   * Get cached category map to avoid DB queries
   */
  private async getCachedCategoryMap(): Promise<Map<string, Category>> {
    const now = Date.now();

    // Check if cache is valid
    if (
      this.categoryCache &&
      now - this.categoryCacheTimestamp < this.CATEGORY_CACHE_TTL
    ) {
      return this.categoryCache;
    }

    // Load fresh categories
    await openDb();
    const categories = await db.getAllAsync<Category>(
      "SELECT * FROM categories"
    );

    const categoryMap = new Map<string, Category>();
    for (const cat of categories) {
      categoryMap.set(cat.id, cat);
    }

    this.categoryCache = categoryMap;
    this.categoryCacheTimestamp = now;

    return categoryMap;
  }

  /**
   * Get single category from cache
   */
  private async getCachedCategory(
    categoryId: string
  ): Promise<Category | null> {
    const categoryMap = await this.getCachedCategoryMap();
    return categoryMap.get(categoryId) || null;
  }

  /**
   * Invalidate category cache (call after creating/updating categories)
   */
  invalidateCategoryCache(): void {
    this.categoryCache = null;
    this.categoryCacheTimestamp = 0;
  }

  /**
   * Incremental learning - retrain with new transaction
   * Train continuously after every transaction for immediate learning
   */
  async learnFromNewTransaction(
    note: string,
    categoryId: string
  ): Promise<void> {
    // Debounce retraining to avoid UI lag: train at most once per 30s (reduced for faster learning)
    const now = Date.now();
    const MIN_INTERVAL_MS = 30_000; // Reduced from 60s
    const delayMs = 2_000; // Reduced from 4s

    if (now - this.lastTrainAt < MIN_INTERVAL_MS) {
      if (this.retrainTimer) return;
      this.retrainTimer = setTimeout(() => {
        this.retrainTimer = null;
        this.trainModel(true).catch(() => {});
      }, delayMs);
      return;
    }

    if (this.retrainTimer) {
      clearTimeout(this.retrainTimer);
      this.retrainTimer = null;
    }
    this.trainModel(true).catch(() => {});
  }

  /**
   * Learn from user correction (debounced retrain)
   * Called when user edits a transaction to fix wrong category
   */
  async learnFromCorrection(note: string, categoryId: string): Promise<void> {
    console.log(
      `🎓 User correction logged: "${note}" → catId: ${categoryId.substring(
        0,
        20
      )}... (training in 2s)`
    );

    // Cancel any pending retrain
    if (this.retrainTimer) {
      clearTimeout(this.retrainTimer);
      this.retrainTimer = null;
    }

    // Debounce training by 2 seconds to batch multiple corrections
    this.retrainTimer = setTimeout(async () => {
      console.log("⏰ Debounce complete - starting retrain...");

      // Verify correction is in database before training
      await openDb();
      const corrections = await db.getAllAsync<{
        text: string;
        chosen_category_id: string;
      }>(`
        SELECT text, chosen_category_id FROM ml_training_samples 
        WHERE chosen_category_id IS NOT NULL 
        ORDER BY created_at DESC LIMIT 10
      `);
      console.log(
        `📚 Recent corrections in DB: ${corrections
          .map((c) => `"${c.text}"`)
          .join(", ")}`
      );

      // Train in background without blocking UI
      const result = await this.trainModel(true);
      if (result.success) {
        console.log(
          `✅ 🎓 Model updated! Accuracy: ${
            result.accuracy ? (result.accuracy * 100).toFixed(1) : "N/A"
          }% (🛡️ UI remained smooth)`
        );
      } else {
        console.error(`❌ Retrain failed: ${result.message}`);
      }
    }, 2000); // 2 second debounce
  }

  /**
   * Save model to storage
   */
  private async saveModel(sampleCount: number): Promise<void> {
    try {
      // Save vocabulary
      await AsyncStorage.setItem(
        VOCAB_STORAGE_KEY,
        JSON.stringify(Array.from(this.wordIndex.entries()))
      );
      await AsyncStorage.setItem(
        LABELS_STORAGE_KEY,
        JSON.stringify(this.labelCategoryIds)
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

      const state: SavedNeuralState = {
        weights,
        maxSequenceLength: this.maxSequenceLength,
        embeddingDim: this.embeddingDim,
      };
      await AsyncStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(state));

      const meta: SavedMeta = {
        version: 1,
        trainedAt: Date.now(),
        samples: sampleCount,
        categories: this.labelCategoryIds.length,
      };
      await AsyncStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
      console.log(
        `✅ Model saved: ${sampleCount} samples, ${this.labelCategoryIds.length} categories`
      );
    } catch (error) {
      console.warn("Error saving model:", error);
    }
  }

  /**
   * Load model from storage
   */
  private async loadModel(): Promise<void> {
    try {
      const vocabData = await AsyncStorage.getItem(VOCAB_STORAGE_KEY);
      if (vocabData) this.wordIndex = new Map(JSON.parse(vocabData));

      const labelsData = await AsyncStorage.getItem(LABELS_STORAGE_KEY);
      if (labelsData) this.labelCategoryIds = JSON.parse(labelsData);

      const modelData = await AsyncStorage.getItem(MODEL_STORAGE_KEY);
      if (!modelData) {
        this.isModelReady = false;
        return;
      }

      const state = JSON.parse(modelData) as SavedNeuralState;
      if (!state?.weights?.length || !this.labelCategoryIds.length) {
        this.isModelReady = false;
        return;
      }

      this.maxSequenceLength =
        state.maxSequenceLength || this.maxSequenceLength;
      this.embeddingDim = state.embeddingDim || this.embeddingDim;

      // Validate vocabulary size matches saved model
      // Embedding layer weight shape is [vocabSize + 2, embeddingDim]
      const embeddingWeights = state.weights[0]; // First layer is embedding
      if (embeddingWeights && embeddingWeights.shape[0]) {
        const savedVocabSize = embeddingWeights.shape[0] - 2;
        const currentVocabSize = this.wordIndex.size;

        if (savedVocabSize !== currentVocabSize) {
          console.warn(
            `⚠️ Vocabulary size changed (${savedVocabSize} → ${currentVocabSize}). Discarding old model.`
          );
          await this.clearModel();
          this.isModelReady = false;
          return;
        }
      }

      this.model?.dispose?.();
      this.model = this.createModel(
        this.labelCategoryIds.length,
        this.wordIndex.size
      );

      const tensors = state.weights.map((w) =>
        tf.tensor(w.data, w.shape, w.dtype)
      );
      this.model.setWeights(tensors);
      tensors.forEach((t) => t.dispose());

      this.isModelReady = true;
      console.log(
        `✅ Model loaded: ${this.labelCategoryIds.length} categories, ${this.wordIndex.size} vocab`
      );
    } catch (error) {
      console.warn("Error loading model:", error);
      this.isModelReady = false;
    }
  }

  /**
   * Clear saved model and reset
   */
  async clearModel(): Promise<void> {
    this.wordIndex.clear();
    this.labelCategoryIds = [];
    this.model?.dispose?.();
    this.model = null;
    this.isModelReady = false;

    await AsyncStorage.multiRemove([
      MODEL_STORAGE_KEY,
      VOCAB_STORAGE_KEY,
      LABELS_STORAGE_KEY,
      META_STORAGE_KEY,
    ]);

    console.log("Model cleared");
  }

  /**
   * Get model status
   */
  getStatus(): {
    isReady: boolean;
    isTraining: boolean;
    vocabularySize: number;
    numCategories: number;
  } {
    return {
      isReady: this.isModelReady,
      isTraining: this.isTraining,
      vocabularySize: this.wordIndex.size,
      numCategories: this.labelCategoryIds.length,
    };
  }
}

// Export singleton instance
export const transactionClassifier = new TransactionClassifier();

// Export types
export type { PredictionResult, TrainingData };
