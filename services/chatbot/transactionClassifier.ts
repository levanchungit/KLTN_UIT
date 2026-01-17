// On-device transaction classifier scaffold (Embedding -> LSTM -> Dense)
// Provides non-blocking predict() and learnFromCorrection() APIs.
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-react-native";
import {
  ensureModelDir,
  loadLabelMap,
  loadLabelMeta,
  loadMetadata,
  loadModel,
  saveLabelMap,
  saveLabelMeta,
  saveMetadata,
  saveModel
} from "./modelPersistence";
import { loadWordIndex, textToSequence } from "./tokenizer";

export type PredictionResult = {
  categoryId: string;
  categoryName?: string;
  confidence: number;
};

export type TrainingSample = { text: string; labelIndex: number };

class TransactionClassifier {
  private model: tf.LayersModel | null = null;
  private wordIndex: Record<string, number> | null = null;
  private isReady = false;
  private maxSequenceLength = 16;
  private embeddingDim = 32;
  private lstmUnits = 64;
  private numLabels = 0; // to be set when training/initializing
  // label index -> categoryId
  private labelToCategory: string[] = [];
  // categoryId -> label index
  private categoryToLabel: Record<string, number> = {};
  // label index -> category display name
  private labelToName: string[] = [];

  constructor() {}

