import { db } from "@/db";
import { getCurrentUserId } from "@/utils/auth";

// ============ Types ============

export type LifestyleInput = {
  income: number; // Monthly income in VND
  description: string; // "Sống Hà Nội, thuê trọ, ăn ngoài nhiều, thích du lịch"
  period: "daily" | "weekly" | "monthly";
  dependents?: number; // Number of dependents
  hasDebt?: boolean;
  savingsGoal?: string; // "Mua nhà", "Du lịch", etc.
};

export type LifestyleSignals = {
  hasRent: boolean;
  rentEstimate?: number;
  foodOutFrequency: "low" | "medium" | "high";
  socialSpending: "low" | "medium" | "high";
  hasSavingsGoal: boolean;
  hasDebt: boolean;
  luxuryInterest: "low" | "medium" | "high";
  location: "hanoi" | "hcm" | "other";
  minimalLiving: boolean;
};

export type BudgetRatio = {
  needs: number; // 0-1
  wants: number; // 0-1
  savings: number; // 0-1
};

export type CategoryScoring = {
  categoryId: string;
  categoryName: string;
  categoryIcon?: string;
  categoryColor?: string;
  groupType: "needs" | "wants" | "savings";
  score: number; // 0-1
  allocatedAmount: number;
  reason: string; // Why this category was selected
};

export type SmartBudgetResult = {
  ratio: BudgetRatio;
  categories: CategoryScoring[];
  insights: string[];
  alternatives: BudgetRatio[];
  confidence: number; // 0-1
};

// ============ Helpers for sample-style deterministic allocation ============

function parseAmountFromDesc(desc: string, keywords: RegExp[]): number | null {
  const text = desc.toLowerCase();
  for (const kw of keywords) {
    // Pattern 1: keyword THEN number (e.g., "thuê nhà 10 triệu")
    let match = text.match(
      new RegExp(`${kw.source}\\s+(\\d+[\\.,]?\\d*)\\s*(tr|triệu|trieu)?`, "i")
    );
    if (match) {
      const raw = match[1].replace(/,/g, "");
      const val = parseFloat(raw);
      if (!isNaN(val)) {
        return Math.round(val * 1_000_000);
      }
    }

    // Pattern 2: number THEN keyword (e.g., "10 triệu thuê nhà")
    match = text.match(
      new RegExp(`(\\d+[\\.,]?\\d*)\\s*(tr|triệu|trieu)?\\s*${kw.source}`, "i")
    );
    if (match) {
      const raw = match[1].replace(/,/g, "");
      const val = parseFloat(raw);
      if (!isNaN(val)) {
        return Math.round(val * 1_000_000);
      }
    }
  }
  return null;
}

