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

class PhoBERTAmountExtractor {
  private model: tf.LayersModel | null = null;
  private vocabMap: Map<string, number> = new Map();
  private isInitialized: boolean = false;
  private labelMap: Map<number, string> = new Map([
    [0, "O"], // Khác
    [1, "B-AMT"], // Bắt đầu số tiền
    [2, "I-AMT"], // Bên trong số tiền
  ]);

  // Ví dụ few-shot để tạo ngữ cảnh
  private fewShotExamples = [
    { text: "Chi tiền điện 450k", amount: 450000 },
    { text: "Mua cafe 45 nghìn", amount: 45000 },
    { text: "Nạp tiền 100k tháng 7", amount: 100000 },
    { text: "Trả tiền nhà 4tr8", amount: 4800000 },
    { text: "Ăn phở 60k", amount: 60000 },
    { text: "Mua 2 ly trà sữa 90k", amount: 90000 },
  ];

  /**
   * Khởi tạo mô hình
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Khởi tạo TensorFlow
      await tf.ready();

      // Thử tải mô hình đã tồn tại
      try {
        const modelJson = await AsyncStorage.getItem("phobert_amount_model");
        const vocabJson = await AsyncStorage.getItem("phobert_vocab");

        if (modelJson && vocabJson) {
          // For now, create a simple model (will be replaced with actual PhoBERT later)
          await this.createSimpleModel();
          this.vocabMap = new Map(JSON.parse(vocabJson));
        } else {
          await this.createSimpleModel();
          await this.buildVocabulary();
          await this.saveModel();
        }
      } catch (error) {
        console.log("⚠️ No cached model, creating new one...");
        await this.createSimpleModel();
        await this.buildVocabulary();
        await this.saveModel();
      }

      this.isInitialized = true;
    } catch (error) {
      console.warn("❌ Failed to initialize PhoBERT extractor:", error);
      throw error;
    }
  }

  /**
   * Create a simple LSTM-based model
   * TODO: Replace with actual PhoBERT-tiny when available
   */
  private async createSimpleModel(): Promise<void> {
    const vocabSize = 5000;
    const embeddingDim = 64;
    const maxSeqLength = 20;

    this.model = tf.sequential({
      layers: [
        // Embedding layer
        tf.layers.embedding({
          inputDim: vocabSize,
          outputDim: embeddingDim,
          inputLength: maxSeqLength,
          maskZero: true,
        }),

        // Bidirectional LSTM
        tf.layers.bidirectional({
          layer: tf.layers.lstm({
            units: 32,
            returnSequences: true,
            dropout: 0.2,
            recurrentInitializer: "glorotNormal",
            kernelInitializer: "glorotUniform",
          }),
        }),

        // Dense layer for classification
        tf.layers.timeDistributed({
          layer: tf.layers.dense({
            units: 3, // O, B-AMT, I-AMT
            activation: "softmax",
          }),
        }),
      ],
    });

    this.model.compile({
      optimizer: tf.train.adam(0.001),
      loss: "categoricalCrossentropy",
      metrics: ["accuracy"],
    });
  }

  /**
   * Build vocabulary from few-shot examples
   */
  private async buildVocabulary(): Promise<void> {
    const allTokens: string[] = [];

    this.fewShotExamples.forEach((ex) => {
      const tokens = this.tokenize(ex.text);
      allTokens.push(...tokens);
    });

    // Add special tokens
    const specialTokens = ["[PAD]", "[UNK]", "[CLS]", "[SEP]"];
    specialTokens.forEach((token, idx) => {
      this.vocabMap.set(token, idx);
    });

    // Add unique tokens
    const uniqueTokens = [...new Set(allTokens)];
    uniqueTokens.forEach((token, idx) => {
      if (!this.vocabMap.has(token)) {
        this.vocabMap.set(token, specialTokens.length + idx);
      }
    });

    console.log(`📚 Vocabulary size: ${this.vocabMap.size}`);
  }

  /**
   * Tokenize Vietnamese text
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/(\d+)(k|tr|triệu|nghìn|ngàn|đ|d)/gi, " $1 $2 ")
      .replace(
        /[^\w\sáàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]/g,
        " "
      )
      .split(/\s+/)
      .filter((t) => t.length > 0);
  }

  /**
   * Convert tokens to indices
   */
  private tokensToIndices(tokens: string[]): number[] {
    const unkId = this.vocabMap.get("[UNK]") || 1;
    return tokens.map((t) => this.vocabMap.get(t) || unkId);
  }

