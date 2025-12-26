import { db } from "@/db";

export interface SpendingPattern {
  categoryId: string;
  categoryName: string;
  avgMonthlySpend: number;
  stdDeviation: number;
  trendDirection: "increasing" | "stable" | "decreasing";
  priority: "essential" | "flexible" | "discretionary";
  frequency: number; // Số lần giao dịch trung bình/tháng
  lastAmount: number; // Chi tiêu tháng gần nhất
}

export interface HistoricalAnalysisResult {
  patterns: SpendingPattern[];
  avgIncome: number;
  totalSpending: number;
  savingsRate: number;
  volatility: number;
  monthsAnalyzed: number;
  categoryCount: number;
  monthlyTotals?: Array<{ month: string; total: number }>;
  categoryVolatility?: Array<{
    categoryId: string;
    categoryName: string;
    cv: number;
    avg: number;
    stdDev: number;
    lastAmount: number;
    trendDirection: "increasing" | "stable" | "decreasing";
  }>;
}

export interface CategoryPrediction {
  categoryId: string;
  categoryName: string;
  groupType: "needs" | "wants" | "savings";
  suggestedAmount: number;
  confidence: number;
  reasoning: string;
}

export interface MLPrediction {
  categoryAllocations: CategoryPrediction[];
  ratioAdjustments: {
    needs: number;
    wants: number;
    savings: number;
  };
  riskScore: number; // 0-1, khả năng vượt chi
  insights: string[];
}

export interface TFLiteInputFeatures {
  textEmbedding: Float32Array;
  income: number;
  age?: number;
  location?: string;
  occupation?: string;
  dependents?: number;
  historicalPatterns?: {
    avgMonthlySpend: number;
    savingsRate: number;
    volatility: number;
    topCategories: Array<{ id: string; ratio: number }>;
  };
  month: number;
  isHolidaySeason?: boolean;
}

export interface TFLiteModelOutput {
  categoryScores: Float32Array;
  ratios: {
    needs: number;
    wants: number;
    savings: number;
  };
  riskScore: number;
  riskConfidence: number;
}

export interface ModelMetadata {
  version: string;
  trainedOn: string; // ISO date
  accuracy: number;
  sampleSize: number;
  categories: Array<{
    id: string;
    name: string;
    groupType: "needs" | "wants" | "savings";
  }>;
}

// ============================================================================
// TEXT ENCODER - Mã hóa văn bản tiếng Việt thành vector
// ============================================================================

class TextEncoder {
  private vocabulary: Map<string, number> = new Map();
  private readonly EMBEDDING_DIM = 128;

  constructor() {
    this._buildVocabulary();
  }

  /**
   * Mã hóa văn bản tiếng Việt thành embedding vector
   */
  async encode(text: string): Promise<Float32Array> {
    const normalized = this._normalize(text);
    const tokens = this._tokenize(normalized);
    const embedding = this._tokensToEmbedding(tokens);
    return embedding;
  }

  private _normalize(text: string): string {
    return text.toLowerCase().trim().replace(/\s+/g, " ");
  }

  private _tokenize(text: string): string[] {
    return text.split(/\s+/);
  }

