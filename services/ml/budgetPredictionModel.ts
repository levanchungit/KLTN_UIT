import AsyncStorage from "@react-native-async-storage/async-storage";
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-react-native";

const MODEL_STORAGE_KEY = "budget_prediction_v1_weights";
const TRAINING_HISTORY_KEY = "budget_prediction_v1_history";

export type BudgetPrediction = {
  needsRatio: number; // 0-1
  wantsRatio: number; // 0-1
  savingsRatio: number; // 0-1
  confidence: number; // 0-1
  modelVersion: string;
  inferenceTimeMs: number;
};

export type TrainingData = {
  income: number;
  lifestyleSignals: number[]; // 16-dim từ LifestyleSignalModel
  targetRatios: [number, number, number]; // [needs, wants, savings]
  month?: number; // 1-12
  isHolidaySeason?: boolean;
};

/**
 * Normalize income về scale [0, 1] để dễ train
 * Sử dụng log scale vì thu nhập có distribution rất rộng
 */
function normalizeIncome(income: number): number {
  // Log scale: 1M -> 0.0, 100M -> 1.0
  const minLog = Math.log10(1_000_000); // 1M VND
  const maxLog = Math.log10(100_000_000); // 100M VND
  const logIncome = Math.log10(Math.max(income, 1_000_000));
  return Math.min(Math.max((logIncome - minLog) / (maxLog - minLog), 0), 1);
}

/**
 * Budget Prediction Model - Neural Network
 */
class BudgetPredictionModel {
  private model: tf.LayersModel | null = null;
  private isInitialized = false;
  private isTrained = false; // Track if model has been trained
  private initPromise: Promise<void> | null = null;
  private trainingHistory: { accuracy: number; loss: number; epoch: number }[] =
    [];

  /**
   * Lazy initialization - chỉ load model khi cần để tránh block UI
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        await tf.ready();

        // Try load saved weights
        const saved = await AsyncStorage.getItem(MODEL_STORAGE_KEY);
        if (saved) {
          console.log("[BudgetPredictionModel] Loading saved weights...");
          await this._loadModelWeights(saved);
          this.isTrained = true; // Loaded weights are already trained
        } else {
          console.log("[BudgetPredictionModel] Creating new model...");
          this._buildModel();
          // Train immediately for AI demo - optimized for speed
          await this._trainWithSyntheticData();
          this.isTrained = true;
        }

        // Load training history
        const historyStr = await AsyncStorage.getItem(TRAINING_HISTORY_KEY);
        if (historyStr) {
          this.trainingHistory = JSON.parse(historyStr);
        }

        this.isInitialized = true;
        console.log("[BudgetPredictionModel] Initialized successfully");
      } catch (error) {
        console.error("[BudgetPredictionModel] Init failed:", error);
        // Fallback: create new model
        this._buildModel();
        this.isInitialized = true;
      }
    })();

    return this.initPromise;
  }

  /**
   * Xây dựng kiến trúc mô hình Neural Network
   */
  private _buildModel(): void {
    const inputDim = 19; // income(1) + lifestyle(16) + month(1) + isHoliday(1)

    this.model = tf.sequential({
      layers: [
        // Input + Hidden Layer 1
        tf.layers.dense({
          inputShape: [inputDim],
          units: 64,
          activation: "relu",
          kernelInitializer: "heNormal",
          name: "dense_1",
        }),
        tf.layers.batchNormalization({ name: "bn_1" }),
        tf.layers.dropout({ rate: 0.3, name: "dropout_1" }),

        // Hidden Layer 2
        tf.layers.dense({
          units: 32,
          activation: "relu",
          kernelInitializer: "heNormal",
          name: "dense_2",
        }),
        tf.layers.batchNormalization({ name: "bn_2" }),
        tf.layers.dropout({ rate: 0.2, name: "dropout_2" }),

        // Output Layer - 3 classes (needs, wants, savings)
        tf.layers.dense({
          units: 3,
          activation: "softmax",
          name: "output",
        }),
      ],
    });

    this.model.compile({
      optimizer: tf.train.adam(0.001),
      loss: "categoricalCrossentropy",
      metrics: ["accuracy"],
    });

    console.log("[BudgetPredictionModel] Model architecture:");
    this.model.summary();
  }

