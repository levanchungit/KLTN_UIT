import AsyncStorage from "@react-native-async-storage/async-storage";

const MODEL_STORAGE_KEY = "budget_prediction_v2_weights";
const TRAINING_HISTORY_KEY = "budget_prediction_v2_history";

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

// ============================================================================
// Pure JS Neural Network Implementation (No TensorFlow required)
// ============================================================================

/** Activation functions */
function relu(x: number): number {
  return Math.max(0, x);
}

function reluDerivative(x: number): number {
  return x > 0 ? 1 : 0;
}

function softmax(arr: number[]): number[] {
  const maxVal = Math.max(...arr);
  const exps = arr.map((v) => Math.exp(v - maxVal));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/** Random initialization with He Normal */
function heNormal(fanIn: number): number {
  // He Normal: std = sqrt(2 / fanIn)
  const std = Math.sqrt(2.0 / fanIn);
  // Box-Muller transform for normal distribution
  const u1 = Math.random();
  const u2 = Math.random();
  return std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Dense layer with weights and biases */
interface DenseLayer {
  weights: number[][]; // [inputDim][outputDim]
  biases: number[]; // [outputDim]
  activation: "relu" | "softmax" | "none";
}

/** Forward pass result for a single layer */
interface LayerOutput {
  preActivation: number[]; // z = W*x + b
  postActivation: number[]; // a = activation(z)
}

function createDenseLayer(
  inputDim: number,
  outputDim: number,
  activation: "relu" | "softmax" | "none"
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

function forwardLayer(layer: DenseLayer, input: number[]): LayerOutput {
  const outputDim = layer.biases.length;
  const preActivation: number[] = new Array(outputDim).fill(0);

  // z = W^T * x + b
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
  } else if (layer.activation === "softmax") {
    postActivation = softmax(preActivation);
  } else {
    postActivation = [...preActivation];
  }

  return { preActivation, postActivation };
}

/** Serializable model state */
interface ModelState {
  layers: Array<{
    weights: number[][];
    biases: number[];
    activation: string;
  }>;
  version: string;
}

/**
 * Budget Prediction Model - Pure JS Neural Network
 * No TensorFlow dependency required.
 */
class BudgetPredictionModel {
  private layers: DenseLayer[] = [];
  private isInitialized = false;
  private isTrained = false;
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
        // Try load saved weights
        const saved = await AsyncStorage.getItem(MODEL_STORAGE_KEY);
        if (saved) {
          console.log("[BudgetPredictionModel] Loading saved weights...");
          this._loadModelWeights(saved);
          this.isTrained = true;
        } else {
          console.log("[BudgetPredictionModel] Creating new model...");
          this._buildModel();
          // Train immediately for AI demo
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
   * Xây dựng kiến trúc mô hình Neural Network (Pure JS)
   */
  private _buildModel(): void {
    const inputDim = 19; // income(1) + lifestyle(16) + month(1) + isHoliday(1)

    this.layers = [
      // Hidden Layer 1: 19 -> 64
      createDenseLayer(inputDim, 64, "relu"),
      // Hidden Layer 2: 64 -> 32
      createDenseLayer(64, 32, "relu"),
      // Output Layer: 32 -> 3 (needs, wants, savings)
      createDenseLayer(32, 3, "softmax"),
    ];

    console.log(
      "[BudgetPredictionModel] Model architecture: 19 -> 64 (relu) -> 32 (relu) -> 3 (softmax)"
    );
  }

  /**
   * Load saved model weights từ AsyncStorage
   */
  private _loadModelWeights(savedJson: string): void {
    const state: ModelState = JSON.parse(savedJson);
    this.layers = state.layers.map((l) => ({
      weights: l.weights,
      biases: l.biases,
      activation: l.activation as "relu" | "softmax" | "none",
    }));
  }

  /**
   * Save model weights vào AsyncStorage
   */
  private async _saveModelWeights(): Promise<void> {
    if (this.layers.length === 0) return;

    const state: ModelState = {
      layers: this.layers.map((l) => ({
        weights: l.weights,
        biases: l.biases,
        activation: l.activation,
      })),
      version: "2.0",
    };

    await AsyncStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(state));
    await AsyncStorage.setItem(
      TRAINING_HISTORY_KEY,
      JSON.stringify(this.trainingHistory)
    );
  }

  /**
   * Forward pass through the entire network
   */
  private _forward(input: number[]): {
    layerOutputs: LayerOutput[];
    output: number[];
  } {
    const layerOutputs: LayerOutput[] = [];
    let currentInput = input;

    for (const layer of this.layers) {
      const out = forwardLayer(layer, currentInput);
      layerOutputs.push(out);
      currentInput = out.postActivation;
    }

    return { layerOutputs, output: currentInput };
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
        signals: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
        ratios: [0.6, 0.2, 0.2] as [number, number, number],
      },
      {
        name: "Balanced Lifestyle",
        signals: [1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
        ratios: [0.5, 0.3, 0.2] as [number, number, number],
      },
      {
        name: "Active Social",
        signals: [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0],
        ratios: [0.45, 0.4, 0.15] as [number, number, number],
      },
      {
        name: "Saving Focus",
        signals: [0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1],
        ratios: [0.4, 0.25, 0.35] as [number, number, number],
      },
      {
        name: "High Earner Lifestyle",
        signals: [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0],
        ratios: [0.4, 0.45, 0.15] as [number, number, number],
      },
      {
        name: "Debt Repayment",
        signals: [1, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
        ratios: [0.65, 0.15, 0.2] as [number, number, number],
      },
    ];

    // Generate combinations
    incomes.forEach((income) => {
      patterns.forEach((pattern) => {
        for (let month = 1; month <= 12; month++) {
          const isHoliday = [1, 2, 4, 9, 12].includes(month);

          let [needs, wants, savings] = pattern.ratios;
          if (income < 8_000_000) {
            needs = Math.min(needs + 0.1, 0.7);
            savings = Math.max(savings - 0.05, 0.1);
          } else if (income > 25_000_000) {
            wants += 0.05;
            needs -= 0.05;
          }

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
      for (let i = 0; i < 1; i++) {
        const noisy = { ...sample };
        noisy.income *= 0.9 + Math.random() * 0.2;
        noisy.targetRatios = noisy.targetRatios.map((v) => {
          const noise = (Math.random() - 0.5) * 0.05;
          return Math.max(0.1, Math.min(0.7, v + noise));
        }) as [number, number, number];

        const sum = noisy.targetRatios.reduce((a, b) => a + b, 0);
        noisy.targetRatios = noisy.targetRatios.map((v) => v / sum) as [
          number,
          number,
          number,
        ];

        noisyData.push(noisy);
      }
    });

    return [...data, ...noisyData];
  }

  /**
   * Train model với synthetic data using mini-batch SGD with backpropagation
   */
  private async _trainWithSyntheticData(): Promise<void> {
    if (this.layers.length === 0) return;

    console.log("[BudgetPredictionModel] Training with synthetic data...");

    const trainingData = this._generateSyntheticData();
    console.log(
      `[BudgetPredictionModel] Generated ${trainingData.length} training samples`
    );

    // Prepare features
    const allFeatures: number[][] = [];
    const allTargets: number[][] = [];

    trainingData.forEach((sample) => {
      const features = [
        normalizeIncome(sample.income),
        ...sample.lifestyleSignals,
        (sample.month || 6) / 12,
        sample.isHolidaySeason ? 1 : 0,
      ];
      allFeatures.push(features);
      allTargets.push(sample.targetRatios);
    });

    const learningRate = 0.001;
    const epochs = 5;
    const batchSize = 32;

    // Split train/val (80/20)
    const splitIdx = Math.floor(allFeatures.length * 0.8);
    const trainFeatures = allFeatures.slice(0, splitIdx);
    const trainTargets = allTargets.slice(0, splitIdx);
    const valFeatures = allFeatures.slice(splitIdx);
    const valTargets = allTargets.slice(splitIdx);

    for (let epoch = 0; epoch < epochs; epoch++) {
      // Shuffle training data
      const indices = Array.from({ length: trainFeatures.length }, (_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }

      let epochLoss = 0;
      let epochCorrect = 0;
      let batchCount = 0;

      // Mini-batch training
      for (let b = 0; b < trainFeatures.length; b += batchSize) {
        const batchEnd = Math.min(b + batchSize, trainFeatures.length);
        const batchIndices = indices.slice(b, batchEnd);
        const currentBatchSize = batchIndices.length;

        // Accumulate gradients for the batch
        const weightGrads: number[][][][] = this.layers.map((l) =>
          l.weights.map((row) => [new Array(row.length).fill(0)])
        );
        const biasGrads: number[][] = this.layers.map((l) =>
          new Array(l.biases.length).fill(0)
        );

        // Process each sample in the batch
        for (const idx of batchIndices) {
          const input = trainFeatures[idx];
          const target = trainTargets[idx];

          // Forward pass
          const { layerOutputs } = this._forward(input);
          const output =
            layerOutputs[layerOutputs.length - 1].postActivation;

          // Cross-entropy loss
          for (let k = 0; k < output.length; k++) {
            epochLoss -= target[k] * Math.log(Math.max(output[k], 1e-7));
          }

          // Accuracy
          const predIdx = output.indexOf(Math.max(...output));
          const targetIdx = target.indexOf(Math.max(...target));
          if (predIdx === targetIdx) epochCorrect++;

          // Backpropagation
          // Output layer gradient (softmax + cross-entropy) = output - target
          let delta = output.map((o, k) => o - target[k]);

          // Traverse layers in reverse
          for (let l = this.layers.length - 1; l >= 0; l--) {
            const layerInput =
              l === 0 ? input : layerOutputs[l - 1].postActivation;

            // Accumulate weight gradients
            for (let i = 0; i < layerInput.length; i++) {
              for (let j = 0; j < delta.length; j++) {
                weightGrads[l][i][0][j] += layerInput[i] * delta[j];
              }
            }

            // Accumulate bias gradients
            for (let j = 0; j < delta.length; j++) {
              biasGrads[l][j] += delta[j];
            }

            // Propagate delta to previous layer (if not the first layer)
            if (l > 0) {
              const prevDelta = new Array(layerInput.length).fill(0);
              for (let i = 0; i < layerInput.length; i++) {
                let sum = 0;
                for (let j = 0; j < delta.length; j++) {
                  sum += this.layers[l].weights[i][j] * delta[j];
                }
                prevDelta[i] =
                  sum *
                  reluDerivative(layerOutputs[l - 1].preActivation[i]);
              }
              delta = prevDelta;
            }
          }
        }

        // Apply gradients (average over batch)
        for (let l = 0; l < this.layers.length; l++) {
          for (let i = 0; i < this.layers[l].weights.length; i++) {
            for (let j = 0; j < this.layers[l].weights[i].length; j++) {
              this.layers[l].weights[i][j] -=
                (learningRate * weightGrads[l][i][0][j]) / currentBatchSize;
            }
          }
          for (let j = 0; j < this.layers[l].biases.length; j++) {
            this.layers[l].biases[j] -=
              (learningRate * biasGrads[l][j]) / currentBatchSize;
          }
        }

        batchCount++;
      }

      // Calculate validation loss
      let valLoss = 0;
      let valCorrect = 0;
      for (let i = 0; i < valFeatures.length; i++) {
        const { output } = this._forward(valFeatures[i]);
        for (let k = 0; k < output.length; k++) {
          valLoss -=
            valTargets[i][k] * Math.log(Math.max(output[k], 1e-7));
        }
        const predIdx = output.indexOf(Math.max(...output));
        const targetIdx = valTargets[i].indexOf(
          Math.max(...valTargets[i])
        );
        if (predIdx === targetIdx) valCorrect++;
      }

      const avgLoss = epochLoss / trainFeatures.length;
      const acc = epochCorrect / trainFeatures.length;
      const valAcc = valCorrect / valFeatures.length;

      console.log(
        `[BudgetPredictionModel] Epoch ${epoch + 1}: loss=${avgLoss.toFixed(
          4
        )}, acc=${acc.toFixed(4)}, val_acc=${valAcc.toFixed(4)}`
      );

      this.trainingHistory.push({
        epoch: epoch + 1,
        loss: avgLoss,
        accuracy: acc,
      });

      // Yield control to avoid blocking UI
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    await this._saveModelWeights();
    this.isTrained = true;
    console.log("[BudgetPredictionModel] Training completed");
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

    const startTime = Date.now();

    if (this.layers.length === 0) {
      // Fallback to rule-based if model failed to build
      return this._ruleBasedPredict(
        income,
        lifestyleSignals,
        month,
        isHolidaySeason,
        startTime
      );
    }

    const features = [
      normalizeIncome(income),
      ...lifestyleSignals,
      (month || new Date().getMonth() + 1) / 12,
      isHolidaySeason ? 1 : 0,
    ];

    const { output: probabilities } = this._forward(features);

    // Calculate confidence (entropy-based)
    const entropy = -probabilities.reduce(
      (sum: number, p: number) => sum + (p > 0 ? p * Math.log(p) : 0),
      0
    );
    const maxEntropy = Math.log(3);
    const confidence = 1 - entropy / maxEntropy;

    const inferenceTimeMs = Date.now() - startTime;

    return {
      needsRatio: probabilities[0],
      wantsRatio: probabilities[1],
      savingsRatio: probabilities[2],
      confidence,
      modelVersion: "2.0-pure-js",
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
    const [
      hasRent,
      hasDebt,
      hasSavingsGoal,
      minimalLiving,
      foodLow,
      _foodMed,
      foodHigh,
      socialLow,
      _socialMed,
      socialHigh,
      luxuryLow,
      _luxuryMed,
      luxuryHigh,
    ] = lifestyleSignals;

    let needs = 0.5;
    let wants = 0.3;
    let savings = 0.2;

    if (income < 8_000_000) {
      needs = 0.6;
      wants = 0.25;
      savings = 0.15;
    } else if (income > 25_000_000) {
      needs = 0.45;
      wants = 0.35;
      savings = 0.2;
    }

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

    if (foodHigh === 1 || socialHigh === 1) wants += 0.05;
    if (luxuryHigh === 1) wants += 0.05;
    if (foodLow === 1 && socialLow === 1 && luxuryLow === 1) {
      wants -= 0.05;
      savings += 0.05;
    }

    if (isHolidaySeason) {
      wants += 0.05;
      savings -= 0.05;
    }

    const total = needs + wants + savings;
    needs /= total;
    wants /= total;
    savings /= total;

    return {
      needsRatio: Math.max(0.3, Math.min(0.7, needs)),
      wantsRatio: Math.max(0.1, Math.min(0.5, wants)),
      savingsRatio: Math.max(0.1, Math.min(0.4, savings)),
      confidence: 0.6,
      modelVersion: "2.0-rule-based",
      inferenceTimeMs: Date.now() - (startTime || Date.now()),
    };
  }

  /**
   * Incremental learning từ user corrections
   */
  async learnFromCorrection(data: TrainingData): Promise<void> {
    await this.initialize();
    if (this.layers.length === 0) return;

    console.log("[BudgetPredictionModel] Learning from user correction...");

    const features = [
      normalizeIncome(data.income),
      ...data.lifestyleSignals,
      (data.month || 6) / 12,
      data.isHolidaySeason ? 1 : 0,
    ];

    const target = data.targetRatios;
    const fineTuneLR = 0.0001;

    // Fine-tune with the single correction sample (5 steps)
    for (let step = 0; step < 5; step++) {
      const { layerOutputs } = this._forward(features);
      const output = layerOutputs[layerOutputs.length - 1].postActivation;

      // Output delta
      let delta = output.map((o, k) => o - target[k]);

      // Backprop and update
      for (let l = this.layers.length - 1; l >= 0; l--) {
        const layerInput =
          l === 0 ? features : layerOutputs[l - 1].postActivation;

        // Update weights
        for (let i = 0; i < layerInput.length; i++) {
          for (let j = 0; j < delta.length; j++) {
            this.layers[l].weights[i][j] -=
              fineTuneLR * layerInput[i] * delta[j];
          }
        }

        // Update biases
        for (let j = 0; j < delta.length; j++) {
          this.layers[l].biases[j] -= fineTuneLR * delta[j];
        }

        // Propagate delta
        if (l > 0) {
          const prevDelta = new Array(layerInput.length).fill(0);
          for (let i = 0; i < layerInput.length; i++) {
            let sum = 0;
            for (let j = 0; j < delta.length; j++) {
              sum += this.layers[l].weights[i][j] * delta[j];
            }
            prevDelta[i] =
              sum * reluDerivative(layerOutputs[l - 1].preActivation[i]);
          }
          delta = prevDelta;
        }
      }
    }

    await this._saveModelWeights();
    console.log("[BudgetPredictionModel] Learned from correction");
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
    if (this.layers.length === 0) return;

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
    this.layers = [];
    this.trainingHistory = [];
    await AsyncStorage.removeItem(MODEL_STORAGE_KEY);
    await AsyncStorage.removeItem(TRAINING_HISTORY_KEY);
  }
}

// Singleton instance
export const budgetPredictionModel = new BudgetPredictionModel();