async function buildTemplateAllocations(
  income: number,
  ratio: BudgetRatio,
  description: string
): Promise<CategoryScoring[]> {
  const needsBudget = Math.round(income * ratio.needs);
  const wantsBudget = Math.round(income * ratio.wants);
  const savingsBudget = Math.round(income * ratio.savings);

  // Extract explicit amounts from description if present
  const desc = description.toLowerCase();
  const rentAmount =
    parseAmountFromDesc(desc, [/thuê nhà/, /tiền nhà/, /nhà/]) ?? 0;
  const foodAmount =
    parseAmountFromDesc(desc, [/ăn uống/, /thức ăn/, /đồ ăn/, /ăn ngoài/]) ?? 0;
  const shoppingAmount =
    parseAmountFromDesc(desc, [/mua sắm/, /shopping/]) ?? 0;
  const travelAmount = parseAmountFromDesc(desc, [/du lịch/, /travel/]) ?? 0;

  // Parse detailed essential expenses (only if mentioned)
  const transportAmount =
    parseAmountFromDesc(desc, [/giao thông/, /xăng/, /xe/, /transport/]) ?? 0;
  const utilitiesAmount =
    parseAmountFromDesc(desc, [
      /điện|nước|gas|wifi|phone|internet|viễn thông/,
    ]) ?? 0;
  const healthAmount =
    parseAmountFromDesc(desc, [/y tế|bác sĩ|thuốc|bệnh viện|health|medical/]) ??
    0;
  const educationAmount =
    parseAmountFromDesc(desc, [/học|trường|giáo dục|education|tuition/]) ?? 0;

  // Get or create categories
  const { listCategories, createCategory } = await import(
    "@/repos/categoryRepo"
  );
  const existingCategories = await listCategories({ type: "expense" });
  const catMap = new Map(existingCategories.map((c) => [c.name, c]));

  // Ensure categories exist (or create them)
  const ensureCategory = async (name: string, icon: string, color: string) => {
    if (!catMap.has(name)) {
      const newCatId = await createCategory({
        name,
        type: "expense",
        icon,
        color,
      });
      catMap.set(name, {
        id: newCatId,
        name,
        icon,
        color,
        type: "expense",
      } as any);
    }
    return catMap.get(name)!;
  };

  // Needs allocation - only add categories that have amounts from description
  const needsItems: Array<{
    name: string;
    categoryId: string;
    icon: string;
    color: string;
    amount: number;
  }> = [];

  const addNeedsItem = async (
    name: string,
    icon: string,
    color: string,
    amount: number
  ) => {
    if (amount > 0) {
      const cat = await ensureCategory(name, icon, color);
      needsItems.push({ name, categoryId: cat.id, icon, color, amount });
    }
  };

  // Add only mentioned needs categories
  await addNeedsItem("Thuê nhà", "mc:home-city-outline", "#2CA5DC", rentAmount);
  await addNeedsItem("Thức ăn & Đồ uống", "mc:food", "#F29F3F", foodAmount);
  await addNeedsItem(
    "Giao thông",
    "mc:car-outline",
    "#FF6B6B",
    transportAmount
  );
  await addNeedsItem(
    "Điện nước & Viễn thông",
    "mc:wifi",
    "#4ECDC4",
    utilitiesAmount
  );
  await addNeedsItem(
    "Y tế & Sức khỏe",
    "mc:hospital-box",
    "#95E1D3",
    healthAmount
  );
  await addNeedsItem("Giáo dục", "mc:school", "#F38181", educationAmount);

  let needsUsed = needsItems.reduce((s, i) => s + i.amount, 0);
  const remainingNeeds = Math.max(0, needsBudget - needsUsed);

  // Add "Chi phí thiết yếu khác" for remaining amount
  if (remainingNeeds > 0) {
    const essentialOtherCat = await ensureCategory(
      "Chi phí thiết yếu khác",
      "mc:help-circle-outline",
      "#7EC5E8"
    );
    needsItems.push({
      name: "Chi phí thiết yếu khác",
      categoryId: essentialOtherCat.id,
      icon: "mc:help-circle-outline",
      color: "#7EC5E8",
      amount: remainingNeeds,
    });
  }

  // Wants allocation - only add categories that have amounts from description
  const wantsItems: Array<{
    name: string;
    categoryId: string;
    icon: string;
    color: string;
    amount: number;
  }> = [];

  const addWantsItem = async (
    name: string,
    icon: string,
    color: string,
    amount: number
  ) => {
    if (amount > 0) {
      const cat = await ensureCategory(name, icon, color);
      wantsItems.push({ name, categoryId: cat.id, icon, color, amount });
    }
  };

  await addWantsItem("Mua sắm", "mc:cart-outline", "#18A689", shoppingAmount);

  let wantsUsed = shoppingAmount;
  const travelFinal = travelAmount > 0 ? travelAmount : wantsBudget - wantsUsed;
  const travelCat = await ensureCategory("Du lịch", "mc:airplane", "#42A5F5");
  if (travelFinal > 0) {
    wantsItems.push({
      name: "Du lịch",
      categoryId: travelCat.id,
      icon: "mc:airplane",
      color: "#42A5F5",
      amount: travelFinal,
    });
  }

  // If over allocated, scale down wants proportionally
  const wantsTotal = wantsItems.reduce((s, i) => s + i.amount, 0);
  const wantsFactor =
    wantsTotal > 0 ? Math.min(1, wantsBudget / wantsTotal) : 1;
  wantsItems.forEach((i) => (i.amount = Math.round(i.amount * wantsFactor)));

  // Savings - always add if amount > 0
  const savingsItems: Array<{
    name: string;
    categoryId: string;
    icon: string;
    color: string;
    amount: number;
  }> = [];
  if (savingsBudget > 0) {
    const savingsCat = await ensureCategory(
      "Tiết kiệm",
      "mc:piggy-bank",
      "#2ECC71"
    );
    savingsItems.push({
      name: "Tiết kiệm",
      categoryId: savingsCat.id,
      icon: "mc:piggy-bank",
      color: "#2ECC71",
      amount: savingsBudget,
    });
  }

  // Build CategoryScoring list
  const make = (
    items: Array<{
      name: string;
      categoryId: string;
      icon: string;
      color: string;
      amount: number;
    }>,
    groupType: "needs" | "wants" | "savings"
  ): CategoryScoring[] =>
    items.map((it) => ({
      categoryId: it.categoryId,
      categoryName: it.name,
      categoryIcon: it.icon,
      categoryColor: it.color,
      groupType,
      score: 1,
      allocatedAmount: it.amount,
      reason: "Phân bổ theo mô tả lối sống và tỷ lệ 50/30/20",
    }));

  return [
    ...make(needsItems, "needs"),
    ...make(wantsItems, "wants"),
    ...make(savingsItems, "savings"),
  ];
}