  /**
   * Load saved model weights từ AsyncStorage
   */
  private async _loadModelWeights(savedJson: string): Promise<void> {
    const state = JSON.parse(savedJson);
    this._buildModel();

    if (!this.model) throw new Error("Model not built");

    const weights = state.weights.map((w: any) => {
      return tf.tensor(w.data, w.shape, w.dtype);
    });

    this.model.setWeights(weights);
    weights.forEach((t: tf.Tensor) => t.dispose());
  }

  /**
   * Save model weights vào AsyncStorage
   */
  private async _saveModelWeights(): Promise<void> {
    if (!this.model) return;

    const weights = this.model.getWeights();
    const serialized = weights.map((w) => ({
      shape: w.shape,
      dtype: w.dtype,
      data: Array.from(w.dataSync()),
    }));

    await AsyncStorage.setItem(
      MODEL_STORAGE_KEY,
      JSON.stringify({ weights: serialized, version: "1.0" })
    );

    await AsyncStorage.setItem(
      TRAINING_HISTORY_KEY,
      JSON.stringify(this.trainingHistory)
    );

    // DON'T dispose weights - they're still in use by the model!
    // TensorFlow will handle memory management automatically
  }

  /**
   * Generate synthetic training data
   * Dữ liệu mô phỏng các trường hợp thực tế người Việt Nam
   */
  private _generateSyntheticData(): TrainingData[] {
    const data: TrainingData[] = [];

    // Income ranges: 5M -> 50M VND
    const incomes = [
      5_000_000, 8_000_000, 10_000_000, 15_000_000, 20_000_000, 30_000_000,
      50_000_000,
    ];

    // Lifestyle patterns
    const patterns = [
      {
        name: "Minimal Living",
        signals: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], // hasRent, low food, low social, low luxury
        ratios: [0.6, 0.2, 0.2] as [number, number, number], // 60% needs, 20% wants, 20% savings
      },
      {
        name: "Balanced Lifestyle",
        signals: [1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], // hasRent, medium food, medium social
        ratios: [0.5, 0.3, 0.2] as [number, number, number], // 50/30/20 rule
      },
      {
        name: "Active Social",
        signals: [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0], // hasRent, high food, high social
        ratios: [0.45, 0.4, 0.15] as [number, number, number], // More spending on wants
      },
      {
        name: "Saving Focus",
        signals: [0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1], // no rent, low food, hasSavingsGoal
        ratios: [0.4, 0.25, 0.35] as [number, number, number], // High savings
      },
      {
        name: "High Earner Lifestyle",
        signals: [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0], // hasRent, high food, luxury interest
        ratios: [0.4, 0.45, 0.15] as [number, number, number], // More wants
      },
      {
        name: "Debt Repayment",
        signals: [1, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], // hasRent, hasDebt
        ratios: [0.65, 0.15, 0.2] as [number, number, number], // High needs (debt)
      },
    ];

    // Generate combinations
    incomes.forEach((income) => {
      patterns.forEach((pattern) => {
        // Regular months
        for (let month = 1; month <= 12; month++) {
          const isHoliday = [1, 2, 4, 9, 12].includes(month); // Tết, 30/4, Quốc Khánh, Noel

          // Adjust ratios dựa trên thu nhập
          let [needs, wants, savings] = pattern.ratios;
          if (income < 8_000_000) {
            // Low income: higher needs
            needs = Math.min(needs + 0.1, 0.7);
            savings = Math.max(savings - 0.05, 0.1);
          } else if (income > 25_000_000) {
            // High income: more flexibility
            wants += 0.05;
            needs -= 0.05;
          }

          // Holiday adjustment
          if (isHoliday) {
            wants += 0.05;
            savings -= 0.05;
          }

          // Normalize to sum = 1
          const sum = needs + wants + savings;
          needs /= sum;
          wants /= sum;
          savings /= sum;

          data.push({
            income,
            lifestyleSignals: pattern.signals,
            targetRatios: [needs, wants, savings],
            month,
            isHolidaySeason: isHoliday,
          });
        }
      });
    });

