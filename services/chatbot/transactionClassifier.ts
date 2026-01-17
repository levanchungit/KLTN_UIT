// On-device transaction classifier scaffold (Embedding -> LSTM -> Dense)
// Provides non-blocking predict() and learnFromCorrection() APIs.
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-react-native";
import { textToSequence, loadWordIndex, saveWordIndex } from "./tokenizer";
import {
  ensureModelDir,
  modelSaveUrl,
  saveMetadata,
  loadMetadata,
} from "./modelPersistence";

export type PredictionResult = {
  categoryId: string;
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
      // Attempt to load metadata to detect existing model (not implemented fully)
      const meta = await loadMetadata();
      if (meta) {
        // Model loading from FS could be attempted here using tf.loadLayersModel with file:// URL
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
      // Optionally save model to FS here
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
    if (!this.isReady || !this.model || !this.wordIndex) return null;
    try {
      const seq = textToSequence(note, this.wordIndex, this.maxSequenceLength);
      const x = tf.tensor2d([seq], [1, this.maxSequenceLength], "int32");
      const y = (this.model.predict(x) as tf.Tensor);
      const probs = Array.from(await y.data()) as number[];
      x.dispose();
      y.dispose();
      const topIdx = probs.indexOf(Math.max(...probs));
      const confidence = probs[topIdx] ?? 0;
      const categoryId = String(topIdx); // mapping index -> categoryId to be implemented
      return { categoryId, confidence };
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
    try {
      // Map categoryId to numeric label index when possible (fallback to 0)
      const labelIdx = Number.isFinite(Number(categoryId))
        ? Math.max(0, Math.floor(Number(categoryId)))
        : 0;

      // Ensure tokenizer present
      if (!this.wordIndex) {
        const wi = await loadWordIndex();
        this.wordIndex = wi || {};
      }

      const vocabSize = Math.max(2, Object.keys(this.wordIndex || {}).length + 2);

      // Ensure model exists: create a minimal model if missing
      if (!this.model) {
        // set numLabels conservatively to labelIdx+1
        this.numLabels = Math.max(this.numLabels, labelIdx + 1);
        this.model = this.createModel(vocabSize, Math.max(2, this.numLabels));
      }

      // Convert note to sequence
      const seq = textToSequence(note, this.wordIndex || {}, this.maxSequenceLength);
      const xs = tf.tensor2d([seq], [1, this.maxSequenceLength], "int32");
      const ys = tf.tensor1d([labelIdx], "int32");

      // Small fine-tune: 1 epoch, batch size 1 to adapt quickly
      await this.model.fit(xs, ys, { epochs: 1, batchSize: 1, verbose: 0 });
      xs.dispose();
      ys.dispose();
    } catch (e) {
      console.warn("learnFromCorrection failed:", e);
    }
  }
}

export const transactionClassifier = new TransactionClassifier();