  private _tokensToEmbedding(tokens: string[]): Float32Array {
    const embedding = new Float32Array(this.EMBEDDING_DIM);
    const tokenFreq = new Map<string, number>();

    tokens.forEach((token) => {
      tokenFreq.set(token, (tokenFreq.get(token) || 0) + 1);
    });

    let idx = 0;
    tokenFreq.forEach((freq, token) => {
      const vocabIdx = this.vocabulary.get(token);
      if (vocabIdx !== undefined && idx < this.EMBEDDING_DIM) {
        embedding[idx] = (vocabIdx / this.vocabulary.size) * freq;
        idx++;
      }
    });

    // Chuẩn hóa vector
    const norm = Math.sqrt(
      Array.from(embedding).reduce((sum, val) => sum + val * val, 0)
    );

    if (norm > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
  }

  private _buildVocabulary(): void {
    const commonWords = [
      // Nhà ở
      "nhà",
      "thuê",
      "trọ",
      "chung",
      "cư",
      "mặt",
      "bằng",
      "phòng",
      // Ăn uống
      "ăn",
      "uống",
      "cơm",
      "thức",
      "đồ",
      "quán",
      "nhà hàng",
      "cafe",
      // Đi lại
      "đi",
      "lại",
      "xe",
      "xăng",
      "grab",
      "giao",
      "thông",
      "bus",
      // Mua sắm
      "mua",
      "sắm",
      "shopping",
      "mall",
      "siêu",
      "thị",
      "cửa",
      "hàng",
      // Giải trí
      "vui",
      "chơi",
      "giải",
      "trí",
      "phim",
      "game",
      "du",
      "lịch",
      // Tiết kiệm
      "tiết",
      "kiệm",
      "gửi",
      "tiền",
      "đầu",
      "tư",
      "chứng",
      "khoán",
      // Số
      "triệu",
      "nghìn",
      "trăm",
      "tỷ",
      "k",
      "m",
      // Thời gian
      "tháng",
      "tuần",
      "ngày",
      "năm",
      // Tính từ
      "nhiều",
      "ít",
      "cao",
      "thấp",
      "lớn",
      "nhỏ",
    ];

    commonWords.forEach((word, idx) => {
      this.vocabulary.set(word, idx);
    });
  }
}

export const textEncoder = new TextEncoder();

// ============================================================================
// HISTORICAL ANALYZER - Phân tích lịch sử chi tiêu
// ============================================================================

export class HistoricalAnalyzer {
  /**
   * Phân tích lịch sử chi tiêu từ N tháng gần nhất
   */
  async analyzeSpendingHistory(
    userId: string,
    months = 3
  ): Promise<HistoricalAnalysisResult | null> {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - months);

      const startTimestamp = Math.floor(startDate.getTime() / 1000);
      const endTimestamp = Math.floor(endDate.getTime() / 1000);

      // Query giao dịch theo tháng
      const transactions = await db.getAllAsync<any>(
        `
        SELECT 
          c.id as category_id,
          c.name as category_name,
          strftime('%Y-%m', t.occurred_at, 'unixepoch') as month,
          SUM(t.amount) as total_amount,
          COUNT(*) as txn_count,
          AVG(t.amount) as avg_txn_amount,
          MAX(t.occurred_at) as last_date
        FROM transactions t
        JOIN categories c ON t.category_id = c.id
        WHERE t.user_id = ? 
          AND t.occurred_at >= ?
          AND t.occurred_at <= ?
          AND t.type = 'expense'
        GROUP BY c.id, month
        ORDER BY month DESC, total_amount DESC
      `,
        userId as any,
        startTimestamp,
        endTimestamp
      );

      if (transactions.length === 0) {
        console.log("[HistoricalAnalyzer] Không tìm thấy lịch sử giao dịch");
        return null;
      }

      // Nhóm theo danh mục
      const categoryMap = new Map<string, any[]>();
      const monthTotalsMap = new Map<string, number>();

      transactions.forEach((txn: any) => {
        if (!categoryMap.has(txn.category_id)) {
          categoryMap.set(txn.category_id, []);
        }
        categoryMap.get(txn.category_id)!.push(txn);

        // Tính tổng theo tháng (toàn bộ danh mục)
        monthTotalsMap.set(
          txn.month,
          (monthTotalsMap.get(txn.month) || 0) + txn.total_amount
        );
      });

      const monthlyTotals = Array.from(monthTotalsMap.entries())
        .map(([month, total]) => ({ month, total }))
        .sort((a, b) => (a.month < b.month ? 1 : -1));

      // Phân tích từng danh mục
      const patterns: SpendingPattern[] = [];
      const categoryVolatility: NonNullable<
        HistoricalAnalysisResult["categoryVolatility"]
      > = [];

