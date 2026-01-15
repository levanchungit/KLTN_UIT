import { listCategories } from "@/repos/categoryRepo";
import { lifestyleSignalModel } from "./lifestyleSignalModel";
import {
  budgetPredictionModel,
  type BudgetPrediction,
} from "./ml/budgetPredictionModel";
import { performanceMonitor } from "./performanceMonitor";

// ============ Types ============

export type LifestyleInput = {
  income: number; // Thu nhập tháng (VND)
  description: string; // Mô tả lối sống: "Sống Hà Nội, thuê trọ 10 triệu, ăn ngoài 2 lần/tuần"
  period: "daily" | "weekly" | "monthly";
  month?: number; // Tháng (1-12) để xét mùa cao điểm
};

export type CategoryAllocation = {
  categoryId: string;
  categoryName: string;
  categoryIcon?: string;
  categoryColor?: string;
  groupType: "needs" | "wants" | "savings";
  allocatedAmount: number;
  allocationReason: string; // Lý do AI chọn category này
  confidenceScore: number; // 0-1
};

export type BudgetAdviceResult = {
  // Phân bổ tổng quan
  totalIncome: number;
  needsAmount: number;
  wantsAmount: number;
  savingsAmount: number;

  // Breakdown chi tiết từng category
  categories: CategoryAllocation[];

  // Insights từ AI
  insights: string[];
  lifestyleAnalysis: string;

  // Explanation text (hiển thị ở đầu)
  explanationText?: string;

  // Metadata cho đánh giá
  metadata: {
    modelVersion: string;
    confidence: number; // Độ tin cậy của dự đoán (0-1)
    inferenceTimeMs: number; // Thời gian inference (cho báo cáo)
    lifestyleSignals: any; // Tín hiệu lối sống đã trích xuất
    neuralNetworkPrediction: BudgetPrediction;
  };
};

// ============ Helper Functions ============

/**
 * Làm tròn số tiền thông minh
 * - < 500k: làm tròn đến 50k
 * - 500k - 2M: làm tròn đến 100k
 * - 2M - 5M: làm tròn đến 250k
 * - >= 5M: làm tròn đến 500k
 */
function smartRound(amount: number, isExplicit: boolean = false): number {
  // Giữ nguyên số tiền explicit từ user
  if (isExplicit) return amount;

  if (amount < 500_000) {
    // Làm tròn đến 50k
    return Math.round(amount / 50_000) * 50_000;
  } else if (amount < 2_000_000) {
    // Làm tròn đến 100k
    return Math.round(amount / 100_000) * 100_000;
  } else if (amount < 5_000_000) {
    // Làm tròn đến 250k
    return Math.round(amount / 250_000) * 250_000;
  } else {
    // Làm tròn đến 500k
    return Math.round(amount / 500_000) * 500_000;
  }
}

/**
 * Parse explicit amounts từ description
 * VD: "thuê nhà 10 triệu" -> { rent: 10000000 }
 */
function parseExplicitAmounts(text: string): Record<string, number> {
  const amounts: Record<string, number> = {};
  const lowerText = text.toLowerCase();

  // Pattern: "thuê nhà/trọ X triệu/tr"
  const rentMatch = lowerText.match(
    /(thuê|trọ|nhà trọ)\s*(\d+(?:[.,]\d+)?)\s*(triệu|tr|m)/i
  );
  if (rentMatch) {
    const value = parseFloat(rentMatch[2].replace(",", "."));
    amounts.rent = value * 1_000_000;
  }

  // Pattern: "ăn X mỗi ngày/tháng"
  const foodMatch = lowerText.match(
    /ăn\s*(?:uống)?\s*(\d+(?:[.,]\d+)?)\s*(k|ngàn|triệu|tr)?\s*(?:mỗi)?\s*(ngày|tháng)?/i
  );
  if (foodMatch) {
    let value = parseFloat(foodMatch[1].replace(",", "."));
    const unit = foodMatch[2]?.toLowerCase();
    const period = foodMatch[3]?.toLowerCase();

    if (unit === "triệu" || unit === "tr") value *= 1_000_000;
    else if (unit === "k" || unit === "ngàn") value *= 1_000;

    if (period === "ngày") value *= 30; // Convert daily to monthly

    amounts.food = value;
  }

  // Pattern: "du lịch X triệu/tháng"
  const travelMatch = lowerText.match(
    /du\s*lịch\s*(\d+(?:[.,]\d+)?)\s*(k|ngàn|triệu|tr)?\s*(?:\/|mỗi)?\s*tháng?/i
  );
  if (travelMatch) {
    let value = parseFloat(travelMatch[1].replace(",", "."));
    const unit = travelMatch[2]?.toLowerCase();

    if (unit === "triệu" || unit === "tr") value *= 1_000_000;
    else if (unit === "k" || unit === "ngàn") value *= 1_000;

    amounts.travel = value;
  }

  return amounts;
}

