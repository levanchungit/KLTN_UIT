import { getAdaptiveHistoricalData } from "@/services/adaptiveHistoryService";
import {
  budgetPredictor,
  HistoricalAnalyzer,
  textEncoder,
  tfliteModel,
  type HistoricalAnalysisResult,
} from "@/services/budgetAIService";
import { getCurrentUserId } from "@/utils/auth";

// Giữ type cho tương thích
export type RawFeatures = {
  textEmbedding: Float32Array;
  income: number;
  age?: number;
  location?: string;
  occupation?: string;
  dependents?: number;
  historicalPatterns?: any;
  month: number;
  isHolidaySeason?: boolean;
};

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
  mlModelUsed?: boolean;
  modelConfidence?: number;
  modelVersion?: string;
  confidence: number; // 0-1
  metadata?: {
    source: "tflite-model" | "ml-hybrid" | "historical" | "rule-based";
    historicalAccuracy?: number;
    riskScore?: number;
    deviation?: number;
    historicalSummary?: Pick<
      HistoricalAnalysisResult,
      | "avgIncome"
      | "totalSpending"
      | "savingsRate"
      | "volatility"
      | "monthsAnalyzed"
      | "categoryCount"
      | "monthlyTotals"
      | "categoryVolatility"
    >;
  };
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
    ...normalizeAllocations(make(needsItems, "needs"), needsBudget),
    ...normalizeAllocations(make(wantsItems, "wants"), wantsBudget),
    ...normalizeAllocations(make(savingsItems, "savings"), savingsBudget),
  ];
}

// Round to nearest 1,000đ and rebalance so the sum matches the intended budget
function normalizeAllocations(
  items: CategoryScoring[],
  budget: number
): CategoryScoring[] {
  if (items.length === 0) return items;

  const targetBudget = Math.round(budget / 1000) * 1000;

  const rounded = items.map((a) => ({
    ...a,
    allocatedAmount: Math.max(0, Math.round(a.allocatedAmount / 1000) * 1000),
  }));

  const diff =
    targetBudget - rounded.reduce((s, a) => s + a.allocatedAmount, 0);

  if (diff !== 0) {
    // Adjust the largest bucket to absorb the rounding difference
    let idxMax = 0;
    for (let i = 1; i < rounded.length; i++) {
      if (rounded[i].allocatedAmount > rounded[idxMax].allocatedAmount) {
        idxMax = i;
      }
    }
    rounded[idxMax] = {
      ...rounded[idxMax],
      allocatedAmount: Math.max(0, rounded[idxMax].allocatedAmount + diff),
    };
  }

  return rounded;
}