      for (const [categoryId, monthlyData] of categoryMap.entries()) {
        const amounts = monthlyData.map((d) => d.total_amount);
        const avgSpend = amounts.reduce((s, a) => s + a, 0) / amounts.length;

        // Độ lệch chuẩn
        const variance =
          amounts.reduce((s, a) => s + Math.pow(a - avgSpend, 2), 0) /
          amounts.length;
        const stdDev = Math.sqrt(variance);

        // Phát hiện xu hướng
        const trend = this.detectTrend(amounts);

        // Phân loại ưu tiên (dựa trên hệ số biến thiên)
        const cv = avgSpend > 0 ? stdDev / avgSpend : 1;
        let priority: SpendingPattern["priority"] = "flexible";

        if (cv < 0.2) {
          priority = "essential"; // Ổn định cao → cần thiết
        } else if (cv > 0.5) {
          priority = "discretionary"; // Biến động cao → tùy ý
        }

        // Tính tần suất
        const totalTxnCount = monthlyData.reduce((s, d) => s + d.txn_count, 0);
        const avgFrequency = totalTxnCount / monthlyData.length;

        patterns.push({
          categoryId,
          categoryName: monthlyData[0].category_name,
          avgMonthlySpend: Math.round(avgSpend),
          stdDeviation: Math.round(stdDev),
          trendDirection: trend,
          priority,
          frequency: Math.round(avgFrequency),
          lastAmount: monthlyData[0].total_amount,
        });

        categoryVolatility.push({
          categoryId,
          categoryName: monthlyData[0].category_name,
          cv,
          avg: avgSpend,
          stdDev,
          lastAmount: monthlyData[0].total_amount,
          trendDirection: trend,
        });
      }

      // Sắp xếp theo chi tiêu trung bình giảm dần
      patterns.sort((a, b) => b.avgMonthlySpend - a.avgMonthlySpend);

      // Tính tổng chi tiêu trung bình
      const totalSpending = patterns.reduce(
        (sum, p) => sum + p.avgMonthlySpend,
        0
      );

      // Tính thu nhập trung bình
      const incomeData = await db.getAllAsync<any>(
        `
        SELECT 
          strftime('%Y-%m', t.occurred_at, 'unixepoch') as month,
          SUM(t.amount) as total_income
        FROM transactions t
        JOIN categories c ON t.category_id = c.id
        WHERE t.user_id = ?
          AND t.occurred_at >= ?
          AND t.occurred_at <= ?
          AND t.type = 'income'
        GROUP BY month
      `,
        userId as any,
        startTimestamp,
        endTimestamp
      );

      let avgIncome = 0;
      if (incomeData.length > 0) {
        const totalIncome = incomeData.reduce(
          (sum: number, d: any) => sum + d.total_income,
          0
        );
        avgIncome = Math.round(totalIncome / incomeData.length);
      }

      // Tỷ lệ tiết kiệm
      const savingsRate =
        avgIncome > 0
          ? Math.max(0, (avgIncome - totalSpending) / avgIncome)
          : 0;

      // Độ biến động
      const volatility = this.calculateVolatility(patterns);

      console.log(`[HistoricalAnalyzer] Đã phân tích ${months} tháng:`, {
        patterns: patterns.length,
        avgIncome,
        totalSpending,
        savingsRate: `${(savingsRate * 100).toFixed(1)}%`,
        volatility: volatility.toFixed(2),
      });

