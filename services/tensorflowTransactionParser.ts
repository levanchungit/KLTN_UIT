import AsyncStorage from "@react-native-async-storage/async-storage";
// import * as tf from "@tensorflow/tfjs";
// import "@tensorflow/tfjs-react-native";
import { parseAmountVN, parseTransactionText } from "../utils/textPreprocessing";
import { phobertExtractor } from "./phobertAmountExtractor";
import { transactionIntentClassifier } from "./transactionIntentClassifier";

interface Category {
  id: string;
  name: string;
  type: "income" | "expense";
  icon?: string | null;
  color?: string | null;
}

interface CategoryPrediction {
  categoryId: string;
  categoryName: string;
  confidence: number; // 0-100
}

interface ParsedTransaction {
  action:
  | "CREATE_TRANSACTION"
  | "VIEW_STATS"
  | "EDIT_TRANSACTION"
  | "DELETE_TRANSACTION";
  amount: number | null;
  note: string;
  categoryId: string;
  categoryName: string;
  io: "IN" | "OUT";
  date: Date;
  message: string;
  primary?: CategoryPrediction; // Primary prediction with confidence
  alternatives?: CategoryPrediction[]; // Alternative predictions (top 2-3)
  confidenceThreshold?: number; // Threshold for showing alternatives (default 75)
}

type AmountExtractionResult = {
  amount: number | null;
  confidence: number;
  tokens: string[];
  labels: string[];
};

class TensorFlowTransactionParser {
  private model: tf.LayersModel | null = null;
  private vocab: Map<string, number> = new Map();
  private maxSequenceLength: number = 50;
  private isInitialized: boolean = false;