async function buildHistoricalAllocations(
  income: number,
  ratio: BudgetRatio,
  description: string,
  patterns: import("@/services/budgetAIService").SpendingPattern[]
): Promise<CategoryScoring[]> {
  const signals = parseLifestyleSignals(description || "");

  const needsBudget = Math.round(income * ratio.needs);
  const wantsBudget = Math.round(income * ratio.wants);
  const savingsBudget = Math.round(income * ratio.savings);

  // Map patterns to groups
  const needs: typeof patterns = [] as any;
  const wants: typeof patterns = [] as any;

  for (const p of patterns) {
    const group = classifyCategoryType(p.categoryName, signals);
    if (group === "needs") needs.push(p);
    else if (group === "wants") wants.push(p);
  }

  // Helper to convert to CategoryScoring with proportional allocation
  const toAllocations = (
    pats: typeof patterns,
    budget: number,
    groupType: "needs" | "wants"
  ): CategoryScoring[] => {
    if (!pats || pats.length === 0 || budget <= 0) return [];

    // Sort by average spend desc and keep up to 8 categories for readability
    const sorted = [...pats]
      .sort((a, b) => b.avgMonthlySpend - a.avgMonthlySpend)
      .slice(0, 8);
    const total =
      sorted.reduce((s, x) => s + Math.max(0, x.avgMonthlySpend), 0) || 1;

    const allocations = sorted.map((p) => ({
      categoryId: p.categoryId,
      categoryName: p.categoryName,
      groupType,
      categoryIcon: undefined,
      categoryColor: undefined,
      score: p.avgMonthlySpend / total,
      allocatedAmount: (Math.max(0, p.avgMonthlySpend) / total) * budget,
      reason: "Phân bổ theo lịch sử chi tiêu 3 tháng gần nhất",
    }));

    return normalizeAllocations(allocations, budget);
  };

  const needsAlloc = toAllocations(needs, needsBudget, "needs");
  const wantsAlloc = toAllocations(wants, wantsBudget, "wants");

  // Add Savings as a single bucket (create category if missing)
  const savingsAlloc: CategoryScoring[] = [];
  if (savingsBudget > 0) {
    const { listCategories, createCategory } = await import(
      "@/repos/categoryRepo"
    );
    const existing = await listCategories({ type: "expense" });
    const map = new Map(existing.map((c: any) => [c.name, c]));

    const ensureCategory = async (
      name: string,
      icon: string,
      color: string
    ) => {
      if (!map.has(name)) {
        const id = await createCategory({ name, type: "expense", icon, color });
        map.set(name, { id, name, type: "expense", icon, color } as any);
      }
      return map.get(name)!;
    };

    const savingsCat = await ensureCategory(
      "Tiết kiệm",
      "mc:piggy-bank",
      "#2ECC71"
    );
    savingsAlloc.push({
      categoryId: savingsCat.id,
      categoryName: "Tiết kiệm",
      categoryIcon: "mc:piggy-bank",
      categoryColor: "#2ECC71",
      groupType: "savings",
      score: 1,
      allocatedAmount: savingsBudget,
      reason: "Dự phòng và tích lũy theo mục tiêu",
    });
  }

  // Optional: add a small "Dự phòng" line in needs if budget remains due to rounding
  const sumNeeds = needsAlloc.reduce((s, a) => s + a.allocatedAmount, 0);
  if (needsBudget - sumNeeds >= 1000) {
    const remain = needsBudget - sumNeeds;
    const { listCategories, createCategory } = await import(
      "@/repos/categoryRepo"
    );
    const existing = await listCategories({ type: "expense" });
    const map = new Map(existing.map((c: any) => [c.name, c]));
    const ensureCategory = async (
      name: string,
      icon: string,
      color: string
    ) => {
      if (!map.has(name)) {
        const id = await createCategory({ name, type: "expense", icon, color });
        map.set(name, { id, name, type: "expense", icon, color } as any);
      }
      return map.get(name)!;
    };
    const otherCat = await ensureCategory(
      "Dự phòng",
      "mc:lightbulb-on-outline",
      "#7EC5E8"
    );
    needsAlloc.push({
      categoryId: otherCat.id,
      categoryName: "Dự phòng",
      categoryIcon: "mc:lightbulb-on-outline",
      categoryColor: "#7EC5E8",
      groupType: "needs",
      score: 0.2,
      allocatedAmount: remain,
      reason: "Khoản dự phòng từ phần còn lại",
    });
  }

  const normalizedNeeds = normalizeAllocations(needsAlloc, needsBudget);
  const normalizedWants = normalizeAllocations(wantsAlloc, wantsBudget);
  const normalizedSavings = normalizeAllocations(savingsAlloc, savingsBudget);

  return [...normalizedNeeds, ...normalizedWants, ...normalizedSavings];
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
      return normalizeAllocations(
        [
          {
            ...sorted[0],
            allocatedAmount: budget,
          },
        ],
        budget
      );
    } else if (sorted.length === 2) {
      // 2 categories: 60/40 split by score
      const totalScore = sorted.reduce((s, c) => s + c.score, 0);
      return normalizeAllocations(
        sorted.map((c) => ({
          ...c,
          allocatedAmount: (c.score / totalScore) * budget,
        })),
        budget
      );
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
        allocatedAmount: (c.score / top3Score) * top3Budget,
      }));

      if (rest.length > 0) {
        const perCategory = restBudget / rest.length;
        allocations.push(
          ...rest.map((c) => ({
            ...c,
            allocatedAmount: perCategory,
          }))
        );
      }

      return normalizeAllocations(allocations, budget);
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

/**
 * Generate smart budget using Hybrid Intelligence System
 */