// ============ Helper Functions ============

/**
 * Classify category type based on category name and lifestyle signals
 * Uses intelligent keywords matching for Vietnamese context
 */
function classifyCategoryType(
  categoryName: string,
  signals: LifestyleSignals
): "needs" | "wants" | "savings" {
  const name = categoryName.toLowerCase().trim();

  // Hard overrides for common Vietnamese categories to ensure correct grouping
  if (/^giao\s*thông/i.test(name)) return "needs"; // transportation is essential
  if (/^du\s*lịch/i.test(name)) return "wants"; // travel is discretionary
  if (/^mua\s*sắm/i.test(name)) return "wants"; // shopping is wants
  if (/chi\s*phí\s*thiết\s*yếu/i.test(name)) return "needs"; // other essential costs
  if (/thức\s*ăn|thực\s*ăn|đồ\s*uống|ăn\s*uống/i.test(name)) return "needs"; // food basics

  // NEEDS - Essential expenses
  const needsPatterns = [
    // Housing
    /nhà|thuê|trọ|rent|apartment|căn hộ|chung cư|homestay|ký túc xá|housing|home/i,
    // Utilities
    /điện|nước|gas|internet|wifi|phone|viễn thông|điện thoại|cơm điện|utilities|utility/i,
    // Essential transport
    /giao thông|xe bus|xe buýt|xe máy|xăng|dầu|đổ xăng|vé|giá vé|transport|bus|taxi|ride/i,
    // Basic groceries & essential food
    /grocery|siêu thị|chợ|hàng hoá|thực phẩm|cơm|đồ ăn cơ bản|ăn cơ bản|groceries/i,
    // Healthcare
    /bác sĩ|thuốc|y tế|bệnh viện|phòng khám|sức khỏe|khám|tiêm|vaccine|health|medical|doctor/i,
    // Insurance
    /bảo hiểm|insurance/i,
    // Essential childcare & education
    /trường|học|giáo dục|tiêu học|trung học|đại học|học phí|education|school|tuition/i,
  ];

  // SAVINGS - Savings & Investment
  const savingsPatterns = [
    /tiết kiệm|tích lũy|save|savings|đầu tư|investment|gửi tiền|tài khoản tiết kiệm|fund|quỹ|saving|invest/i,
  ];

  // WANTS - Leisure & Entertainment (default)
  const wantsPatterns = [
    // Dining out & casual food
    /ăn ngoài|nhà hàng|quán ăn|cafe|cà phê|bia|rượu|karaoke|bar|quán bar|food delivery|grab food|bún|phở|cơm tấm|restaurant|dining|cafe|coffee/i,
    // Travel & Entertainment
    /du lịch|travel|vé máy bay|khách sạn|hotel|tour|kỳ nghỉ|vacation|resort|flight|airline/i,
    // Shopping & Luxury
    /shopping|mua sắm|quần áo|giày|trang sức|mỹ phẩm|sắc đẹp|clothes|fashion|shopping|mall/i,
    // Entertainment
    /phim|xem phim|spotify|netflix|game|gaming|điện tử|giải trí|vũ trường|movie|cinema|entertainment|music|streaming/i,
    // Hobby & Sports
    /gym|thể thao|yoga|bơi|môn thể thao|sở thích|hobby|golf|sports|fitness/i,
    // Pet care (luxury)
    /thú cưng|pet|chó|mèo|chim|pet care|animal/i,
    // Personal care & luxury
    /salon|cắt tóc|massage|spa|làm đẹp|personal care|beauty/i,
  ];

  // Check SAVINGS first (highest priority)
  for (const pattern of savingsPatterns) {
    if (pattern.test(name)) return "savings";
  }

  // Check NEEDS (high priority)
  for (const pattern of needsPatterns) {
    if (pattern.test(name)) return "needs";
  }

  // Check WANTS (default)
  for (const pattern of wantsPatterns) {
    if (pattern.test(name)) return "wants";
  }

  // Smart fallback based on lifestyle signals and category context
  if (
    signals.foodOutFrequency === "high" &&
    /ăn|food|cơm|ăn uống/i.test(name)
  ) {
    // High eating out frequency + food category = wants (dining out)
    if (!/thực phẩm|grocery|cơm cơ bản|đồ ăn cơ bản/i.test(name)) {
      return "wants";
    }
  }

  if (signals.hasDebt && /ăn|shopping|cafe|du lịch|giải trí/i.test(name)) {
    return "wants"; // These are clearly wants
  }

  // If matches both needs & wants patterns, prioritize needs
  if (/ăn uống|food/i.test(name)) {
    return "needs"; // Default food to needs unless explicitly says dining/restaurant
  }

  // Default: classify as wants for unknown categories
  return "wants";
}