  /**
   * Initialize TensorFlow and load/create model
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log("🔧 Initializing TensorFlow...");

      // Khởi tạo TensorFlow cho React Native
      await tf.ready();
      console.log("✅ TensorFlow ready");

      // Thử tải mô hình đã tồn tại
      try {
        const modelJson = await AsyncStorage.getItem("tf_transaction_model");
        const vocabJson = await AsyncStorage.getItem("tf_vocab");

        if (modelJson && vocabJson) {
          // Tải mô hình từ bộ nhớ
          const modelData = JSON.parse(modelJson);
          this.model = await tf.loadLayersModel(tf.io.fromMemory(modelData));
          this.vocab = new Map(JSON.parse(vocabJson));
          console.log("✅ Loaded existing TF model from storage");
        } else {
          // Tạo mô hình mới
          await this.createModel();
          console.log("✅ Created new TF model");
        }
      } catch (error) {
        console.log("⚠️ No existing model, creating new one");
        await this.createModel();
      }

      this.isInitialized = true;
    } catch (error) {
      console.error("❌ TensorFlow initialization failed:", error);
      throw error;
    }
  }

  /**
   * Tạo mô hình mạng nơ-ron mới để phân loại văn bản
   */
  private async createModel(): Promise<void> {
    // Mô hình phân loại văn bản đơn giản
    // Đầu vào: văn bản đã token hóa → Embedding → LSTM → Dense → Output
    this.model = tf.sequential({
      layers: [
        tf.layers.embedding({
          inputDim: 5000, // vocabulary size
          outputDim: 128, // embedding dimension
          inputLength: this.maxSequenceLength,
        }),
        tf.layers.lstm({
          units: 64,
          returnSequences: false,
        }),
        tf.layers.dropout({ rate: 0.3 }),
        tf.layers.dense({
          units: 32,
          activation: "relu",
        }),
        tf.layers.dense({
          units: 10, // number of possible actions/categories
          activation: "softmax",
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
   * Phân tích văn bản giao dịch cục bộ, không cần API
   */
  async parseTransaction(
    text: string,
    userCategories: Category[]
  ): Promise<ParsedTransaction | null> {
    try {
      // AI-first local parsing (offline)

      // Bước 1: Nhận diện loại hành động (AI-first)
      const action = await this.detectActionTypeAI(text);
      console.log("📋 Action type:", action);

      // Bước 2: Phân tích số tiền (on-device sequence tagging; regex only as last fallback)
      const amountResult: AmountExtractionResult | null =
        action === "CREATE_TRANSACTION"
          ? await this.parseAmountHybrid(text)
          : null;
      const amount = amountResult?.amount ?? null;
      console.log("💰 Amount:", amount);

      // Bước 3: Nhận diện luồng tiền (keyword-based + defer to category model)
      const io = this.detectIOType(text);
      console.log("📊 IO type:", io);

      // Bước 4: Phân tích ngày
      const date = this.parseDate(text);
      console.log("📅 Date:", date);

      // Bước 5: Trích ghi chú (loại bỏ span số tiền bằng nhãn từ model; tránh regex)
      const note = this.extractNote(text, amountResult || undefined);
      console.log("📝 Note:", note);

      // Bước 6: Danh mục sẽ được phân loại bởi model lịch sử (transactionClassifier) ở chatbox.
      const fallbackCategory =
        userCategories.find((c) => c.type === "expense") || userCategories[0];
      const primary: CategoryPrediction = {
        categoryId: fallbackCategory?.id || "",
        categoryName:
          fallbackCategory?.name || (io === "IN" ? "Thu nhập" : "Chi tiêu"),
        confidence: 10,
      };
      const alternatives: CategoryPrediction[] = [];

      // Bước 7: Tạo thông điệp
      const primaryCategory = userCategories.find(
        (c) => c.id === primary.categoryId
      );
      const message = this.generateMessage(
        action,
        amount,
        note,
        primaryCategory,
        date,
        primary.confidence
      );

      const confidenceThreshold = 75; // Show alternatives if confidence < 75%

      return {
        action,
        amount,
        note,
        categoryId: primary.categoryId,
        categoryName: primary.categoryName,
        io,
        date,
        message,
        primary,
        alternatives: alternatives.filter(
          (alt) => alt.confidence < confidenceThreshold && alt.confidence > 20 // Only show meaningful alternatives
        ),
        confidenceThreshold,
      };
    } catch (error) {
      console.error("❌ TensorFlow parsing failed:", error);
      return null;
    }
  }

  /**
   * AI-first detect action type (offline)
   */
  private async detectActionTypeAI(
    text: string
  ): Promise<ParsedTransaction["action"]> {
    try {
      const pred = await transactionIntentClassifier.predictAction(text);
      if (pred.confidence >= 0.6) return pred.action;
    } catch {
      // ignore
    }
    return "CREATE_TRANSACTION";
  }

  /**
   * Detect IO type (Income vs Expense) from text keywords
   */
  private detectIOType(text: string): "IN" | "OUT" {
    const lowerText = text.toLowerCase();

    // Income keywords (Vietnamese)
    const incomeKeywords = [
      "lương",
      "thu nhập",
      "nhận",
      "tiền lương",
      "thưởng",
      "hoa hồng",
      "tiền thưởng",
      "lãi",
      "cổ tức",
      "bán",
      "bán được",
      "thu",
      "thu về",
      "nhận được",
      "trúng",
      "kiếm được",
    ];

    // Check if any income keyword is present
    for (const keyword of incomeKeywords) {
      if (lowerText.includes(keyword)) {
        return "IN";
      }
    }

    // Default to expense
    return "OUT";
  }

  /**
   * Parse date from Vietnamese text
   */
  private parseDate(text: string): Date {
    const today = new Date();
    const lowerText = text.toLowerCase();

    // Check for DD/MM/YYYY format
    const dateMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?/);
    if (dateMatch) {
      const day = parseInt(dateMatch[1]);
      const month = parseInt(dateMatch[2]) - 1;
      const year = dateMatch[3] ? parseInt(dateMatch[3]) : today.getFullYear();
      return new Date(year, month, day);
    }

    // Vietnamese relative dates
    if (lowerText.includes("hôm qua")) {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return yesterday;
    }

    if (lowerText.includes("hôm kia")) {
      const dayBeforeYesterday = new Date(today);
      dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2);
      return dayBeforeYesterday;
    }

    if (lowerText.includes("tuần trước")) {
      const lastWeek = new Date(today);
      lastWeek.setDate(lastWeek.getDate() - 7);
      return lastWeek;
    }

    // N days ago
    const daysAgoMatch = lowerText.match(/(\d+)\s*ngày\s*trước/);
    if (daysAgoMatch) {
      const daysAgo = parseInt(daysAgoMatch[1]);
      const date = new Date(today);
      date.setDate(date.getDate() - daysAgo);
      return date;
    }

    return today;
  }

  /**
   * Extract note by removing model-labeled amount span (no regex)
   */
  private extractNote(
    text: string,
    amountResult?: AmountExtractionResult
  ): string {
    // Prefer preserving the original text's casing/spacing by using the
    // existing regex-based cleaner which removes amounts but keeps original
    // substrings (parseTransactionText). This avoids tokenization lowercasing
    // and splitting (e.g. "50k" -> "50 k").
    if (amountResult?.tokens?.length && amountResult.labels?.length) {
      try {
        const parsed = parseTransactionText(text);
        if (parsed.note && parsed.note.trim()) return parsed.note;
      } catch {
        // fall through to token-based fallback below
      }

      const kept: string[] = [];
      for (let i = 0; i < amountResult.tokens.length; i++) {
        const label = amountResult.labels[i];
        if (label === "B-AMT" || label === "I-AMT") continue;
        kept.push(amountResult.tokens[i]);
      }
      const note = kept.join(" ").trim();
      return note || "Giao dịch";
    }

    // If no labels (rare), keep raw text.
    return (text || "").trim() || "Giao dịch";
  }

  /**
   * Generate friendly message based on parsed data
   */
  private generateMessage(
    action: string,
    amount: number | null,
    note: string,
    category: Category | undefined,
    date: Date,
    confidence?: number
  ): string {
    if (action === "VIEW_STATS") {
      return "Bạn muốn xem thống kê chi tiêu";
    }

    if (action === "EDIT_TRANSACTION") {
      return "Bạn muốn chỉnh sửa giao dịch";
    }

    if (action === "DELETE_TRANSACTION") {
      return "Bạn muốn xóa giao dịch";
    }

    // CREATE_TRANSACTION
    if (!amount) {
      return "Vui lòng cho biết số tiền cụ thể nhé! 💰";
    }

    const formattedAmount = amount.toLocaleString("vi-VN");
    const dateStr = date.toLocaleDateString("vi-VN");
    const categoryName = category?.name || "Chưa phân loại";
    const emoji = category?.icon || "✅"; // Use icon from database
    const confidenceStr =
      confidence && confidence < 75 ? ` (${confidence}% chắc chắn)` : " ✓";

    // Detect transaction type from category
    const transactionType = category?.type === "income" ? "thu" : "chi";

    return `Đã ghi ${transactionType} ${formattedAmount}đ cho ${note} vào ${dateStr}. Phân loại: ${categoryName}${confidenceStr}.`;
  }

  /**
   * Hybrid amount parser: PhoBERT (ML) + parseAmountVN (regex fallback)
   * Uses PhoBERT for context-aware extraction with confidence scoring
   */
  private async parseAmountHybrid(
    text: string
  ): Promise<AmountExtractionResult> {
    try {
      const phobertResult = await phobertExtractor.extractAmount(text);

      // If model result is low confidence, use regex parser as last resort to avoid null
      if (!phobertResult.amount || phobertResult.confidence < 0.35) {
        const regexAmount = parseAmountVN(text);
        return {
          ...phobertResult,
          amount: phobertResult.amount || regexAmount,
          confidence: phobertResult.amount
            ? phobertResult.confidence
            : regexAmount
              ? 0.25
              : 0,
        };
      }

      return phobertResult;
    } catch (error) {
      console.error("❌ Amount extractor failed, using regex fallback:", error);
      const regexAmount = parseAmountVN(text);
      return {
        amount: regexAmount,
        confidence: regexAmount ? 0.2 : 0,
        tokens: [],
        labels: [],
      };
    }
  }

  /**
   * Train model with transaction history (for future use)
   */
  async trainWithHistory(transactions: any[]): Promise<void> {
    // TODO: Implement training logic
    console.log(
      "🎓 Training not yet implemented, using rule-based classification"
    );
  }
}

// Export singleton instance
export const tfTransactionParser = new TensorFlowTransactionParser();
