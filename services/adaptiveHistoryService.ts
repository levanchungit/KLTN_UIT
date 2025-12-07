import { db } from "@/db";
import {
  HistoricalAnalysisResult,
  historicalAnalyzer,
} from "./budgetAIService";

// ============================================================================
// INTERFACES
// ============================================================================

export interface HistoryQualityMetrics {
  transactionCount: number; // Tổng số giao dịch
  timeSpan: number; // Khoảng thời gian (tháng)
  categoryDiversity: number; // Số danh mục khác nhau
  consistencyScore: number; // Điểm nhất quán (0-1)
  overallQuality: number; // Điểm chất lượng tổng thể (0-1)
  tier: "new" | "growing" | "established"; // Phân loại
}

// ============================================================================
// INTELLIGENT HISTORY DETECTION
// ============================================================================

/**
 * Phát hiện chất lượng lịch sử chi tiêu thông minh
 * Không yêu cầu cứng nhắc 3 tháng, mà đánh giá dựa trên 4 tiêu chí:
 * - Số lượng giao dịch
 * - Khoảng thời gian
 * - Độ đa dạng danh mục
 * - Tính nhất quán
 */
export async function intelligentHistoryDetection(
  userId: string
): Promise<HistoryQualityMetrics | null> {
  try {
    const now = Date.now() / 1000;
    const threeMonthsAgo = now - 90 * 24 * 60 * 60;

    // Lấy tất cả giao dịch chi tiêu trong 3 tháng
    const transactions = await db.getAllAsync<any>(
      `
      SELECT 
        t.id,
        t.amount,
        t.date,
        t.category_id,
        c.name as category_name
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      WHERE t.user_id = ?
        AND t.type = 'expense'
        AND t.date >= ?
      ORDER BY t.date DESC
    `,
      userId as any,
      Math.floor(threeMonthsAgo)
    );

    if (transactions.length === 0) {
      console.log("[AdaptiveHistory] Không có giao dịch nào");
      return null;
    }

    // 1. Đếm số giao dịch
    const transactionCount = transactions.length;

    // 2. Tính khoảng thời gian (tháng)
    const oldestDate = transactions[transactions.length - 1].date;
    const newestDate = transactions[0].date;
    const timeSpanDays = (newestDate - oldestDate) / (24 * 60 * 60);
    const timeSpan = Math.max(1, timeSpanDays / 30); // Ít nhất 1 tháng

    // 3. Đếm số danh mục khác nhau
    const uniqueCategories = new Set(transactions.map((t) => t.category_id))
      .size;

    // 4. Tính điểm nhất quán (consistency)
    // Nhất quán = chi tiêu đều theo thời gian
    const consistencyScore = calculateConsistency(transactions, timeSpan);

    // Tính điểm chất lượng tổng thể
    // Trọng số: txn (30%), time (30%), category (20%), consistency (20%)
    const txnScore = Math.min(1, transactionCount / 15) * 0.3;
    const timeScore = Math.min(1, timeSpan / 2) * 0.3;
    const catScore = Math.min(1, uniqueCategories / 5) * 0.2;
    const consScore = consistencyScore * 0.2;

    const overallQuality = txnScore + timeScore + catScore + consScore;

    // Phân loại
    let tier: HistoryQualityMetrics["tier"] = "new";
    if (overallQuality >= 0.7) {
      tier = "established"; // Lịch sử tốt
    } else if (overallQuality >= 0.4) {
      tier = "growing"; // Lịch sử đang phát triển
    }

    console.log(`[AdaptiveHistory] Đánh giá chất lượng lịch sử:`, {
      transactionCount,
      timeSpan: timeSpan.toFixed(1),
      categoryDiversity: uniqueCategories,
      consistencyScore: consistencyScore.toFixed(2),
      overallQuality: overallQuality.toFixed(2),
      tier,
    });

    return {
      transactionCount,
      timeSpan,
      categoryDiversity: uniqueCategories,
      consistencyScore,
      overallQuality,
      tier,
    };
  } catch (error) {
    console.error("[AdaptiveHistory] Lỗi:", error);
    return null;
  }
}

/**
 * Tính điểm nhất quán của chi tiêu
 * Dựa trên hệ số biến thiên (coefficient of variation)
 */
function calculateConsistency(
  transactions: any[],
  timeSpanMonths: number
): number {
  if (transactions.length < 2) return 0;

  // Nhóm theo tháng
  const monthlySpending = new Map<string, number>();

  transactions.forEach((txn) => {
    const month = new Date(txn.date * 1000).toISOString().substring(0, 7);
    monthlySpending.set(month, (monthlySpending.get(month) || 0) + txn.amount);
  });

  const values = Array.from(monthlySpending.values());

  if (values.length < 2) return 0;

  // Tính mean và standard deviation
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  // Coefficient of Variation (CV)
  const cv = mean > 0 ? stdDev / mean : 1;

  // Chuyển CV thành điểm 0-1 (CV thấp = nhất quán cao)
  // CV < 0.2 → 1.0 (rất nhất quán)
  // CV > 1.0 → 0.0 (rất không nhất quán)
  const consistencyScore = Math.max(0, Math.min(1, 1 - cv));

  return consistencyScore;
}

/**
 * Lấy dữ liệu lịch sử chi tiêu theo chất lượng
 * - Người mới (quality < 0.4): Lấy 1 tháng
 * - Đang phát triển (0.4 ≤ quality < 0.7): Lấy 2 tháng
 * - Đã ổn định (quality ≥ 0.7): Lấy 3 tháng
 */
export async function getAdaptiveHistoricalData(
  userId: string
): Promise<HistoricalAnalysisResult | null> {
  try {
    // Phát hiện chất lượng lịch sử
    const quality = await intelligentHistoryDetection(userId);

    if (!quality) {
      console.log("[AdaptiveHistory] Không có lịch sử chi tiêu");
      return null;
    }

    // Xác định số tháng cần lấy
    let monthsToFetch = 1;

    if (quality.tier === "established") {
      monthsToFetch = 3;
    } else if (quality.tier === "growing") {
      monthsToFetch = 2;
    }

    console.log(
      `[AdaptiveHistory] Lấy ${monthsToFetch} tháng dữ liệu (tier: ${quality.tier})`
    );

    // Lấy dữ liệu lịch sử
    const historicalData = await historicalAnalyzer.analyzeSpendingHistory(
      userId,
      monthsToFetch
    );

    return historicalData;
  } catch (error) {
    console.error("[AdaptiveHistory] Lỗi khi lấy dữ liệu:", error);
    return null;
  }
}

/**
 * Kiểm tra xem có đủ lịch sử để tạo gợi ý không
 * Yêu cầu tối thiểu:
 * - Ít nhất 5 giao dịch
 * - Ít nhất 2 tuần
 * - Ít nhất 2 danh mục
 */
export async function hasMinimumHistory(userId: string): Promise<boolean> {
  const quality = await intelligentHistoryDetection(userId);

  if (!quality) return false;

  const hasEnough =
    quality.transactionCount >= 5 &&
    quality.timeSpan >= 0.5 && // 0.5 tháng = ~2 tuần
    quality.categoryDiversity >= 2;

  console.log(`[AdaptiveHistory] Đủ lịch sử tối thiểu: ${hasEnough}`);

  return hasEnough;
}
