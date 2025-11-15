// budgetSuggestion.ts – ML-powered budget allocation suggestions
import { createCategory, listCategories } from "./categoryRepo";
import { categoryBreakdown } from "./transactionRepo";

export type CategoryAllocation = {
  categoryId: string;
  categoryName: string;
  groupType: "needs" | "wants" | "savings";
  allocatedAmount: number;
};

/**
 * Analyze transaction history and suggest budget allocations based on 50/30/20 rule:
 * - 50% Needs (essential expenses)
 * - 30% Wants (discretionary spending)
 * - 20% Savings/Debt
 */
export async function generateBudgetSuggestion(params: {
  totalIncome: number;
  period: "daily" | "weekly" | "monthly";
  lifestyleDesc?: string;
  historyMonths?: number;
}): Promise<{
  needs: CategoryAllocation[];
  wants: CategoryAllocation[];
  savings: CategoryAllocation[];
  totalAllocated: number;
}> {
  const { totalIncome, historyMonths = 3 } = params;

  // 50/30/20 baseline
  const needsBudget = Math.round(totalIncome * 0.5);
  const wantsBudget = Math.round(totalIncome * 0.3);
  const savingsBudget = Math.round(totalIncome * 0.2);

  // Fetch transaction history
  const endSec = Math.floor(Date.now() / 1000);
  const startSec = endSec - historyMonths * 30 * 86400; // approximate months
  const breakdown = await categoryBreakdown(startSec, endSec, "expense");

  // Fetch all categories
  const allCategories = await listCategories({ type: "expense" });
  const categoryMap = new Map(
    allCategories.map((c) => [c.id, { name: c.name, icon: c.icon }])
  );

  // Classify categories into needs/wants based on historical spending and category names
  const needs: CategoryAllocation[] = [];
  const wants: CategoryAllocation[] = [];
  const savings: CategoryAllocation[] = [];

  // Essential categories (needs) - typically housing, food, utilities, health
  const needsKeywords = [
    "nhà",
    "điện",
    "nước",
    "thức ăn",
    "đồ uống",
    "sức khỏe",
    "giáo dục",
    "di chuyển",
    "wifi",
    "4g",
  ];
  const wantsKeywords = [
    "mua sắm",
    "giải trí",
    "cafe",
    "quà",
    "đám tiệc",
    "mỹ phẩm",
    "hớt tóc",
  ];
  const savingsKeywords = ["tiết kiệm", "đầu tư"];

  // Calculate total historical spending
  const totalSpent = breakdown.reduce((sum, b) => sum + b.total, 0);

  // Distribute budget proportionally to historical spending patterns
  for (const item of breakdown) {
    if (!item.category_id) continue;
    const catInfo = categoryMap.get(item.category_id);
    if (!catInfo) continue;

    const categoryName = catInfo.name.toLowerCase();
    const proportion = totalSpent > 0 ? item.total / totalSpent : 0;

    let groupType: "needs" | "wants" | "savings" = "wants";
    if (
      needsKeywords.some((kw) => categoryName.includes(kw)) ||
      proportion > 0.1
    ) {
      // High proportion or essential keyword
      groupType = "needs";
    } else if (savingsKeywords.some((kw) => categoryName.includes(kw))) {
      groupType = "savings";
    } else if (wantsKeywords.some((kw) => categoryName.includes(kw))) {
      groupType = "wants";
    }

    const allocation: CategoryAllocation = {
      categoryId: item.category_id,
      categoryName: catInfo.name,
      groupType,
      allocatedAmount: 0, // will be assigned below
    };

    if (groupType === "needs") needs.push(allocation);
    else if (groupType === "wants") wants.push(allocation);
    else savings.push(allocation);
  }

  // Distribute budget within each group based on historical proportions
  const distributeGroup = (
    group: CategoryAllocation[],
    totalBudget: number
  ) => {
    const groupTotal = group.reduce((sum, a) => {
      const histItem = breakdown.find((b) => b.category_id === a.categoryId);
      return sum + (histItem?.total ?? 0);
    }, 0);

    for (const alloc of group) {
      const histItem = breakdown.find(
        (b) => b.category_id === alloc.categoryId
      );
      const histSpent = histItem?.total ?? 0;
      alloc.allocatedAmount =
        groupTotal > 0
          ? Math.round((histSpent / groupTotal) * totalBudget)
          : Math.round(totalBudget / group.length);
    }

    // Balance to exact total
    const allocated = group.reduce((sum, a) => sum + a.allocatedAmount, 0);
    if (group.length > 0) {
      group[0].allocatedAmount += totalBudget - allocated;
    }
  };

  distributeGroup(needs, needsBudget);
  distributeGroup(wants, wantsBudget);
  distributeGroup(savings, savingsBudget);

  // If no historical data, add default categories
  if (needs.length === 0) {
    needs.push({
      categoryId: await getOrCreateCategoryId("Thức ăn & Đồ uống"),
      categoryName: "Thức ăn & Đồ uống",
      groupType: "needs",
      allocatedAmount: Math.round(needsBudget * 0.4),
    });
    needs.push({
      categoryId: await getOrCreateCategoryId("Nhà"),
      categoryName: "Nhà",
      groupType: "needs",
      allocatedAmount: Math.round(needsBudget * 0.6),
    });
  }

  if (wants.length === 0) {
    wants.push({
      categoryId: await getOrCreateCategoryId("Mua sắm"),
      categoryName: "Mua sắm",
      groupType: "wants",
      allocatedAmount: wantsBudget,
    });
  }

  if (savings.length === 0) {
    savings.push({
      categoryId: await getOrCreateCategoryId("Tiết kiệm"),
      categoryName: "Tiết kiệm",
      groupType: "savings",
      allocatedAmount: savingsBudget,
    });
  }

  const totalAllocated = totalIncome;
  return { needs, wants, savings, totalAllocated };
}

async function getOrCreateCategoryId(name: string): Promise<string> {
  try {
    const cats = await listCategories({ type: "expense" });
    const existing = cats.find(
      (c) => c.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) return existing.id;

    // Create category if it doesn't exist
    const iconMap: Record<string, string> = {
      "thức ăn & đồ uống": "mc:food",
      nhà: "mc:home-outline",
      "mua sắm": "mc:cart-outline",
      "tiết kiệm": "mc:piggy-bank",
    };

    const colorMap: Record<string, string> = {
      "thức ăn & đồ uống": "#F6C33E",
      nhà: "#3A78D0",
      "mua sắm": "#7AC15B",
      "tiết kiệm": "#16A34A",
    };

    const lowerName = name.toLowerCase();
    const icon = iconMap[lowerName] || "mc:help-circle-outline";
    const color = colorMap[lowerName] || "#7EC5E8";

    const newId = await createCategory({
      name,
      type: "expense",
      icon,
      color,
    });

    return newId;
  } catch (error) {
    console.error("Error in getOrCreateCategoryId:", error);
    // Return a fallback category ID if creation fails
    const cats = await listCategories({ type: "expense" });
    if (cats.length > 0) {
      return cats[0].id; // Return first available category as fallback
    }
    throw new Error("Cannot create or find any category");
  }
}