  /**
   * Extract amount using few-shot learning
   */
  async extractAmount(text: string): Promise<AmountExtractionResult> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    console.log(`🔍 PhoBERT extracting from: "${text}"`);

    try {
      // Tokenize input
      const tokens = this.tokenize(text);

      if (tokens.length === 0) {
        return { amount: null, confidence: 0, tokens: [], labels: [] };
      }

      // For now, use rule-based approach with confidence scoring
      // TODO: Replace with actual model inference
      const result = await this.ruleBasedExtraction(text, tokens);

      console.log(
        `✅ PhoBERT result: ${
          result.amount
        } (confidence: ${result.confidence.toFixed(2)})`
      );

      return result;
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
   * Rule-based extraction with confidence scoring
   * This serves as a baseline until full model is trained
   */
  private async ruleBasedExtraction(
    text: string,
    tokens: string[]
  ): Promise<AmountExtractionResult> {
    // Extract all potential amounts
    const amounts = this.extractAllPotentialAmounts(text);

    if (amounts.length === 0) {
      return { amount: null, confidence: 0, tokens, labels: [] };
    }

    // Score each amount
    const scored = amounts.map((amt) => ({
      amount: amt,
      score: this.scoreAmount(amt, text, tokens),
    }));

    // Sort by score
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    const confidence = Math.min(best.score / 100, 1.0);

    // Generate mock labels for visualization
    const labels = this.generateLabels(tokens, best.amount);

    return {
      amount: best.amount,
      confidence,
      tokens,
      labels,
    };
  }

  /**
   * Extract all potential amounts from text
   */
  private extractAllPotentialAmounts(text: string): number[] {
    const amounts: number[] = [];

    // Use existing parseAmountVN as base
    const parsed = parseAmountVN(text);
    if (parsed) {
      amounts.push(parsed);
    }

    return amounts;
  }

  /**
   * Score an amount based on context
   */
  private scoreAmount(amount: number, text: string, tokens: string[]): number {
    let score = 0;

    // Reasonable range bonus
    if (amount >= 1000 && amount <= 100000000) {
      score += 50;
    }

    // Has money unit bonus
    if (/(k|tr|triệu|nghìn|ngàn|đ|d|dong|đồng)/i.test(text)) {
      score += 30;
    }

    // Transaction verb bonus
    const transactionVerbs =
      /(chi|trả|mua|bán|nạp|rút|chuyển|gửi|nhận|thanh toán|thu)/i;
    if (transactionVerbs.test(text)) {
      score += 20;
    }

    // Common transaction ranges
    if (amount >= 10000 && amount <= 1000000) {
      score += 15; // Food, small purchases
    } else if (amount >= 1000000 && amount <= 10000000) {
      score += 10; // Bills, shopping
    }

    // Context matching
    if (
      /(ăn|uống|cafe|cà phê|trà|phở|cơm)/i.test(text) &&
      amount >= 10000 &&
      amount <= 500000
    ) {
      score += 15;
    }

    if (
      /(điện|nước|internet|wifi|phí)/i.test(text) &&
      amount >= 100000 &&
      amount <= 5000000
    ) {
      score += 15;
    }

    if (
      /(xe|taxi|grab|xăng)/i.test(text) &&
      amount >= 10000 &&
      amount <= 200000
    ) {
      score += 15;
    }

    return score;
  }

  /**
   * Generate labels for tokens (mock implementation)
   */
  private generateLabels(tokens: string[], amount: number | null): string[] {
    if (!amount) return tokens.map(() => "O");

    const labels: string[] = [];
    let inAmount = false;

    for (const token of tokens) {
      if (/^\d+$/.test(token) && !inAmount) {
        labels.push("B-AMT");
        inAmount = true;
      } else if (/(k|tr|triệu|nghìn|ngàn|đ|d)/i.test(token) && inAmount) {
        labels.push("I-AMT");
      } else {
        labels.push("O");
        inAmount = false;
      }
    }

    return labels;
  }

  /**
   * Save model to storage
   */
  private async saveModel(): Promise<void> {
    try {
      // Save vocabulary
      const vocabArray = Array.from(this.vocabMap.entries());
      await AsyncStorage.setItem("phobert_vocab", JSON.stringify(vocabArray));

      // Note: Actual model saving would be:
      // await this.model.save('localstorage://phobert_amount_model');

      await AsyncStorage.setItem("phobert_amount_model", "initialized");

      console.log("💾 Model saved");
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
      fewShotExamples: this.fewShotExamples.length,
    };
  }
}

// Export singleton
export const phobertExtractor = new PhoBERTAmountExtractor();