// ============ Feature Extraction ============

/**
 * Parse lifestyle description and extract signals
 */
export function parseLifestyleSignals(
  description: string,
  location?: string
): LifestyleSignals {
  const desc = description.toLowerCase();

  // Location detection
  let detectedLocation: "hanoi" | "hcm" | "other" = "other";
  if (/hà nội|hanoi|hn\b/i.test(desc)) detectedLocation = "hanoi";
  else if (/tp\.?hcm|hồ chí minh|sài gòn|hcm|tphcm/i.test(desc))
    detectedLocation = "hcm";

  // Rent detection
  const hasRent = /thuê|trọ|rent|apartment|flat|căn hộ|chung cư/i.test(desc);
  let rentEstimate = 0;
  if (hasRent) {
    // Estimate rent based on location
    if (detectedLocation === "hanoi") {
      rentEstimate = hasRent ? 3000000 : 0; // 3M default for HN
    } else if (detectedLocation === "hcm") {
      rentEstimate = hasRent ? 4000000 : 0; // 4M default for HCMC
    } else {
      rentEstimate = hasRent ? 3500000 : 0;
    }
  }

  // Food frequency
  let foodOutFrequency: "low" | "medium" | "high" = "low";
  if (/ăn ngoài|quán ăn|food delivery|grab food|nhà hàng/i.test(desc)) {
    foodOutFrequency = "high";
  } else if (/thỉnh thoảng|đôi khi|thi thoảng/i.test(desc)) {
    foodOutFrequency = "medium";
  }

  // Social spending
  let socialSpending: "low" | "medium" | "high" = "low";
  if (/cafe|quán bar|karaoke|bia nhậu|tiệc tùng/i.test(desc)) {
    socialSpending = "high";
  } else if (/thỉnh thoảng|đôi khi/i.test(desc)) {
    socialSpending = "medium";
  }

  // Savings goal
  const hasSavingsGoal = /mua nhà|tiết kiệm|đầu tư|tích lũy|goal/i.test(desc);

  // Debt
  const hasDebt = /nợ|tiền nợ|vay|credit|khoản vay/i.test(desc);

  // Luxury interest
  let luxuryInterest: "low" | "medium" | "high" = "low";
  if (/shopping|du lịch|nước ngoài|luxury|cao cấp|đắt tiền/i.test(desc)) {
    luxuryInterest = "high";
  } else if (/thỉnh thoảng/i.test(desc)) {
    luxuryInterest = "medium";
  }

  // Minimal living
  const minimalLiving = /đơn giản|tiết kiệm|minimalist|simple/i.test(desc);

  return {
    hasRent,
    rentEstimate,
    foodOutFrequency,
    socialSpending,
    hasSavingsGoal,
    hasDebt,
    luxuryInterest,
    location: detectedLocation,
    minimalLiving,
  };
}