/**
 * Classify category vào group (needs/wants/savings)
 * Dựa trên lifestyle signals và category name
 */
function classifyCategory(
  categoryName: string,
  lifestyleSignals: any,
  explicitAmounts: Record<string, number>
): "needs" | "wants" | "savings" {
  const lower = categoryName.toLowerCase();

  // Savings categories
  if (
    lower.includes("tiết kiệm") ||
    lower.includes("đầu tư") ||
    lower.includes("trả nợ") ||
    lower.includes("khẩn cấp")
  ) {
    return "savings";
  }

  // Needs categories (essential)
  const needsKeywords = [
    "thức ăn",
    "đồ uống",
    "thuê nhà",
    "tiền nhà",
    "nhà", // House/rent is needs!
    "điện nước",
    "y tế",
    "sức khỏe",
    "giao thông",
    "di chuyển",
    "giáo dục",
    "học tập",
  ];

  if (needsKeywords.some((kw) => lower.includes(kw))) {
    return "needs";
  }

  // Wants categories (discretionary)
  const wantsKeywords = [
    "mua sắm",
    "du lịch",
    "giải trí",
    "café",
    "thể thao",
    "làm đẹp",
    "quần áo",
    "phụ kiện",
    "điện tử",
    "game",
  ];

  if (wantsKeywords.some((kw) => lower.includes(kw))) {
    return "wants";
  }

  // Default: classify based on lifestyle signals
  if (lifestyleSignals.minimalLiving) {
    return lower.includes("ăn") || lower.includes("thuê") ? "needs" : "wants";
  }

  return "wants"; // Default
}

/**
 * Calculate category priority score
 * Dựa trên lifestyle signals, user có ưu tiên category này không?
 */
function calculateCategoryPriority(
  categoryName: string,
  lifestyleSignals: any,
  explicitAmounts: Record<string, number>
): number {
  const lower = categoryName.toLowerCase();
  let score = 0.5; // Base score

  // Rent priority
  if (
    (lower.includes("thuê") || lower.includes("nhà")) &&
    lifestyleSignals.hasRent
  ) {
    score = 0.9;
  }

  // Food priority
  if (lower.includes("thức ăn") || lower.includes("đồ uống")) {
    if (lifestyleSignals.foodOutFrequency === "high") score = 0.8;
    else if (lifestyleSignals.foodOutFrequency === "medium") score = 0.6;
    else score = 0.4;
  }

  // Shopping/Luxury
  if (lower.includes("mua sắm") || lower.includes("làm đẹp")) {
    if (lifestyleSignals.luxuryInterest === "high") score = 0.7;
    else if (lifestyleSignals.luxuryInterest === "medium") score = 0.5;
    else score = 0.2;
  }

  // Travel
  if (lower.includes("du lịch")) {
    if (lifestyleSignals.socialSpending === "high") score = 0.7;
    else score = 0.3;
  }

  // Entertainment
  if (lower.includes("giải trí") || lower.includes("café")) {
    if (lifestyleSignals.socialSpending === "high") score = 0.7;
    else if (lifestyleSignals.socialSpending === "medium") score = 0.5;
    else score = 0.3;
  }

  // Savings
  if (lower.includes("tiết kiệm") && lifestyleSignals.hasSavingsGoal) {
    score = 0.95;
  }

  // Debt repayment
  if (lower.includes("trả nợ") && lifestyleSignals.hasDebt) {
    score = 1.0; // Highest priority
  }

  return score;
}

// ============ Main Service ============

/**
 * AI Budget Advisor - Hàm chính
 *
 * @param input - Thu nhập và mô tả lối sống
 * @returns Gợi ý ngân sách chi tiết với AI insights
 */