      return {
        patterns,
        avgIncome,
        totalSpending,
        savingsRate,
        volatility,
        monthsAnalyzed: months,
        categoryCount: patterns.length,
        monthlyTotals,
        categoryVolatility,
      };
    } catch (error) {
      console.error("[HistoricalAnalyzer] Lỗi:", error);
      return null;
    }
  }

  /**
   * Phát hiện xu hướng từ chuỗi số liệu
   */
  private detectTrend(
    values: number[]
  ): "increasing" | "stable" | "decreasing" {
    if (values.length < 2) return "stable";

    // Hồi quy tuyến tính đơn giản để tính slope
    const n = values.length;
    const indices = Array.from({ length: n }, (_, i) => i);

    const sumX = indices.reduce((s, x) => s + x, 0);
    const sumY = values.reduce((s, y) => s + y, 0);
    const sumXY = indices.reduce((s, x, i) => s + x * values[i], 0);
    const sumX2 = indices.reduce((s, x) => s + x * x, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

    // Tính slope tương đối (so với giá trị trung bình)
    const avgValue = sumY / n;
    const relativeSlope = avgValue > 0 ? slope / avgValue : 0;

    if (relativeSlope > 0.05) return "increasing"; // Tăng > 5%/tháng
    if (relativeSlope < -0.05) return "decreasing"; // Giảm > 5%/tháng
    return "stable";
  }

  /**
   * Tính độ biến động tổng thể
   */
  private calculateVolatility(patterns: SpendingPattern[]): number {
    if (patterns.length === 0) return 0;

    const cvs = patterns.map((p) =>
      p.avgMonthlySpend > 0 ? p.stdDeviation / p.avgMonthlySpend : 0
    );

    return cvs.reduce((s, cv) => s + cv, 0) / cvs.length;
  }

  /**
   * Tính độ lệch so với thói quen
   */
  calculateDeviation(
    proposedAllocations: Array<{ categoryId: string; amount: number }>,
    historicalPatterns: SpendingPattern[]
  ): number {
    const patternMap = new Map(
      historicalPatterns.map((p) => [p.categoryId, p.avgMonthlySpend])
    );

    let totalHistorical = 0;
    let totalProposed = 0;
    let sumSquaredDiff = 0;

    proposedAllocations.forEach((alloc) => {
      const historical = patternMap.get(alloc.categoryId) || 0;
      totalHistorical += historical;
      totalProposed += alloc.amount;

      const diff = alloc.amount - historical;
      sumSquaredDiff += diff * diff;
    });

    if (totalHistorical === 0) return 0;

    const rmse = Math.sqrt(sumSquaredDiff / proposedAllocations.length);
    return rmse / totalHistorical;
  }
}

// ============================================================================
// BUDGET PREDICTOR - Dự đoán ngân sách bằng ML/heuristics
// ============================================================================

export class BudgetPredictor {
  private isReady = false;

  async initialize(): Promise<void> {
    this.isReady = true;
    console.log("[BudgetPredictor] Đã khởi tạo (chế độ heuristic)");
  }

  async predict(input: {
    income: number;
    lifestyleText: string;
    historicalPatterns: SpendingPattern[];
    currentMonth: number;
  }): Promise<MLPrediction> {
    if (!this.isReady) {
      await this.initialize();
    }

    console.log("[BudgetPredictor] Đang dự đoán ngân sách...", {
      income: input.income,
      textLength: input.lifestyleText.length,
      patterns: input.historicalPatterns.length,
    });

    // Trích xuất đặc trưng từ mô tả lối sống
    const textFeatures = this.extractTextFeatures(input.lifestyleText);

    // Phân tích đặc trưng lịch sử
    const historicalFeatures = this.analyzeHistoricalFeatures(
      input.historicalPatterns,
      input.income
    );

    // Tính tỷ lệ điều chỉnh
    const ratioAdjustments = this.predictRatios(
      input.income,
      textFeatures,
      historicalFeatures
    );

    // Phân bổ số tiền cho từng danh mục
    const categoryAllocations = this.allocateCategories(
      input.income,
      input.historicalPatterns,
      textFeatures,
      ratioAdjustments
    );

    // Tính điểm rủi ro
    const riskScore = this.calculateRiskScore(
      input.income,
      categoryAllocations,
      historicalFeatures
    );

    // Tạo gợi ý
    const insights = this.generateInsights(
      input,
      historicalFeatures,
      riskScore,
      ratioAdjustments
    );

    return {
      categoryAllocations,
      ratioAdjustments,
      riskScore,
      insights,
    };
  }