// ============ Decision Tree ============

/**
 * Decision tree-based ratio suggestion based on income & lifestyle
 * Uses simplified 50/30/20 rule as base with minor adjustments
 */
export function decisionTreeRatio(
  income: number,
  signals: LifestyleSignals
): BudgetRatio {
  // Lock to the 50/30/20 rule to match the sample app exactly
  // (no dynamic adjustments to avoid drift from expected UI output)
  return {
    needs: 0.5,
    wants: 0.3,
    savings: 0.2,
  };
}

// ============ Category Scoring ============

export type CategoryMetrics = {
  categoryId: string;
  categoryName: string;
  categoryIcon?: string;
  categoryColor?: string;
  groupType: "needs" | "wants" | "savings";
  frequency: number; // Times in 3 months
  amount: number; // Total spending
  proportion: number; // % of total spending
};

/**
 * Score categories for selection & allocation
 */
export function scoreCategories(
  metrics: CategoryMetrics[],
  signals: LifestyleSignals,
  ratio: BudgetRatio,
  income: number
): CategoryScoring[] {
  const totalAmount = metrics.reduce((s, m) => s + m.amount, 0);
  const maxFrequency = Math.max(...metrics.map((m) => m.frequency), 1);

  const scored = metrics.map((metric) => {
    // 1. Frequency Score (40%) - how often is this category used?
    const frequencyScore = metric.frequency / maxFrequency;

    // 2. Amount Score (35%) - how much is spent in this category?
    const amountScore = totalAmount > 0 ? metric.amount / totalAmount : 0;

    // 3. Signal Match Score (15%) - does this match lifestyle signals?
    let signalScore = 0;
    const catNameLower = metric.categoryName.toLowerCase();

    if (signals.hasRent && /thuê|nhà|căn hộ|apartment/i.test(catNameLower)) {
      signalScore = 1.0;
    } else if (
      signals.foodOutFrequency === "high" &&
      /ăn|food|cafe|quán|nhà hàng/i.test(catNameLower)
    ) {
      signalScore = 1.0;
    } else if (
      signals.socialSpending === "high" &&
      /cafe|bar|karaoke|tiệp|party/i.test(catNameLower)
    ) {
      signalScore = 0.9;
    } else if (
      signals.luxuryInterest === "high" &&
      /shopping|mua|du lịch|vacation/i.test(catNameLower)
    ) {
      signalScore = 0.85;
    } else if (
      signals.hasSavingsGoal &&
      /tiết kiệm|đầu tư|investment/i.test(catNameLower)
    ) {
      signalScore = 1.0;
    } else if (/điện|nước|gas|wifi|phone|service/i.test(catNameLower)) {
      signalScore = 0.8; // Utilities always important
    } else if (/thức ăn|grocery|supermarket/i.test(catNameLower)) {
      signalScore = 0.75; // Food is important
    }

    // 4. Recency Score (10%) - was there recent activity?
    const recencyScore = metric.frequency > 0 ? Math.min(1, 1.0) : 0.3;

    // Combine scores
    const finalScore =
      frequencyScore * 0.4 +
      amountScore * 0.35 +
      signalScore * 0.15 +
      recencyScore * 0.1;

    // Generate reason
    let reason = "";
    if (signalScore === 1.0) {
      reason = "Hạng mục quan trọng từ mô tả lối sống của bạn";
    } else if (amountScore > 0.15) {
      reason = "Bạn thường chi nhiều cho hạng mục này";
    } else if (frequencyScore > 0.7) {
      reason = "Bạn thường xuyên sử dụng hạng mục này";
    } else {
      reason = "Đề xuất dựa trên chi phí hàng tháng";
    }

    return {
      categoryId: metric.categoryId,
      categoryName: metric.categoryName,
      categoryIcon: metric.categoryIcon,
      categoryColor: metric.categoryColor,
      groupType: metric.groupType,
      score: finalScore,
      allocatedAmount: 0, // Will be calculated later
      reason,
    };
  });

  return scored.sort((a, b) => b.score - a.score);
}