export async function generateAIBudgetAdvice(
  input: LifestyleInput
): Promise<BudgetAdviceResult> {
  const startTime = Date.now();

  // Log performance
  performanceMonitor.startOperation("ai_budget_advice");

  try {
    console.log("[AIBudgetAdvisor] Starting advice generation...");
    console.log("[AIBudgetAdvisor] Income:", input.income);
    console.log("[AIBudgetAdvisor] Description:", input.description);

    // Step 1: Trích xuất lifestyle signals bằng Neural Network
    performanceMonitor.startOperation("lifestyle_extraction");
    const lifestyleSignals = await lifestyleSignalModel.infer(
      input.description
    );
    performanceMonitor.endOperation("lifestyle_extraction");
    console.log(
      "[AIBudgetAdvisor] Lifestyle signals extracted:",
      lifestyleSignals
    );

    // Step 2: Parse explicit amounts
    const explicitAmounts = parseExplicitAmounts(input.description);
    console.log("[AIBudgetAdvisor] Explicit amounts:", explicitAmounts);

    // Step 3: Dự đoán phân bổ ngân sách bằng Budget Prediction Neural Network
    performanceMonitor.startOperation("budget_prediction");
    const currentMonth = input.month || new Date().getMonth() + 1;
    const isHolidaySeason = [1, 2, 4, 9, 12].includes(currentMonth);

    // Convert lifestyle signals to 16-dim array
    const lifestyleArray = [
      lifestyleSignals.hasRent ? 1 : 0,
      lifestyleSignals.hasDebt ? 1 : 0,
      lifestyleSignals.hasSavingsGoal ? 1 : 0,
      lifestyleSignals.minimalLiving ? 1 : 0,
      lifestyleSignals.foodOutFrequency === "low" ? 1 : 0,
      lifestyleSignals.foodOutFrequency === "medium" ? 1 : 0,
      lifestyleSignals.foodOutFrequency === "high" ? 1 : 0,
      lifestyleSignals.socialSpending === "low" ? 1 : 0,
      lifestyleSignals.socialSpending === "medium" ? 1 : 0,
      lifestyleSignals.socialSpending === "high" ? 1 : 0,
      lifestyleSignals.luxuryInterest === "low" ? 1 : 0,
      lifestyleSignals.luxuryInterest === "medium" ? 1 : 0,
      lifestyleSignals.luxuryInterest === "high" ? 1 : 0,
      lifestyleSignals.location === "hanoi" ? 1 : 0,
      lifestyleSignals.location === "hcm" ? 1 : 0,
      lifestyleSignals.location === "other" ? 1 : 0,
    ];

    const prediction = await budgetPredictionModel.predict(
      input.income,
      lifestyleArray,
      currentMonth,
      isHolidaySeason
    );
    performanceMonitor.endOperation("budget_prediction");

    console.log("[AIBudgetAdvisor] Neural network prediction:", prediction);

    // Check if user wants EXACT 50/30/20 rule (no AI adjustment)
    const forceExact503020 =
      input.description.includes("CHÍNH XÁC quy tắc 50/30/20") ||
      input.description.includes("áp dụng đúng 50/30/20");

    // Override prediction if user wants exact rule
    let finalPrediction = prediction;
    if (forceExact503020) {
      finalPrediction = {
        needsRatio: 0.5,
        wantsRatio: 0.3,
        savingsRatio: 0.2,
        confidence: 1.0,
        modelVersion: "exact_50_30_20",
        inferenceTimeMs: 0,
      };
      console.log("[AIBudgetAdvisor] Using EXACT 50/30/20 rule (forced)");
    }

    // Step 4: Tính toán amounts cho 3 groups với explicit amounts
    // Tính tổng explicit amounts
    const totalExplicitAmounts =
      (explicitAmounts.rent || 0) +
      (explicitAmounts.food || 0) +
      (explicitAmounts.travel || 0);

    // Ngân sách còn lại sau khi trừ explicit amounts
    const remainingBudget = Math.max(input.income - totalExplicitAmounts, 0);

    // Dùng AI prediction ratio để phân phối ngân sách còn lại
    let needsAmount = Math.round(remainingBudget * finalPrediction.needsRatio);
    let wantsAmount = Math.round(remainingBudget * finalPrediction.wantsRatio);
    let savingsAmount = Math.round(
      remainingBudget * finalPrediction.savingsRatio
    );

    // Thêm explicit amounts vào từng group
    needsAmount += (explicitAmounts.rent || 0) + (explicitAmounts.food || 0);
    wantsAmount += explicitAmounts.travel || 0;

    // Ensure non-negative
    needsAmount = Math.max(needsAmount, 0);
    wantsAmount = Math.max(wantsAmount, 0);
    savingsAmount = Math.max(savingsAmount, 0);

    // Re-normalize to exact income
    const total = needsAmount + wantsAmount + savingsAmount;
    if (total !== input.income) {
      const diff = input.income - total;
      savingsAmount += diff; // Adjust savings
    }

    // Step 5: Phân bổ vào categories cụ thể
    performanceMonitor.startOperation("category_allocation");
    const allCategories = await listCategories();
    const categoryAllocations: CategoryAllocation[] = [];

    // Classify categories
    const needsCategories: any[] = [];
    const wantsCategories: any[] = [];
    const savingsCategories: any[] = [];

    allCategories.forEach((cat: any) => {
      const lowerName = cat.name.toLowerCase();

      // Filter out invalid expense categories (income categories)
      if (
        lowerName.includes("lương") ||
        lowerName.includes("thưởng") ||
        lowerName.includes("thu nhập") ||
        cat.type === "income"
      ) {
        return; // Skip income categories
      }

      const group = classifyCategory(
        cat.name,
        lifestyleSignals,
        explicitAmounts
      );
      const priority = calculateCategoryPriority(
        cat.name,
        lifestyleSignals,
        explicitAmounts
      );

      const catWithScore = { ...cat, priority };

      if (group === "needs") needsCategories.push(catWithScore);
      else if (group === "wants") wantsCategories.push(catWithScore);
      else savingsCategories.push(catWithScore);
    });

    // Sort by priority
    needsCategories.sort((a, b) => b.priority - a.priority);
    wantsCategories.sort((a, b) => b.priority - a.priority);
    savingsCategories.sort((a, b) => b.priority - a.priority);

    // Allocate needs
    const topNeeds = needsCategories.slice(0, 5); // Top 5 categories

    // Calculate explicit amounts total and remaining budget
    let explicitNeedsTotal = 0;
    const explicitNeedsMap = new Map<string, number>();

    topNeeds.forEach((cat) => {
      const catNameLower = cat.name.toLowerCase();

      // Check for rent/house categories
      if (
        (catNameLower.includes("thuê") ||
          catNameLower.includes("nhà") ||
          catNameLower.includes("nhà ở") ||
          catNameLower.includes("nhà cửa")) &&
        explicitAmounts.rent
      ) {
        explicitNeedsMap.set(cat.id, explicitAmounts.rent);
        explicitNeedsTotal += explicitAmounts.rent;
      } else if (
        (catNameLower.includes("thức ăn") ||
          catNameLower.includes("ăn uống")) &&
        explicitAmounts.food
      ) {
        explicitNeedsMap.set(cat.id, explicitAmounts.food);
        explicitNeedsTotal += explicitAmounts.food;
      }
    });

    // Remaining budget for non-explicit categories
    const remainingNeedsBudget = Math.max(needsAmount - explicitNeedsTotal, 0);
    const nonExplicitNeeds = topNeeds.filter(
      (cat) => !explicitNeedsMap.has(cat.id)
    );
    const totalNonExplicitPriority = nonExplicitNeeds.reduce(
      (sum, c) => sum + c.priority,
      0
    );

    topNeeds.forEach((cat) => {
      let finalAmount: number;
      const isExplicit = explicitNeedsMap.has(cat.id);

      // Use explicit amount if exists
      if (isExplicit) {
        finalAmount = explicitNeedsMap.get(cat.id)!;
      } else {
        // Distribute remaining budget by priority
        const rawAmount =
          totalNonExplicitPriority > 0
            ? (remainingNeedsBudget * cat.priority) / totalNonExplicitPriority
            : 0;
        finalAmount = smartRound(rawAmount, false);
      }

      categoryAllocations.push({
        categoryId: cat.id,
        categoryName: cat.name,
        categoryIcon: cat.icon,
        categoryColor: cat.color,
        groupType: "needs",
        allocatedAmount: finalAmount,
        allocationReason: `Ưu tiên thiết yếu (mức độ: ${(
          cat.priority * 100
        ).toFixed(0)}%)`,
        confidenceScore: cat.priority,
      });
    });

    // Allocate wants
    const topWants = wantsCategories.slice(0, 4);

    // Calculate explicit amounts total and remaining budget
    let explicitWantsTotal = 0;
    const explicitWantsMap = new Map<string, number>();

    topWants.forEach((cat) => {
      const catNameLower = cat.name.toLowerCase();

      // Check for travel/entertainment categories
      if (
        (catNameLower.includes("du lịch") ||
          catNameLower.includes("giải trí") ||
          catNameLower.includes("entertainment")) &&
        explicitAmounts.travel
      ) {
        explicitWantsMap.set(cat.id, explicitAmounts.travel);
        explicitWantsTotal += explicitAmounts.travel;
      }
    });

    // Remaining budget for non-explicit categories
    const remainingWantsBudget = Math.max(wantsAmount - explicitWantsTotal, 0);
    const nonExplicitWants = topWants.filter(
      (cat) => !explicitWantsMap.has(cat.id)
    );
    const totalNonExplicitWantsPriority = nonExplicitWants.reduce(
      (sum, c) => sum + c.priority,
      0
    );

    topWants.forEach((cat) => {
      let amount: number;
      const isExplicit = explicitWantsMap.has(cat.id);

      // Use explicit amount if exists
      if (isExplicit) {
        amount = explicitWantsMap.get(cat.id)!;
      } else {
        // Distribute remaining budget by priority
        const rawAmount =
          totalNonExplicitWantsPriority > 0
            ? (remainingWantsBudget * cat.priority) /
              totalNonExplicitWantsPriority
            : 0;
        amount = smartRound(rawAmount, false);
      }

      categoryAllocations.push({
        categoryId: cat.id,
        categoryName: cat.name,
        categoryIcon: cat.icon,
        categoryColor: cat.color,
        groupType: "wants",
        allocatedAmount: amount,
        allocationReason: `Mong muốn cá nhân (mức độ: ${(
          cat.priority * 100
        ).toFixed(0)}%)`,
        confidenceScore: cat.priority,
      });
    });

    // Allocate savings
    const topSavings = savingsCategories.slice(0, 2);
    const totalSavingsPriority = topSavings.reduce(
      (sum, c) => sum + c.priority,
      0
    );

    if (topSavings.length > 0) {
      topSavings.forEach((cat) => {
        const rawAmount = (savingsAmount * cat.priority) / totalSavingsPriority;
        const amount = smartRound(rawAmount, false);
        categoryAllocations.push({
          categoryId: cat.id,
          categoryName: cat.name,
          categoryIcon: cat.icon,
          categoryColor: cat.color,
          groupType: "savings",
          allocatedAmount: amount,
          allocationReason: `Tiết kiệm/Đầu tư (mức độ: ${(
            cat.priority * 100
          ).toFixed(0)}%)`,
          confidenceScore: cat.priority,
        });
      });
    } else {
      // Create a generic savings category
      const roundedSavings = smartRound(savingsAmount, false);
      categoryAllocations.push({
        categoryId: "savings_default",
        categoryName: "Tiết kiệm / Trả nợ",
        categoryIcon: "piggy-bank",
        categoryColor: "#4CAF50",
        groupType: "savings",
        allocatedAmount: roundedSavings,
        allocationReason: "Quỹ tiết kiệm khẩn cấp hoặc trả nợ",
        confidenceScore: 0.8,
      });
    }

    performanceMonitor.endOperation("category_allocation");

    // Step 5.5: Rebalance each group to match target amounts after rounding
    // This ensures exact 50/30/20 ratio is preserved
    const needsCats = categoryAllocations.filter(
      (c) => c.groupType === "needs"
    );
    const wantsCats = categoryAllocations.filter(
      (c) => c.groupType === "wants"
    );
    const savingsCats = categoryAllocations.filter(
      (c) => c.groupType === "savings"
    );

    // Calculate current totals
    const currentNeedsTotal = needsCats.reduce(
      (s, c) => s + c.allocatedAmount,
      0
    );
    const currentWantsTotal = wantsCats.reduce(
      (s, c) => s + c.allocatedAmount,
      0
    );
    const currentSavingsTotal = savingsCats.reduce(
      (s, c) => s + c.allocatedAmount,
      0
    );

    // Adjust each group to match target
    if (needsCats.length > 0) {
      const needsDiff = needsAmount - currentNeedsTotal;
      needsCats[needsCats.length - 1].allocatedAmount += needsDiff;
      needsCats[needsCats.length - 1].allocatedAmount = Math.max(
        0,
        needsCats[needsCats.length - 1].allocatedAmount
      );
    }

    if (wantsCats.length > 0) {
      const wantsDiff = wantsAmount - currentWantsTotal;
      wantsCats[wantsCats.length - 1].allocatedAmount += wantsDiff;
      wantsCats[wantsCats.length - 1].allocatedAmount = Math.max(
        0,
        wantsCats[wantsCats.length - 1].allocatedAmount
      );
    }

    if (savingsCats.length > 0) {
      const savingsDiff = savingsAmount - currentSavingsTotal;
      savingsCats[savingsCats.length - 1].allocatedAmount += savingsDiff;
      savingsCats[savingsCats.length - 1].allocatedAmount = Math.max(
        0,
        savingsCats[savingsCats.length - 1].allocatedAmount
      );
    }

    // Step 5.6: Final rebalance to ensure total = income
    const totalAllocated = categoryAllocations.reduce(
      (sum, cat) => sum + cat.allocatedAmount,
      0
    );
    const difference = input.income - totalAllocated;

    if (difference !== 0 && savingsCats.length > 0) {
      // Adjust savings to absorb any remaining difference
      savingsCats[0].allocatedAmount += difference;
      savingsCats[0].allocatedAmount = Math.max(
        0,
        savingsCats[0].allocatedAmount
      );
    }

    // Recalculate group totals after final adjustments
    const finalNeedsAmount = categoryAllocations
      .filter((c) => c.groupType === "needs")
      .reduce((sum, c) => sum + c.allocatedAmount, 0);
    const finalWantsAmount = categoryAllocations
      .filter((c) => c.groupType === "wants")
      .reduce((sum, c) => sum + c.allocatedAmount, 0);
    const finalSavingsAmount = categoryAllocations
      .filter((c) => c.groupType === "savings")
      .reduce((sum, c) => sum + c.allocatedAmount, 0);

    // Step 6: Create explanation text
    // Always use 50/30/20 rule as the foundation
    const standardNeedsAmount = Math.round(input.income * 0.5); // 50%
    const standardWantsAmount = Math.round(input.income * 0.3); // 30%
    const standardSavingsAmount = Math.round(input.income * 0.2); // 20%

    // Calculate actual percentages after allocation
    const actualNeedsPct = Math.round((finalNeedsAmount / input.income) * 100);
    const actualWantsPct = Math.round((finalWantsAmount / input.income) * 100);
    const actualSavingsPct = Math.round(
      (finalSavingsAmount / input.income) * 100
    );

    let explanationText = `Áp dụng quy tắc 50/30/20: mục tiêu ban đầu là Nhu cầu 50% (${standardNeedsAmount.toLocaleString(
      "vi-VN"
    )}đ), Mong muốn 30% (${standardWantsAmount.toLocaleString(
      "vi-VN"
    )}đ), Tiết kiệm 20% (${standardSavingsAmount.toLocaleString("vi-VN")}đ).`;
    // Add explanation for explicit amounts if they exist
    if (totalExplicitAmounts > 0) {
      const explicitNeedsTotal =
        (explicitAmounts.rent || 0) + (explicitAmounts.food || 0);
      const explicitWantsTotal = explicitAmounts.travel || 0;

      // Build explanation about explicit amounts with proper categorization
      const needsItems: string[] = [];
      const wantsItems: string[] = [];

      if (explicitAmounts.rent)
        needsItems.push(
          `${(explicitAmounts.rent / 1_000_000).toFixed(1)}tr thuê nhà`
        );
      if (explicitAmounts.food)
        needsItems.push(
          `${(explicitAmounts.food / 1_000_000).toFixed(1)}tr ăn uống`
        );
      if (explicitAmounts.travel)
        wantsItems.push(
          `${(explicitAmounts.travel / 1_000_000).toFixed(1)}tr du lịch`
        );

      if (needsItems.length > 0) {
        explanationText += ` Tuy nhiên bạn đang chi ${needsItems.join(
          " + "
        )} (nhu cầu thiết yếu) = ${(explicitNeedsTotal / 1_000_000).toFixed(
          1
        )}tr`;

        if (explicitNeedsTotal > standardNeedsAmount) {
          explanationText += ` — vượt mức chuẩn 50/30/20 (${(
            standardNeedsAmount / 1_000_000
          ).toFixed(1)}tr)`;
        }
      }

      if (wantsItems.length > 0) {
        if (needsItems.length > 0) {
          explanationText += `, thêm ${wantsItems.join(" + ")} (mong muốn)`;
        } else {
          explanationText += ` Tuy nhiên bạn đang chi ${wantsItems.join(
            " + "
          )} (mong muốn)`;
        }
      }

      const remainingBudget = input.income - totalExplicitAmounts;
      explanationText += `. Số tiền còn lại ${(
        remainingBudget / 1_000_000
      ).toFixed(1)}tr được AI phân bổ tự động.`;

      // Explain the actual allocation result
      explanationText += ` Kết quả: Needs ${actualNeedsPct}% (${finalNeedsAmount.toLocaleString(
        "vi-VN"
      )}đ), Wants ${actualWantsPct}% (${finalWantsAmount.toLocaleString(
        "vi-VN"
      )}đ), Savings ${actualSavingsPct}% (${finalSavingsAmount.toLocaleString(
        "vi-VN"
      )}đ).`;

      // Add suggestions based on actual results
      const suggestions: string[] = [];
      if (finalSavingsAmount < standardSavingsAmount * 0.5) {
        const savingsDrop = Math.round(
          ((standardSavingsAmount - finalSavingsAmount) /
            standardSavingsAmount) *
            100
        );
        suggestions.push(
          `quỹ tiết kiệm giảm ${savingsDrop}% (còn ${(
            finalSavingsAmount / 1_000_000
          ).toFixed(1)}tr)`
        );
      }

      if (finalWantsAmount < standardWantsAmount * 0.7) {
        suggestions.push(
          `chi tiêu mong muốn bị thu hẹp còn ${(
            finalWantsAmount / 1_000_000
          ).toFixed(1)}tr`
        );
      }

      if (suggestions.length > 0) {
        explanationText += ` Lưu ý: ${suggestions.join(
          ", "
        )}. Hãy xem xét cắt giảm chi tiêu không thiết yếu hoặc tăng thu nhập để cân bằng.`;
      }
    }

    // Step 7: Generate AI insights
    const insights: string[] = [];

    // Count explicit amounts used
    const explicitCount = Object.keys(explicitAmounts).filter(
      (key) => explicitAmounts[key as keyof typeof explicitAmounts] > 0
    ).length;

    // Insight 1: Budget ratio - always mention 50/30/20 rule
    if (explicitCount > 0) {
      insights.push(
        `Dựa trên quy tắc 50/30/20 - Sử dụng ${explicitCount} số liệu cụ thể từ bạn để tùy chỉnh phân bổ`
      );
    } else {
      insights.push(
        `Áp dụng quy tắc 50/30/20: 50% nhu cầu thiết yếu, 30% mong muốn, 20% tiết kiệm`
      );
    }

    // Insight 2: Lifestyle-specific with explicit amounts
    if (explicitAmounts.rent) {
      insights.push(
        `✓ Thuê nhà: ${explicitAmounts.rent.toLocaleString(
          "vi-VN"
        )}đ/tháng - Đúng theo thông tin bạn cung cấp`
      );
    } else if (lifestyleSignals.hasRent) {
      insights.push(
        `Phát hiện chi phí thuê nhà - ưu tiên 20-30% ngân sách cho nhu cầu thiết yếu`
      );
    }

    if (explicitAmounts.food) {
      insights.push(
        `✓ Ăn uống: ${explicitAmounts.food.toLocaleString(
          "vi-VN"
        )}đ/tháng - Đúng theo thông tin bạn cung cấp`
      );
    } else if (lifestyleSignals.foodOutFrequency === "high") {
      insights.push(
        "Bạn hay ăn ngoài - đề xuất cắt giảm 15-20% để tăng quỹ tiết kiệm"
      );
    }

    if (explicitAmounts.travel) {
      insights.push(
        `✓ Du lịch: ${explicitAmounts.travel.toLocaleString(
          "vi-VN"
        )}đ/tháng - Đúng theo thông tin bạn cung cấp`
      );
    }

    if (lifestyleSignals.hasSavingsGoal) {
      insights.push(
        `Mục tiêu tiết kiệm: dành ${savingsAmount.toLocaleString(
          "vi-VN"
        )}đ/tháng để đạt mục tiêu`
      );
    }

    if (lifestyleSignals.hasDebt) {
      insights.push(
        "Ưu tiên trả nợ - giảm chi tiêu mong muốn để tăng tốc độ trả nợ"
      );
    }

    // Insight 3: Holiday season
    if (isHolidaySeason) {
      insights.push(
        `Tháng ${currentMonth} là mùa cao điểm - AI điều chỉnh tăng 5% cho mong muốn`
      );
    }

    // Insight 4: Confidence (based on lifestyle signals + explicit data)
    const numSignals = lifestyleArray.filter((v) => v === 1).length;
    const numExplicit = Object.keys(explicitAmounts).length;
    const totalInfo = numSignals + numExplicit * 2; // Explicit data worth 2x
    const maxInfo = 16 + 6; // Max signals + max explicit amounts
    const adjustedConfidence = Math.min(totalInfo / maxInfo, 1);
    const confidencePct = (adjustedConfidence * 100).toFixed(0);

    insights.push(
      `Độ tin cậy: ${confidencePct}% (dựa trên ${numSignals} tín hiệu lối sống${
        numExplicit > 0 ? ` + ${numExplicit} số liệu cụ thể` : ""
      })`
    );

    // Lifestyle analysis summary with explicit amounts
    const locationText =
      lifestyleSignals.location === "hanoi"
        ? "Hà Nội"
        : lifestyleSignals.location === "hcm"
        ? "TP.HCM"
        : "Tỉnh thành khác";

    const explicitTexts: string[] = [];
    if (explicitAmounts.rent)
      explicitTexts.push(
        `thuê ${(explicitAmounts.rent / 1_000_000).toFixed(0)}tr/tháng`
      );
    if (explicitAmounts.food)
      explicitTexts.push(
        `ăn uống ${(explicitAmounts.food / 1_000_000).toFixed(0)}tr/tháng`
      );
    if (explicitAmounts.travel)
      explicitTexts.push(
        `du lịch ${(explicitAmounts.travel / 1_000_000).toFixed(0)}tr/tháng`
      );

    const lifestyleAnalysis = `Phân tích lối sống: ${locationText}${
      explicitTexts.length > 0 ? `, ${explicitTexts.join(", ")}` : ""
    }${
      lifestyleSignals.foodOutFrequency === "high"
        ? ", ăn ngoài thường xuyên"
        : ""
    }${
      lifestyleSignals.socialSpending === "high" ? ", chi tiêu xã hội cao" : ""
    }${lifestyleSignals.hasSavingsGoal ? ", có mục tiêu tiết kiệm" : ""}${
      lifestyleSignals.minimalLiving ? ", lối sống tối giản" : ""
    }.`;

    const totalTime = Date.now() - startTime;
    performanceMonitor.endOperation("ai_budget_advice");

    console.log(`[AIBudgetAdvisor] Completed in ${totalTime}ms`);

    return {
      totalIncome: input.income,
      needsAmount: finalNeedsAmount,
      wantsAmount: finalWantsAmount,
      savingsAmount: finalSavingsAmount,
      categories: categoryAllocations,
      insights,
      lifestyleAnalysis,
      explanationText,
      metadata: {
        modelVersion: prediction.modelVersion,
        confidence: prediction.confidence,
        inferenceTimeMs: totalTime,
        lifestyleSignals,
        neuralNetworkPrediction: prediction,
      },
    };
  } catch (error) {
    performanceMonitor.endOperation("ai_budget_advice");
    console.error("[AIBudgetAdvisor] Error:", error);
    throw error;
  }
}