export async function generateSmartBudget(
  input: LifestyleInput & { userId?: string }
): Promise<SmartBudgetResult> {
  const startTime = Date.now();

  try {
    // === PHASE 1: HISTORICAL ANALYSIS ===
    let historicalData: any = null;
    let useML = false;
    const userId = input.userId || (await getCurrentUserId());

    if (userId) {
      try {
        // Use ADAPTIVE detection instead of hardcoding 3 months
        historicalData = await getAdaptiveHistoricalData(userId);
        if (historicalData && historicalData.patterns.length > 0) {
          console.log("[SmartBudget] ✅ Historical data loaded:", {
            patterns: historicalData.patterns.length,
            avgIncome: historicalData.avgIncome,
            savingsRate: `${(historicalData.savingsRate * 100).toFixed(1)}%`,
          });
        } else {
          console.log("[SmartBudget] ℹ️ No historical patterns found");
        }
      } catch (err) {
        console.warn("[SmartBudget] Adaptive analysis failed:", err);
      }
    }

    // === PHASE 2: ML PREDICTION (always try, even without history) ===
    let mlPrediction: any = null;
    let mlModelUsed = false;
    let modelConfidence = 0;
    let modelVersion = "none";

    // TRY ML EVEN IF NO HISTORY - use heuristic predictor
    if (input.description && input.description.trim().length > 5) {
      try {
        // Step 1: Try TFLite model (if historical data available)
        if (historicalData && historicalData.patterns.length >= 3) {
          await tfliteModel.initialize();

          const textEmbedding = await textEncoder.encode(input.description);

          const tfliteOutput = await tfliteModel.predict({
            textEmbedding,
            income: input.income,
            month: new Date().getMonth() + 1,
            historicalPatterns: {
              avgMonthlySpend: historicalData.patterns.reduce(
                (sum: number, p: any) => sum + p.avgMonthlySpend,
                0
              ),
              savingsRate: historicalData.savingsRate,
              volatility: historicalData.volatility,
              topCategories: historicalData.patterns
                .sort((a: any, b: any) => b.avgMonthlySpend - a.avgMonthlySpend)
                .slice(0, 5)
                .map((p: any) => ({
                  id: p.categoryId,
                  ratio:
                    p.avgMonthlySpend /
                    historicalData.patterns.reduce(
                      (sum: number, x: any) => sum + x.avgMonthlySpend,
                      0
                    ),
                })),
            },
          });

          if (tfliteOutput.riskConfidence > 0.65) {
            mlModelUsed = true;
            modelConfidence = tfliteOutput.riskConfidence;
            const metadata = tfliteModel.getMetadata();
            modelVersion = metadata?.version || "unknown";

            mlPrediction = {
              ratioAdjustments: tfliteOutput.ratios,
              confidence: tfliteOutput.riskConfidence,
              riskScore: tfliteOutput.riskScore,
              insights: [
                `🤖 Mô hình AI dự đoán (độ tin cậy: ${(
                  tfliteOutput.riskConfidence * 100
                ).toFixed(0)}%)`,
                `📊 Phân bổ được đề xuất dựa trên ${historicalData.patterns.length} danh mục lịch sử`,
              ],
            };
            useML = true;

            console.log(
              "[SmartBudget] Using TFLite model, confidence:",
              modelConfidence
            );
          } else {
            console.log(
              "[SmartBudget] TFLite confidence too low:",
              tfliteOutput.riskConfidence
            );
          }
        }

        // Step 2: Fallback to heuristic predictor (always available)
        if (!useML) {
          await budgetPredictor.initialize();

          mlPrediction = await budgetPredictor.predict({
            income: input.income,
            lifestyleText: input.description,
            historicalPatterns: historicalData?.patterns || [],
            currentMonth: new Date().getMonth() + 1,
          });

          // Heuristic ML is ALWAYS confident - lower threshold
          if (mlPrediction && mlPrediction.riskScore < 0.9) {
            useML = true;
            console.log("[SmartBudget] ✅ Using heuristic ML predictor:", {
              riskScore: mlPrediction.riskScore.toFixed(2),
              confidence: (1 - mlPrediction.riskScore).toFixed(2),
              insights: mlPrediction.insights.length,
              source: "heuristic-ml",
            });
          } else {
            console.log(
              "[SmartBudget] ⚠️ Heuristic ML risk too high:",
              mlPrediction.riskScore
            );
          }
        }
      } catch (err) {
        console.warn("[SmartBudget] ML prediction failed:", err);
      }
    }

    // === PHASE 3: DETERMINE RATIOS ===
    let ratio: BudgetRatio;
    let insights: string[] = [];
    let source: "ml-hybrid" | "historical" | "rule-based" = "rule-based";

    if (useML && mlPrediction) {
      // Use ML-predicted ratios
      ratio = mlPrediction.ratioAdjustments;
      insights = mlPrediction.insights;
      source = "ml-hybrid";

      console.log("[SmartBudget] Using ML ratios:", ratio);
    } else if (historicalData && historicalData.patterns.length >= 2) {
      // Use historical-based adjustments
      const signals = parseLifestyleSignals(input.description);
      const baseRatio = decisionTreeRatio(input.income, signals);

      // Adjust based on historical savings rate
      if (historicalData.savingsRate < 0.1) {
        baseRatio.savings += 0.05;
        baseRatio.wants -= 0.05;
        insights.push(
          `⚠️ Tỷ lệ tiết kiệm trước đây chỉ ${(
            historicalData.savingsRate * 100
          ).toFixed(0)}%, đã tăng lên ${(baseRatio.savings * 100).toFixed(0)}%`
        );
      }

      // Adjust based on income change
      if (historicalData.avgIncome > 0) {
        const incomeRatio = input.income / historicalData.avgIncome;
        if (incomeRatio > 1.15) {
          baseRatio.savings += 0.03;
          baseRatio.wants -= 0.03;
          insights.push(
            `💰 Thu nhập tăng ${((incomeRatio - 1) * 100).toFixed(
              0
            )}%, tăng tỷ lệ tiết kiệm`
          );
        } else if (incomeRatio < 0.9) {
          baseRatio.needs += 0.03;
          baseRatio.wants -= 0.03;
          insights.push(
            `📉 Thu nhập giảm ${((1 - incomeRatio) * 100).toFixed(
              0
            )}%, ưu tiên chi phí cần thiết`
          );
        }
      }

      // Normalize
      const sum = baseRatio.needs + baseRatio.wants + baseRatio.savings;
      ratio = {
        needs: baseRatio.needs / sum,
        wants: baseRatio.wants / sum,
        savings: baseRatio.savings / sum,
      };

      source = "historical";
      console.log("[SmartBudget] Using historical-adjusted ratios:", ratio);
    } else {
      // Fallback to rule-based
      const signals = parseLifestyleSignals(input.description);
      ratio = decisionTreeRatio(input.income, signals);
      source = "rule-based";

      console.log("[SmartBudget] Using rule-based ratios:", ratio);
    }

    // === PHASE 4: BUILD ALLOCATIONS ===
    let allocated: CategoryScoring[];
    if (
      historicalData &&
      historicalData.patterns &&
      historicalData.patterns.length > 0
    ) {
      allocated = await buildHistoricalAllocations(
        input.income,
        ratio,
        input.description,
        historicalData.patterns
      );
    } else {
      allocated = await buildTemplateAllocations(
        input.income,
        ratio,
        input.description
      );
    }

    // === PHASE 5: CALCULATE DEVIATION ===
    let deviation = 0;
    if (historicalData && historicalData.patterns.length > 0) {
      const analyzer = new HistoricalAnalyzer();
      const proposedAllocations = allocated.map((a) => ({
        categoryId: a.categoryId,
        amount: a.allocatedAmount,
      }));
      deviation = analyzer.calculateDeviation(
        proposedAllocations,
        historicalData.patterns
      );

      if (deviation > 0.3) {
        insights.push(
          `📊 Ngân sách này khác ${(deviation * 100).toFixed(
            0
          )}% so với thói quen - hãy theo dõi sát`
        );
      }
    }

    // === PHASE 6: ADD GENERAL INSIGHTS ===
    const generalInsights = generateInsights(
      allocated,
      ratio,
      parseLifestyleSignals(input.description),
      input.income
    );

    // History-focused insights to replace generic 50/30/20 wording
    const historyInsights: string[] = [];
    if (historicalData && historicalData.patterns.length > 0) {
      const topCat = historicalData.patterns[0];
      historyInsights.push(
        `📊 Chi nhiều nhất: ${
          topCat.categoryName
        } ~${topCat.avgMonthlySpend.toLocaleString("vi-VN")}đ/tháng (${
          topCat.trendDirection === "increasing"
            ? "đang tăng"
            : topCat.trendDirection === "decreasing"
            ? "đang giảm"
            : "ổn định"
        })`
      );

      if (historicalData.savingsRate !== undefined) {
        historyInsights.push(
          `💾 Tiết kiệm gần đây ~${(historicalData.savingsRate * 100).toFixed(
            0
          )}% thu nhập`
        );
      }

      if (
        historicalData.volatility !== undefined &&
        historicalData.volatility > 0.5
      ) {
        historyInsights.push(
          "⚠️ Chi tiêu biến động cao, nên đặt hạn mức cho các khoản tùy ý"
        );
      }
    }

    const baseInsights = [
      useML
        ? "🤖 Gợi ý được tạo bởi AI dựa trên lịch sử chi tiêu của bạn"
        : historicalData
        ? "📊 Gợi ý dựa trên lịch sử chi tiêu"
        : "📋 Gợi ý dựa trên bộ quy tắc mặc định",
      ...insights,
      ...generalInsights.filter(
        (i) => !insights.some((existing) => existing.includes(i.slice(0, 20)))
      ),
    ];

    // Remove boilerplate 50/30/20 lines and dedupe
    insights = [...historyInsights, ...baseInsights].filter(
      (line, idx, arr) => {
        const key = line.toLowerCase();
        if (key.includes("50/30/20")) return false;
        if (key.includes("quy tắc 50")) return false;
        if (key.includes("tỉ lệ 50")) return false;

        // Loại bỏ trùng lặp insight về tiết kiệm %
        if (key.includes("tiết kiệm") && key.match(/\d+%/)) {
          // Chỉ giữ insight đầu tiên về tiết kiệm %
          const firstSavingsIndex = arr.findIndex((l) => {
            const lkey = l.toLowerCase();
            return lkey.includes("tiết kiệm") && lkey.match(/\d+%/);
          });
          if (idx !== firstSavingsIndex) return false;
        }

        return arr.findIndex((l) => l.toLowerCase() === key) === idx;
      }
    );

    // === PHASE 7: CALCULATE CONFIDENCE ===
    let confidence = 0.7;
    if (useML && mlPrediction) {
      confidence = Math.max(0.6, 1 - mlPrediction.riskScore);
    } else if (historicalData && historicalData.patterns.length >= 5) {
      confidence = 0.85;
    } else if (historicalData && historicalData.patterns.length >= 2) {
      confidence = 0.75;
    }

    // Prepare historical summary for UI (only key metrics, no raw patterns)
    const historicalSummary:
      | Pick<
          HistoricalAnalysisResult,
          | "avgIncome"
          | "totalSpending"
          | "savingsRate"
          | "volatility"
          | "monthsAnalyzed"
          | "categoryCount"
        >
      | undefined = historicalData
      ? {
          avgIncome: Math.round(historicalData.avgIncome || 0),
          totalSpending: Math.round(
            historicalData.totalSpending ??
              (historicalData.patterns || []).reduce(
                (sum: number, p: any) => sum + (p.avgMonthlySpend || 0),
                0
              )
          ),
          savingsRate: historicalData.savingsRate ?? 0,
          volatility: historicalData.volatility ?? 0,
          monthsAnalyzed:
            historicalData.monthsAnalyzed ?? historicalData.months ?? 0,
          categoryCount:
            historicalData.categoryCount ??
            (historicalData.patterns ? historicalData.patterns.length : 0),
          monthlyTotals: historicalData.monthlyTotals,
          categoryVolatility: historicalData.categoryVolatility,
        }
      : undefined;

    // === PHASE 8: ALTERNATIVES ===
    const alternatives: BudgetRatio[] = [
      { needs: 0.5, wants: 0.3, savings: 0.2 }, // Classic 50/30/20
      { needs: 0.55, wants: 0.25, savings: 0.2 }, // Conservative
      { needs: 0.45, wants: 0.35, savings: 0.2 }, // Balanced
    ];

    const elapsedMs = Date.now() - startTime;
    console.log(
      `[SmartBudget] Generated in ${elapsedMs}ms (source: ${source}, ML: ${mlModelUsed})`
    );

    return {
      ratio,
      categories: allocated,
      insights,
      alternatives,
      mlModelUsed,
      modelConfidence,
      modelVersion,
      confidence,
      metadata: {
        source: mlModelUsed ? "tflite-model" : source,
        historicalAccuracy: historicalData
          ? historicalData.savingsRate
          : undefined,
        riskScore: mlPrediction?.riskScore,
        deviation,
        historicalSummary,
      },
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