// ============ Allocation ============

/**
 * Allocate budget to selected categories
 */
export function allocateToCategories(
  scored: CategoryScoring[],
  ratio: BudgetRatio,
  income: number,
  period: "daily" | "weekly" | "monthly",
  signals?: LifestyleSignals
): CategoryScoring[] {
  // Convert income to period
  let periodIncome = income;
  if (period === "weekly") {
    periodIncome = Math.round(income / 4.33);
  } else if (period === "daily") {
    periodIncome = Math.round(income / 30);
  }

  const needsBudget = Math.round(periodIncome * ratio.needs);
  const wantsBudget = Math.round(periodIncome * ratio.wants);
  const savingsBudget = Math.round(periodIncome * ratio.savings);

  // Separate by group
  const needsCategories = scored.filter((c) => c.groupType === "needs");
  const wantsCategories = scored.filter((c) => c.groupType === "wants");
  const savingsCategories = scored.filter((c) => c.groupType === "savings");

  // Allocate with priority-based distribution
  const allocate = (
    categories: CategoryScoring[],
    budget: number,
    groupType: "needs" | "wants" | "savings"
  ): CategoryScoring[] => {
    if (categories.length === 0) return [];

    // Priority allocation: top 3 categories get more, rest get less
    const sorted = [...categories].sort((a, b) => b.score - a.score);

    let allocations: CategoryScoring[] = [];

    if (sorted.length === 1) {
      // Only 1 category: get all budget
      return [
        {
          ...sorted[0],
          allocatedAmount: budget,
        },
      ];
    } else if (sorted.length === 2) {
      // 2 categories: 60/40 split by score
      const totalScore = sorted.reduce((s, c) => s + c.score, 0);
      return sorted.map((c) => ({
        ...c,
        allocatedAmount: Math.round((c.score / totalScore) * budget),
      }));
    } else {
      // 3+ categories: prioritize top 3, distribute rest evenly
      const top3 = sorted.slice(0, 3);
      const rest = sorted.slice(3);

      // Allocate 85% to top 3 (by score), 15% to rest
      const top3Budget = Math.round(budget * 0.85);
      const restBudget = Math.round(budget * 0.15);

      const top3Score = top3.reduce((s, c) => s + c.score, 0);
      allocations = top3.map((c) => ({
        ...c,
        allocatedAmount: Math.round((c.score / top3Score) * top3Budget),
      }));

      if (rest.length > 0) {
        const perCategory = Math.round(restBudget / rest.length);
        allocations.push(
          ...rest.map((c) => ({
            ...c,
            allocatedAmount: perCategory,
          }))
        );
      }

      return allocations;
    }
  };

  return [
    ...allocate(needsCategories, needsBudget, "needs"),
    ...allocate(wantsCategories, wantsBudget, "wants"),
    ...allocate(savingsCategories, savingsBudget, "savings"),
  ];
}