/**
 * Learn from user corrections (incremental learning)
 */
export async function learnFromUserFeedback(
  income: number,
  lifestyleDescription: string,
  userAdjustedRatios: { needs: number; wants: number; savings: number }
): Promise<void> {
  console.log("[AIBudgetAdvisor] Learning from user feedback...");

  // Extract lifestyle signals
  const lifestyleSignals = await lifestyleSignalModel.infer(
    lifestyleDescription
  );

  // Convert to array
  const lifestyleArray = [
    lifestyleSignals.hasRent ? 1 : 0,
    lifestyleSignals.hasDebt ? 1 : 0,
    lifestyleSignals.hasSavingsGoal ? 1 : 0,
    lifestyleSignals.minimalLiving ? 1 : 0,
    lifestyleSignals.foodOutFrequency === "low" ? 1 : 0,
    lifestyleSignals.foodOutFrequency === "medium" ? 1 : 0,
    lifestyleSignals.foodOutFrequency === "high" ? 1 : 0,
    lifestyleSignals.socialSpending === "low" ? 1 : 0,
    lifestyleSignals.socialSpending === "medium" ? 1 : 0,
    lifestyleSignals.socialSpending === "high" ? 1 : 0,
    lifestyleSignals.luxuryInterest === "low" ? 1 : 0,
    lifestyleSignals.luxuryInterest === "medium" ? 1 : 0,
    lifestyleSignals.luxuryInterest === "high" ? 1 : 0,
    lifestyleSignals.location === "hanoi" ? 1 : 0,
    lifestyleSignals.location === "hcm" ? 1 : 0,
    lifestyleSignals.location === "other" ? 1 : 0,
  ];

  // Normalize ratios
  const total =
    userAdjustedRatios.needs +
    userAdjustedRatios.wants +
    userAdjustedRatios.savings;
  const normalizedRatios: [number, number, number] = [
    userAdjustedRatios.needs / total,
    userAdjustedRatios.wants / total,
    userAdjustedRatios.savings / total,
  ];

  // Fine-tune model
  await budgetPredictionModel.learnFromCorrection({
    income,
    lifestyleSignals: lifestyleArray,
    targetRatios: normalizedRatios,
    month: new Date().getMonth() + 1,
    isHolidaySeason: [1, 2, 4, 9, 12].includes(new Date().getMonth() + 1),
  });

  console.log("[AIBudgetAdvisor] Model updated with user feedback");
}