  private createModel(vocabSize: number, numLabels: number) {
    const model = tf.sequential();
    model.add(
      (tf.layers as any).embedding({
        inputDim: Math.max(2, vocabSize),
        outputDim: this.embeddingDim,
        inputLength: this.maxSequenceLength,
        maskZero: true,
      })
    );
    model.add(
      tf.layers.lstm({
        units: this.lstmUnits,
        returnSequences: false,
      })
    );
    model.add(tf.layers.dropout({ rate: 0.15 }));
    model.add(tf.layers.dense({ units: Math.max(2, numLabels), activation: "softmax" }));

    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: "sparseCategoricalCrossentropy",
      metrics: ["accuracy"],
    });

    return model;
  }

  async initialize() {
    if (this.isReady) return;
    try {
      this.wordIndex = (await loadWordIndex()) || null;
      await ensureModelDir();

      // Load label map
      const lm = await loadLabelMap();
      const lmeta = await loadLabelMeta();
      if (lm) {
        // restore labelToCategory, categoryToLabel and labelToName
        this.labelToCategory = [];
        this.categoryToLabel = {};
        this.labelToName = [];
        for (const k of Object.keys(lm)) {
          const idx = Number(k);
          const cid = lm[idx];
          this.labelToCategory[idx] = cid;
          this.categoryToLabel[cid] = idx;
          if (lmeta && lmeta[idx]) {
            this.labelToName[idx] = lmeta[idx].name;
          }
        }
        this.numLabels = this.labelToCategory.length;
      }

      // Load model from disk if available
      const meta = await loadMetadata();
      if (meta) {
        try {
          this.model = await loadModel();
          if (this.model) {
            console.log("Model loaded from disk successfully");
          }
        } catch (e) {
          console.warn("Failed to load model from disk:", e);
          this.model = null;
        }
      }

      this.isReady = true;
    } catch (e) {
      console.warn("Classifier init failed:", e);
    }
  }

  /**
   * Train or initialize model with minimal data. This is a synchronous-seeming API
   * but will run tfjs calls asynchronously to avoid blocking.
   */
  async trainFromSamples(samples: TrainingSample[], vocabSize: number) {
    if (!samples || samples.length === 0) return;
    this.numLabels = Math.max(...samples.map((s) => s.labelIndex)) + 1;
    this.model = this.createModel(vocabSize, this.numLabels);

    // Prepare tensors
    const xs = tf.tensor2d(
      samples.map((s) => s.text as unknown as number[]),
      [samples.length, this.maxSequenceLength],
      "int32"
    );
    const ys = tf.tensor1d(samples.map((s) => s.labelIndex), "int32");

    try {
      await this.model.fit(xs, ys, {
        epochs: 6,
        batchSize: Math.min(32, samples.length),
        verbose: 0,
      });
      // Save model to FS after training
      try {
        await saveModel(this.model);
        await saveMetadata({ version: "1", savedAt: Date.now() });
      } catch (e) {
        console.warn("Failed to persist model after train:", e);
      }
    } catch (e) {
      console.warn("Training failed:", e);
    } finally {
      xs.dispose();
      ys.dispose();
    }
  }

  /**
   * Non-blocking predict: if not ready, or model missing, return null immediately.
   */
  async predict(note: string, amount?: number | null): Promise<PredictionResult | null> {
    if (!this.isReady || !this.model || !this.wordIndex || this.labelToCategory.length === 0) return null;

    try {
      const seq = textToSequence(note, this.wordIndex, this.maxSequenceLength);
      const x = tf.tensor2d([seq], [1, this.maxSequenceLength], "int32");

      // Use tf.tidy to automatically clean up intermediate tensors
      const result = tf.tidy(() => {
        const y = this.model!.predict(x) as tf.Tensor;
        return y.dataSync(); // Synchronous for better performance
      });

      x.dispose();

      const probs = Array.from(result);
      const topIdx = probs.indexOf(Math.max(...probs));
      const confidence = probs[topIdx] ?? 0;

      // Ensure we have a valid category for this index
      const categoryId = this.labelToCategory[topIdx] ?? this.labelToCategory[0] ?? String(topIdx);
      const categoryName = this.labelToName[topIdx] ?? (await (async () => {
        // try to fetch category name from repo as fallback
        try {
          const repo = await import("@/repos/categoryRepo");
          const c = await repo.getCategoryById(categoryId);
          return c?.name ?? categoryId;
        } catch {
          return categoryId;
        }
      })());

      return { categoryId, categoryName, confidence };
    } catch (e) {
      console.warn("Predict failed:", e);
      return null;
    }
  }

  /**
   * Fine-tune the model with corrected sample(s). This performs a small number of
   * gradient steps on the provided sample to adapt quickly.
   */
  async learnFromCorrection(note: string, categoryId: string) {
    if (!this.isReady) await this.initialize();
    if (!this.wordIndex) return; // Can't learn without tokenizer

    try {
      // Map categoryId to numeric label index; rebuild label map if missing
      let labelIdx: number | undefined = this.categoryToLabel[categoryId];
      if (labelIdx === undefined) {
        // rebuild label map from categories
        try {
          const repo = await import("@/repos/categoryRepo");
          const cats = await repo.listCategories();
          // deterministic order: sort by name
          cats.sort((a, b) => a.name.localeCompare(b.name));
          this.labelToCategory = cats.map((c) => c.id);
          this.labelToName = cats.map((c) => c.name);
          this.categoryToLabel = {};
          this.labelToCategory.forEach((cid, i) => (this.categoryToLabel[cid] = i));
          this.numLabels = this.labelToCategory.length;
          // persist label map and meta
          try {
            const mapObj: Record<number, string> = {};
            const metaObj: Record<number, import("./modelPersistence").LabelMeta> = {};
            this.labelToCategory.forEach((cid, i) => {
              mapObj[i] = cid;
              metaObj[i] = { id: cid, name: this.labelToName[i] ?? "" };
            });
            await saveLabelMap(mapObj);
            await saveLabelMeta(metaObj);
          } catch (e) {
            console.warn("Failed to persist label map/meta during rebuild:", e);
          }
        } catch (e) {
          console.warn("Failed to rebuild label map:", e);
          return; // Can't continue without label map
        }
        labelIdx = this.categoryToLabel[categoryId];
      }
      if (labelIdx === undefined) {
        console.warn("Category not found in label map:", categoryId);
        return;
      }

      const vocabSize = Math.max(2, Object.keys(this.wordIndex).length + 2);

      // Ensure model exists: create a minimal model if missing
      if (!this.model) {
        this.numLabels = Math.max(this.numLabels, labelIdx + 1);
        this.model = this.createModel(vocabSize, Math.max(2, this.numLabels));
      }

      // Convert note to sequence and fine-tune
      const seq = textToSequence(note, this.wordIndex, this.maxSequenceLength);
      const xs = tf.tensor2d([seq], [1, this.maxSequenceLength], "int32");
      const ys = tf.tensor1d([labelIdx], "int32");

      // Small fine-tune: 1 epoch, batch size 1 to adapt quickly
      await this.model.fit(xs, ys, { epochs: 1, batchSize: 1, verbose: 0 });
      xs.dispose();
      ys.dispose();

      // Save model after fine-tune (async, don't block)
      this.saveModelAsync();
    } catch (e) {
      console.warn("learnFromCorrection failed:", e);
    }
  }

  /**
   * Async save model and metadata without blocking
   */
  private async saveModelAsync() {
    try {
      if (this.model) {
        await saveModel(this.model);
        await saveMetadata({ version: "1", savedAt: Date.now() });
        // persist label map and meta as well
        const mapObj: Record<number, string> = {};
        const metaObj: Record<number, import("./modelPersistence").LabelMeta> = {};
        this.labelToCategory.forEach((cid, i) => {
          mapObj[i] = cid;
          metaObj[i] = { id: cid, name: this.labelToName[i] ?? "" };
        });
        await saveLabelMap(mapObj);
        try {
          await saveLabelMeta(metaObj);
        } catch (e) {
          // non-fatal
        }
      }
    } catch (e) {
      console.warn("Failed to persist model after fine-tune:", e);
    }
  }

  invalidateCategoryCache() {
    // Force rebuild label map on next learn/predict
    this.labelToCategory = [];
    this.categoryToLabel = {};
    this.numLabels = 0;
  }
}

export const transactionClassifier = new TransactionClassifier();