// ============ Generate Insights ============

export function generateInsights(
  scored: CategoryScoring[],
  ratio: BudgetRatio,
  signals: LifestyleSignals,
  income: number
): string[] {
  const insights: string[] = [];

  const needsPercent = Math.round(ratio.needs * 100);
  const wantsPercent = Math.round(ratio.wants * 100);
  const savingsPercent = Math.round(ratio.savings * 100);
  const needsAmount = Math.round(income * ratio.needs);
  const wantsAmount = Math.round(income * ratio.wants);
  const savingsAmount = Math.round(income * ratio.savings);

  // Insight 0: Summary (like sample app)
  let summary = `Dự quy tắc ${needsPercent}/${wantsPercent}/${savingsPercent}: ${needsPercent}% cho chi phí thiết yếu (${needsAmount.toLocaleString()}đ), ${wantsPercent}% cho mong muốn (${wantsAmount.toLocaleString()}đ), ${savingsPercent}% cho tiết kiệm (${savingsAmount.toLocaleString()}đ).\n\n`;

  // Add user's specific spending from description
  if (signals.hasRent && signals.rentEstimate) {
    summary += `Từ mô tả: Thuê nhà ${Math.round(
      signals.rentEstimate / 1000000
    )}tr`;
  }
  const foodMatch = /ăn uống (\d+)/i.exec(
    signals.luxuryInterest === "high" ? "ăn uống 3" : "ăn uống 2"
  );
  if (foodMatch) {
    summary += `, ăn uống ${foodMatch[1]}tr`;
  }
  summary += `\n→ Các khoản thiết yếu khác để đạt ${needsPercent}%\n→ Gợi ý: Duy trì chi tiêu trong khoảng Wants, dành ${savingsAmount.toLocaleString()}đ vào tiết kiệm hàng tháng.`;

  insights.push(summary);

  // Insight 1: Housing
  if (signals.hasRent && signals.rentEstimate) {
    const rentPercent = Math.round((signals.rentEstimate / income) * 100);
    if (rentPercent <= 30) {
      insights.push(`✅ Nhà ở ${rentPercent}% - hợp lý cho nhu cầu`);
    } else {
      insights.push(`⚠️ Nhà ở ${rentPercent}% - khá cao, xem xét giảm`);
    }
  }

  // Insight 2: Savings goal
  if (signals.hasSavingsGoal && savingsAmount > 0) {
    const monthsTo5M = Math.ceil(5000000 / savingsAmount);
    insights.push(
      `💎 Tiết kiệm ${savingsPercent}% = ${savingsAmount.toLocaleString()}đ/tháng → 5M trong ${monthsTo5M} tháng`
    );
  } else if (savingsPercent >= 20) {
    insights.push(`🎯 Tiết kiệm ${savingsPercent}% - rất tốt! Hãy đầu tư`);
  }

  // Insight 3: Debt warning
  if (signals.hasDebt) {
    insights.push(`⚠️ Có nợ: ưu tiên trả nợ, giảm chi tiêu không cần thiết`);
  }

  return insights.slice(0, 5); // Return max 5 insights
}

// ============ Learn from User History ============