  private extractTextFeatures(text: string): any {
    const lower = text.toLowerCase();
    const features = {
      hasSavingsGoal: /tiết kiệm|gửi tiền|đầu tư|chứng khoán/.test(lower),
      hasDebt: /nợ|trả nợ|vay|trả góp/.test(lower),
      hasFamily: /gia đình|vợ|chồng|con|bố|mẹ/.test(lower),
      hasHousing: /thuê|trọ|nhà|căn hộ|chung cư/.test(lower),
      hasTransport: /xe|xăng|grab|xe ôm|đi lại/.test(lower),
      hasShopping: /mua sắm|shopping|mall|siêu thị/.test(lower),
      hasEntertainment: /vui chơi|giải trí|phim|game|du lịch/.test(lower),
      hasBigPurchase: /mua|sắm|điện thoại|laptop|xe/.test(lower),
    };

    return features;
  }

  private analyzeHistoricalFeatures(
    patterns: SpendingPattern[],
    income: number
  ): any {
    if (patterns.length === 0) {
      return {
        avgSpendingRatio: 0,
        volatility: 0,
        topCategories: [],
      };
    }

    const totalSpend = patterns.reduce((s, p) => s + p.avgMonthlySpend, 0);
    const avgSpendingRatio = income > 0 ? totalSpend / income : 0;

    const volatilities = patterns.map((p) =>
      p.avgMonthlySpend > 0 ? p.stdDeviation / p.avgMonthlySpend : 0
    );
    const volatility =
      volatilities.reduce((s, v) => s + v, 0) / volatilities.length;

    const topCategories = patterns.slice(0, 5).map((p) => ({
      id: p.categoryId,
      name: p.categoryName,
      ratio: p.avgMonthlySpend / totalSpend,
    }));

    return {
      avgSpendingRatio,
      volatility,
      topCategories,
    };
  }

  private predictRatios(
    income: number,
    textFeatures: any,
    historicalFeatures: any
  ): { needs: number; wants: number; savings: number } {
    // Tỷ lệ cơ bản 50/30/20
    let needs = 0.5;
    let wants = 0.3;
    let savings = 0.2;

    // Điều chỉnh theo thu nhập
    if (income < 10000000) {
      needs = 0.6;
      wants = 0.25;
      savings = 0.15;
    } else if (income > 30000000) {
      needs = 0.45;
      wants = 0.3;
      savings = 0.25;
    }

    // Điều chỉnh theo đặc trưng văn bản
    if (textFeatures.hasSavingsGoal) {
      savings += 0.05;
      wants -= 0.05;
    }

    if (textFeatures.hasDebt) {
      needs += 0.05;
      wants -= 0.05;
    }

    if (textFeatures.hasFamily) {
      needs += 0.03;
      savings -= 0.03;
    }

    // Chuẩn hóa
    const sum = needs + wants + savings;
    return {
      needs: needs / sum,
      wants: wants / sum,
      savings: savings / sum,
    };
  }