    // Add noise để tăng diversity
    const noisyData: TrainingData[] = [];
    data.forEach((sample) => {
      // Reduced from 2 to 1 for faster training
      for (let i = 0; i < 1; i++) {
        const noisy = { ...sample };
        noisy.income *= 0.9 + Math.random() * 0.2; // ±10%
        noisy.targetRatios = noisy.targetRatios.map((v) => {
          const noise = (Math.random() - 0.5) * 0.05; // ±2.5%
          return Math.max(0.1, Math.min(0.7, v + noise));
        }) as [number, number, number];

        // Re-normalize
        const sum = noisy.targetRatios.reduce((a, b) => a + b, 0);
        noisy.targetRatios = noisy.targetRatios.map((v) => v / sum) as [
          number,
          number,
          number
        ];

        noisyData.push(noisy);
      }
    });

    return [...data, ...noisyData];
  }

  /**
   * Train model với synthetic data
   */
  private async _trainWithSyntheticData(): Promise<void> {
    if (!this.model) return;

    console.log("[BudgetPredictionModel] Training with synthetic data...");

    const trainingData = this._generateSyntheticData();
    console.log(
      `[BudgetPredictionModel] Generated ${trainingData.length} training samples`
    );

    // Prepare tensors
    const inputs: number[][] = [];
    const outputs: number[][] = [];

    trainingData.forEach((sample) => {
      const features = [
        normalizeIncome(sample.income),
        ...sample.lifestyleSignals,
        (sample.month || 6) / 12, // Normalize month to [0, 1]
        sample.isHolidaySeason ? 1 : 0,
      ];
      inputs.push(features);
      outputs.push(sample.targetRatios);
    });

    const xs = tf.tensor2d(inputs);
    const ys = tf.tensor2d(outputs);

    try {
      const history = await this.model.fit(xs, ys, {
        epochs: 5, // Optimized for demo speed (~3-4s)
        batchSize: 32,
        validationSplit: 0.2,
        shuffle: true,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            console.log(
              `[BudgetPredictionModel] Epoch ${
                epoch + 1
              }: loss=${logs?.loss.toFixed(4)}, acc=${logs?.acc.toFixed(4)}`
            );
            if (logs) {
              this.trainingHistory.push({
                epoch: epoch + 1,
                loss: logs.loss,
                accuracy: logs.acc,
              });
            }
          },
        },
      });

      await this._saveModelWeights();
      this.isTrained = true; // Mark as trained
      console.log("[BudgetPredictionModel] Training completed");
    } finally {
      xs.dispose();
      ys.dispose();
    }
  }

  /**
   * Dự đoán phân bổ ngân sách
   */
  async predict(
    income: number,
    lifestyleSignals: number[],
    month?: number,
    isHolidaySeason?: boolean
  ): Promise<BudgetPrediction> {
    await this.initialize();

    if (!this.model) {
      throw new Error("Model not initialized");
    }

    const startTime = Date.now();

    // Always use neural network prediction (for AI demo)
    const features = [
      normalizeIncome(income),
      ...lifestyleSignals,
      (month || new Date().getMonth() + 1) / 12,
      isHolidaySeason ? 1 : 0,
    ];

    const input = tf.tensor2d([features]);
    const prediction = this.model.predict(input) as tf.Tensor;
    const probabilities = Array.from(await prediction.data());

    // Calculate confidence (entropy-based)
    const entropy = -probabilities.reduce(
      (sum: number, p: number) => sum + (p > 0 ? p * Math.log(p) : 0),
      0
    );
    const maxEntropy = Math.log(3); // log(number of classes)
    const confidence = 1 - entropy / maxEntropy; // 0 = uncertain, 1 = very confident

    const inferenceTimeMs = Date.now() - startTime;

    input.dispose();
    prediction.dispose();

    return {
      needsRatio: probabilities[0],
      wantsRatio: probabilities[1],
      savingsRatio: probabilities[2],
      confidence,
      modelVersion: "1.0",
      inferenceTimeMs,
    };
  }

  /**
   * Rule-based fallback prediction (instant, no ML needed)
   * Dùng khi model chưa trained
   */
  private _ruleBasedPredict(
    income: number,
    lifestyleSignals: number[],
    month?: number,
    isHolidaySeason?: boolean,
    startTime?: number
  ): BudgetPrediction {
    // Parse lifestyle signals
    const [
      hasRent,
      hasDebt,
      hasSavingsGoal,
      minimalLiving,
      foodLow,
      foodMed,
      foodHigh,
      socialLow,
      socialMed,
      socialHigh,
      luxuryLow,
      luxuryMed,
      luxuryHigh,
    ] = lifestyleSignals;

    // Base ratios: 50/30/20 rule
    let needs = 0.5;
    let wants = 0.3;
    let savings = 0.2;

    // Adjust for income level
    if (income < 8_000_000) {
      needs = 0.6; // Low income: more needs
      wants = 0.25;
      savings = 0.15;
    } else if (income > 25_000_000) {
      needs = 0.45; // High income: more flexibility
      wants = 0.35;
      savings = 0.2;
    }

    // Adjust for lifestyle
    if (hasRent === 1) needs += 0.05;
    if (hasDebt === 1) {
      needs += 0.1;
      savings = Math.max(0.1, savings - 0.05);
    }
    if (hasSavingsGoal === 1) {
      savings += 0.1;
      wants -= 0.05;
    }
    if (minimalLiving === 1) {
      needs += 0.05;
      wants -= 0.05;
    }

    // Food/social/luxury spending
    if (foodHigh === 1 || socialHigh === 1) wants += 0.05;
    if (luxuryHigh === 1) wants += 0.05;
    if (foodLow === 1 && socialLow === 1 && luxuryLow === 1) {
      wants -= 0.05;
      savings += 0.05;
    }

    // Holiday adjustment
    if (isHolidaySeason) {
      wants += 0.05;
      savings -= 0.05;
    }

    // Normalize to sum = 1
    const total = needs + wants + savings;
    needs /= total;
    wants /= total;
    savings /= total;

    return {
      needsRatio: Math.max(0.3, Math.min(0.7, needs)),
      wantsRatio: Math.max(0.1, Math.min(0.5, wants)),
      savingsRatio: Math.max(0.1, Math.min(0.4, savings)),
      confidence: 0.6, // Lower confidence for rule-based
      modelVersion: "1.0-rule-based",
      inferenceTimeMs: Date.now() - (startTime || Date.now()),
    };
  }

  /**
   * Incremental learning từ user corrections
   */
  async learnFromCorrection(data: TrainingData): Promise<void> {
    await this.initialize();
    if (!this.model) return;

    console.log("[BudgetPredictionModel] Learning from user correction...");

    const features = [
      normalizeIncome(data.income),
      ...data.lifestyleSignals,
      (data.month || 6) / 12,
      data.isHolidaySeason ? 1 : 0,
    ];

    const xs = tf.tensor2d([features]);
    const ys = tf.tensor2d([data.targetRatios]);

    try {
      // Fine-tune với learning rate thấp hơn
      this.model.compile({
        optimizer: tf.train.adam(0.0001),
        loss: "categoricalCrossentropy",
        metrics: ["accuracy"],
      });

      await this.model.fit(xs, ys, {
        epochs: 5,
        batchSize: 1,
        verbose: 0,
      });

      await this._saveModelWeights();
      console.log("[BudgetPredictionModel] Learned from correction");
    } finally {
      xs.dispose();
      ys.dispose();
    }
  }

  /**
   * Get training history for evaluation
   */
  getTrainingHistory(): { accuracy: number; loss: number; epoch: number }[] {
    return this.trainingHistory;
  }

  /**
   * Train model in background (async, non-blocking)
   * Call this after first prediction to improve future predictions
   */
  async trainInBackground(): Promise<void> {
    if (this.isTrained) {
      console.log("[BudgetPredictionModel] Already trained, skipping");
      return;
    }

    await this.initialize();
    if (!this.model) return;

    console.log("[BudgetPredictionModel] Starting background training...");
    try {
      await this._trainWithSyntheticData();
      this.isTrained = true;
      console.log("[BudgetPredictionModel] Background training complete");
    } catch (error) {
      console.error(
        "[BudgetPredictionModel] Background training failed:",
        error
      );
    }
  }

  /**
   * Reset model (for testing)
   */
  async reset(): Promise<void> {
    this.isInitialized = false;
    this.initPromise = null;
    this.model = null;
    this.trainingHistory = [];
    await AsyncStorage.removeItem(MODEL_STORAGE_KEY);
    await AsyncStorage.removeItem(TRAINING_HISTORY_KEY);
  }
}

// Singleton instance
export const budgetPredictionModel = new BudgetPredictionModel();