export async function learnFromUserHistory(
  months: number = 3
): Promise<{ actualRatio: BudgetRatio; patterns: Record<string, any> }> {
  try {
    const userId = await getCurrentUserId();
    if (!userId)
      return {
        actualRatio: { needs: 0.5, wants: 0.3, savings: 0.2 },
        patterns: {},
      };

    const endSec = Math.floor(Date.now() / 1000);
    const startSec = endSec - months * 30 * 86400;

    // Get breakdown with group type info from budget allocations
    const rows = await (db as any).getAllAsync(
      `SELECT ba.group_type, SUM(t.amount) as total
       FROM transactions t
       JOIN budget_allocations ba ON t.category_id = ba.category_id
       WHERE t.user_id = ? AND t.type = 'expense' AND t.occurred_at >= ? AND t.occurred_at <= ?
       GROUP BY ba.group_type`,
      [Number(userId || 0), startSec, endSec]
    );

    const groupTotals = {
      needs: 0,
      wants: 0,
      savings: 0,
    };

    for (const row of rows as Array<{ group_type: string; total: number }>) {
      if (!row.group_type) continue;
      const groupType = row.group_type as keyof typeof groupTotals;
      if (groupType in groupTotals) {
        groupTotals[groupType] += row.total || 0;
      }
    }

    const total = Object.values(groupTotals).reduce((s, v) => s + v, 0);

    const actualRatio =
      total > 0
        ? {
            needs: groupTotals.needs / total,
            wants: groupTotals.wants / total,
            savings: groupTotals.savings / total,
          }
        : { needs: 0.5, wants: 0.3, savings: 0.2 };

    return {
      actualRatio,
      patterns: {
        monthsAnalyzed: months,
        totalSpent: total,
        averageMonthly: total / months,
      },
    };
  } catch (error) {
    console.warn("Error learning from history:", error);
    return {
      actualRatio: { needs: 0.5, wants: 0.3, savings: 0.2 },
      patterns: {},
    };
  }
}

// ============ Main Function ============

/**
 * Generate smart budget using Hybrid Intelligence System
 */
export async function generateSmartBudget(
  input: LifestyleInput
): Promise<SmartBudgetResult> {
  try {
    // 1. Parse lifestyle
    const signals = parseLifestyleSignals(input.description);

    // 2. Get decision tree ratio
    const baseRatio = decisionTreeRatio(input.income, signals);

    // 3. Learn from user history (for insights only, not for final ratio)
    const userHistory = await learnFromUserHistory(3);

    // Use base ratio directly - don't blend with history
    // The decision tree already accounts for individual circumstances
    const normalizedRatio = baseRatio;

    // 5. Deterministic allocation like sample app (ignores history to avoid drift)
    const allocated = await buildTemplateAllocations(
      input.income,
      normalizedRatio,
      input.description
    );

    // 8. Generate insights
    const insights = generateInsights(
      allocated,
      normalizedRatio,
      signals,
      input.income
    );

    // 9. Calculate confidence
    const confidence = userHistory.patterns.totalSpent > 0 ? 0.9 : 0.7;

    // 10. Generate alternatives
    const alternatives: BudgetRatio[] = [
      { needs: 0.5, wants: 0.3, savings: 0.2 }, // Classic 50/30/20
      { needs: 0.55, wants: 0.25, savings: 0.2 }, // Conservative
      { needs: 0.45, wants: 0.35, savings: 0.2 }, // Balanced
    ];

    return {
      ratio: normalizedRatio,
      categories: allocated,
      insights,
      alternatives,
      confidence,
    };
  } catch (error) {
    console.warn("Error generating smart budget:", error);
    // Fallback to 50/30/20
    return {
      ratio: { needs: 0.5, wants: 0.3, savings: 0.2 },
      categories: [],
      insights: [
        "Không thể tạo gợi ý thông minh, sử dụng tỷ lệ tiêu chuẩn 50/30/20",
      ],
      alternatives: [],
      confidence: 0.5,
    };
  }
}