  private allocateCategories(
    income: number,
    historicalPatterns: SpendingPattern[],
    textFeatures: any,
    ratioAdjustments: { needs: number; wants: number; savings: number }
  ): CategoryPrediction[] {
    const allocations: CategoryPrediction[] = [];

    // Nếu có lịch sử, sử dụng patterns
    if (historicalPatterns.length > 0) {
      // Nhóm theo groupType
      const needsPatterns = historicalPatterns.filter((p) =>
        ["housing", "food", "transport", "utilities"].some((cat) =>
          p.categoryName.toLowerCase().includes(cat)
        )
      );
      const wantsPatterns = historicalPatterns.filter((p) =>
        ["shopping", "entertainment", "dining"].some((cat) =>
          p.categoryName.toLowerCase().includes(cat)
        )
      );
      const savingsPatterns = historicalPatterns.filter((p) =>
        p.categoryName.toLowerCase().includes("savings")
      );

      // Phân bổ cho needs
      const needsBudget = income * ratioAdjustments.needs;
      needsPatterns.forEach((p) => {
        allocations.push({
          categoryId: p.categoryId,
          categoryName: p.categoryName,
          groupType: "needs",
          suggestedAmount: Math.min(p.avgMonthlySpend * 1.1, needsBudget / 3),
          confidence: 0.8,
          reasoning: `Dựa trên chi tiêu trung bình ${p.avgMonthlySpend.toLocaleString(
            "vi-VN"
          )}đ`,
        });
      });

      // Phân bổ cho wants
      const wantsBudget = income * ratioAdjustments.wants;
      wantsPatterns.forEach((p) => {
        allocations.push({
          categoryId: p.categoryId,
          categoryName: p.categoryName,
          groupType: "wants",
          suggestedAmount: Math.min(p.avgMonthlySpend, wantsBudget / 2),
          confidence: 0.7,
          reasoning: `Dựa trên chi tiêu trung bình ${p.avgMonthlySpend.toLocaleString(
            "vi-VN"
          )}đ`,
        });
      });

      // Phân bổ cho savings
      const savingsBudget = income * ratioAdjustments.savings;
      allocations.push({
        categoryId: "savings",
        categoryName: "Tiết kiệm",
        groupType: "savings",
        suggestedAmount: savingsBudget,
        confidence: 0.9,
        reasoning: "Tiết kiệm tự động",
      });
    } else {
      // Người dùng mới: sử dụng danh mục mặc định
      const needsBudget = income * ratioAdjustments.needs;
      const wantsBudget = income * ratioAdjustments.wants;
      const savingsBudget = income * ratioAdjustments.savings;

      allocations.push(
        {
          categoryId: "housing",
          categoryName: "Thuê nhà",
          groupType: "needs",
          suggestedAmount: needsBudget * 0.4,
          confidence: 0.7,
          reasoning: "Ước tính cho nhà ở",
        },
        {
          categoryId: "food",
          categoryName: "Thức ăn & Đồ uống",
          groupType: "needs",
          suggestedAmount: needsBudget * 0.3,
          confidence: 0.7,
          reasoning: "Ước tính cho ăn uống",
        },
        {
          categoryId: "transport",
          categoryName: "Đi lại",
          groupType: "needs",
          suggestedAmount: needsBudget * 0.2,
          confidence: 0.6,
          reasoning: "Ước tính cho đi lại",
        },
        {
          categoryId: "shopping",
          categoryName: "Mua sắm",
          groupType: "wants",
          suggestedAmount: wantsBudget * 0.7,
          confidence: 0.5,
          reasoning: "Ước tính cho mua sắm",
        },
        {
          categoryId: "entertainment",
          categoryName: "Giải trí",
          groupType: "wants",
          suggestedAmount: wantsBudget * 0.3,
          confidence: 0.5,
          reasoning: "Ước tính cho giải trí",
        },
        {
          categoryId: "savings",
          categoryName: "Tiết kiệm",
          groupType: "savings",
          suggestedAmount: savingsBudget,
          confidence: 0.9,
          reasoning: "Tiết kiệm tự động",
        }
      );
    }

    return allocations;
  }

