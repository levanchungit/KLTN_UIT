import AsyncStorage from "@react-native-async-storage/async-storage";
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-react-native";
import { parseAmountVN } from "../utils/textPreprocessing";
import { phobertExtractor } from "./phobertAmountExtractor";

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
      // Tạm bỏ khởi tạo TensorFlow, chỉ dùng phân tích theo luật
      // Tránh lỗi thiết lập TF ở lần chạy đầu tiên
      console.log("🔍 Parsing text locally (rule-based):", text);

      // Bước 1: Nhận diện loại hành động
      const action = this.detectActionType(text);
      console.log("📋 Action type:", action);

      // Bước 2: Phân tích số tiền bằng cách kết hợp (PhoBERT + dự phòng)
      const amount =
        action === "CREATE_TRANSACTION"
          ? await this.parseAmountHybrid(text)
          : null;
      console.log("💰 Amount:", amount);

      // Bước 3: Nhận diện luồng tiền (IN/OUT)
      const io = this.detectIOType(text);
      console.log("📊 IO type:", io);

      // Bước 4: Phân tích ngày
      const date = this.parseDate(text);
      console.log("📅 Date:", date);

      // Bước 5: Trích ghi chú (loại bỏ số tiền và ngày)
      const note = this.extractNote(text, amount);
      console.log("📝 Note:", note);

      // Bước 6: Phân loại danh mục kèm độ tin cậy + lựa chọn thay thế
      const { primary, alternatives } = await this.classifyCategory(
        note,
        userCategories,
        io
      );
      console.log(
        "🏷️ Primary category:",
        primary.categoryName,
        `(${primary.confidence}%)`
      );
      if (alternatives.length > 0) {
        console.log(
          "🔄 Alternatives:",
          alternatives.map((a) => `${a.categoryName} (${a.confidence}%)`)
        );
      }

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
   * Detect action type from text patterns
   */
  private detectActionType(text: string): ParsedTransaction["action"] {
    const lowerText = text.toLowerCase();

    // VIEW_STATS patterns
    const statsPatterns = [
      /xem thống kê/,
      /báo cáo/,
      /phân tích/,
      /tổng kết/,
      /thống kê/,
    ];

    // EDIT patterns
    const editPatterns = [
      /sửa.*giao dịch/,
      /chỉnh sửa/,
      /thay đổi/,
      /cập nhật/,
    ];

    // DELETE patterns
    const deletePatterns = [/xóa.*giao dịch/, /hủy.*giao dịch/, /xóa.*cuối/];

    // Check patterns
    if (statsPatterns.some((p) => p.test(lowerText))) return "VIEW_STATS";
    if (editPatterns.some((p) => p.test(lowerText))) return "EDIT_TRANSACTION";
    if (deletePatterns.some((p) => p.test(lowerText)))
      return "DELETE_TRANSACTION";

    // Check if has amount → CREATE_TRANSACTION
    const hasAmount = /\d+[kKtrTR]|\d{3,}/.test(text);
    if (hasAmount) return "CREATE_TRANSACTION";

    // Default: CREATE_TRANSACTION
    return "CREATE_TRANSACTION";
  }

  /**
   * Detect IO type (income/expense)
   */
  private detectIOType(text: string): "IN" | "OUT" {
    const lowerText = text.toLowerCase();

    // Income keywords
    const incomeKeywords = ["nhận", "thu", "lương", "thưởng", "được", "kiếm"];

    // Expense keywords
    const expenseKeywords = ["mua", "chi", "trả", "nạp", "mất", "tiêu"];

    const hasIncome = incomeKeywords.some((k) => lowerText.includes(k));
    const hasExpense = expenseKeywords.some((k) => lowerText.includes(k));

    if (hasIncome && !hasExpense) return "IN";
    return "OUT"; // Default to expense
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
   * Extract note by removing amount and date from text
   */
  private extractNote(text: string, amount: number | null): string {
    let note = text;

    // Remove amount patterns
    note = note.replace(
      /\d+[.,]?\d*\s*(k|K|tr|TR|triệu|trieu|nghìn|nghin|đ|d|đồng|dong)\b/gi,
      ""
    );

    // Remove date patterns
    note = note.replace(/\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{4})?/g, "");
    note = note.replace(
      /\b(hôm nay|hôm qua|hôm kia|tuần trước|ngày\s+\d+)\b/gi,
      ""
    );
    note = note.replace(/\d+\s*ngày\s*trước/gi, "");

    // Remove extra spaces
    note = note.replace(/\s+/g, " ").trim();

    return note || "Giao dịch";
  }

  /**
   * Classify category with confidence scoring and alternatives
   * Returns primary + alternative predictions for user to choose from
   */
  private async classifyCategory(
    note: string,
    userCategories: Category[],
    io: "IN" | "OUT"
  ): Promise<{
    primary: CategoryPrediction;
    alternatives: CategoryPrediction[];
  }> {
    const lowerNote = note.toLowerCase();

    // Filter categories by IO type
    const filteredCategories = userCategories.filter((c) =>
      io === "IN" ? c.type === "income" : c.type === "expense"
    );

    if (filteredCategories.length === 0) {
      const fallback: CategoryPrediction = {
        categoryId: "",
        categoryName: io === "IN" ? "Thu nhập" : "Chi tiêu",
        confidence: 50,
      };
      return {
        primary: fallback,
        alternatives: [],
      };
    }

    // Score all categories
    const scores: { category: Category; score: number }[] = [];

    const keywordMap: Record<string, string[]> = {
      "ăn uống": [
        "ăn",
        "uống",
        "trà",
        "cà phê",
        "coffee",
        "quán",
        "nhà hàng",
        "buffet",
      ],
      "mua sắm": ["mua", "shopping", "quần áo", "giày", "túi"],
      "di chuyển": ["taxi", "grab", "xe", "xăng", "dầu", "bus", "tàu"],
      "du lịch": ["du lịch", "tour", "khách sạn", "resort", "vé máy bay"],
      "giải trí": ["phim", "game", "vui chơi", "karaoke", "bar"],
      "học tập": ["sách", "học", "khóa học", "trường"],
      "sức khỏe": ["thuốc", "bệnh viện", "khám", "bác sĩ"],
      "thu nhập": ["lương", "thưởng", "bonus"],
    };

    for (const category of filteredCategories) {
      let score = 10; // baseline score

      const lowerCategoryName = category.name.toLowerCase();

      // Exact name match: +90 confidence
      if (lowerNote.includes(lowerCategoryName)) {
        score = 90;
      } else {
        // Keyword matching
        const keywords = keywordMap[lowerCategoryName] || [];
        const matchedKeywords = keywords.filter((k) => lowerNote.includes(k));

        if (matchedKeywords.length > 0) {
          // Multi-keyword boost: 80 for first match, +5 per additional
          score = 75 + matchedKeywords.length * 5;
        }
      }

      scores.push({ category, score: Math.min(score, 100) });
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    // Primary: highest confidence
    const primaryScore = scores[0];
    const primary: CategoryPrediction = {
      categoryId: primaryScore.category.id,
      categoryName: primaryScore.category.name,
      confidence: primaryScore.score,
    };

    // Alternatives: top 2-3 other predictions (only if different confidence buckets)
    const alternatives: CategoryPrediction[] = scores
      .slice(1, 4)
      .filter((s) => s.score > 20) // Filter out very low confidence
      .map((s) => ({
        categoryId: s.category.id,
        categoryName: s.category.name,
        confidence: s.score,
      }));

    return { primary, alternatives };
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
  private async parseAmountHybrid(text: string): Promise<number | null> {
    try {
      // Step 1: Try PhoBERT extractor (ML-based, context-aware)
      const phobertResult = await phobertExtractor.extractAmount(text);

      if (phobertResult.amount && phobertResult.confidence > 0.7) {
        // High confidence from PhoBERT - use it
        console.log(
          `✅ PhoBERT: ${phobertResult.amount} (${(
            phobertResult.confidence * 100
          ).toFixed(1)}% confidence)`
        );
        return phobertResult.amount;
      }

      // Step 2: Low confidence, try regex fallback
      const regexAmount = parseAmountVN(text);

      if (phobertResult.amount && regexAmount) {
        // Both methods agree - high confidence
        if (phobertResult.amount === regexAmount) {
          console.log(`✅ PhoBERT + Regex agree: ${regexAmount}`);
          return regexAmount;
        }

        // Disagreement - use PhoBERT if reasonable confidence
        if (phobertResult.confidence > 0.5) {
          console.log(
            `⚖️ Disagreement (PhoBERT: ${phobertResult.amount}, Regex: ${regexAmount}), using PhoBERT`
          );
          return phobertResult.amount;
        }
      }

      // Step 3: Fallback priority
      const finalAmount = phobertResult.amount || regexAmount;

      if (finalAmount) {
        const source = phobertResult.amount ? "PhoBERT" : "Regex";
        console.log(`⚠️ Low confidence, using ${source}: ${finalAmount}`);
      }

      return finalAmount;
    } catch (error) {
      // Step 4: Emergency fallback to regex
      console.error("❌ PhoBERT failed, using regex fallback:", error);
      return parseAmountVN(text);
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