  private calculateRiskScore(
    income: number,
    allocations: CategoryPrediction[],
    historicalFeatures: any
  ): number {
    let risk = 0;

    // Rủi ro từ tỷ lệ chi tiêu
    const totalAllocated = allocations.reduce(
      (s, a) => s + a.suggestedAmount,
      0
    );
    const spendingRatio = totalAllocated / income;

    if (spendingRatio > 0.9) risk += 0.4;
    else if (spendingRatio > 0.8) risk += 0.2;

    // Rủi ro từ độ biến động lịch sử
    if (historicalFeatures.volatility > 0.5) risk += 0.3;
    else if (historicalFeatures.volatility > 0.3) risk += 0.15;

    // Rủi ro từ tỷ lệ nhu cầu thiết yếu
    const needsRatio =
      allocations
        .filter((a) => a.groupType === "needs")
        .reduce((s, a) => s + a.suggestedAmount, 0) / income;

    if (needsRatio > 0.7) risk += 0.2;

    // Rủi ro từ thiếu lịch sử
    if (historicalFeatures.topCategories.length === 0) risk += 0.1;

    return Math.min(1, risk);
  }

  private generateInsights(
    input: any,
    historicalFeatures: any,
    riskScore: number,
    ratioAdjustments: any
  ): string[] {
    const insights: string[] = [];

    // Insight về người dùng mới vs có lịch sử
    if (historicalFeatures.topCategories.length === 0) {
      insights.push(
        "📝 Gợi ý dựa trên mô tả lối sống của bạn (chưa có lịch sử chi tiêu)"
      );
    } else {
      insights.push(
        `📊 Phân tích dựa trên ${historicalFeatures.topCategories.length} danh mục chi tiêu chính của bạn`
      );
    }

    // Insight về rủi ro
    if (riskScore > 0.7) {
      insights.push("⚠️ Cảnh báo: Ngân sách có nguy cơ vượt chi cao");
    } else if (riskScore > 0.4) {
      insights.push("💡 Lưu ý: Nên theo dõi chi tiêu thường xuyên");
    } else {
      insights.push("✅ Ngân sách hợp lý, có dư địa cho tiết kiệm");
    }

    // Insight về tiết kiệm
    const savingsPercent = Math.round(ratioAdjustments.savings * 100);
    if (savingsPercent >= 20) {
      insights.push(`💰 Tốt! Tiết kiệm ${savingsPercent}% thu nhập`);
    } else if (savingsPercent < 15) {
      insights.push(`📈 Nên tăng tiết kiệm lên ít nhất 15% thu nhập`);
    }

    return insights;
  }
}

// ============================================================================
// TFLITE MODEL MANAGER - Quản lý model TensorFlow Lite (placeholder)
// ============================================================================

export class TFLiteModelManager {
  private model: any = null;
  private metadata: ModelMetadata | null = null;
  private isReady = false;
  private loadPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.isReady) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = this._loadModel();
    return this.loadPromise;
  }

  private async _loadModel(): Promise<void> {
    try {
      // Giả lập việc load model
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Load metadata
      this.metadata = {
        version: "1.0.0-placeholder",
        trainedOn: "2025-01-01T00:00:00Z",
        accuracy: 0.75,
        sampleSize: 0,
        categories: [],
      };

      this.isReady = true;
      console.log("[TFLiteModel] Model đã sẵn sàng (chế độ placeholder)");
    } catch (error) {
      console.warn("[TFLiteModel] Không thể load model:", error);
      throw error;
    }
  }

  async predict(input: TFLiteInputFeatures): Promise<TFLiteModelOutput> {
    if (!this.isReady) {
      await this.initialize();
    }
    return this._placeholderInference(input);
  }

  private _placeholderInference(input: TFLiteInputFeatures): TFLiteModelOutput {
    console.log("[TFLiteModel] Đang chạy inference placeholder");

    const categoryScores = new Float32Array(50).fill(0.5);

    return {
      categoryScores,
      ratios: {
        needs: 0.5,
        wants: 0.3,
        savings: 0.2,
      },
      riskScore: 0.5,
      riskConfidence: 0.7,
    };
  }

  getMetadata(): ModelMetadata | null {
    return this.metadata;
  }

  isModelReady(): boolean {
    return this.isReady;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const budgetPredictor = new BudgetPredictor();
export const tfliteModel = new TFLiteModelManager();
export const historicalAnalyzer = new HistoricalAnalyzer();
