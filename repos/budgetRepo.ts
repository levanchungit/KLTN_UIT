// budgetRepo.ts
import { db, openDb } from "@/db";
import { getCurrentUserId } from "@/utils/auth";
import { categoryBreakdown } from "./transactionRepo";

export type Budget = {
  id: string;
  user_id: string;
  name: string;
  total_income: number;
  period: "daily" | "weekly" | "monthly";
  lifestyle_desc: string | null;
  start_date: number; // unix sec
  end_date: number | null; // unix sec
  created_at: number;
  updated_at: number | null;
};

export type BudgetAllocation = {
  id: string;
  budget_id: string;
  category_id: string;
  category_name?: string;
  category_icon?: string;
  category_color?: string;
  group_type: "needs" | "wants" | "savings";
  allocated_amount: number;
  spent_amount?: number; // computed on-the-fly
  created_at: number;
};

function genId(prefix: string) {
  return prefix + "_" + Math.random().toString(36).slice(2, 10);
}

/** ===== Budget CRUD ===== */
export async function createBudget(input: {
  name: string;
  totalIncome: number;
  period: "daily" | "weekly" | "monthly";
  lifestyleDesc?: string;
  startDate: Date;
  endDate?: Date;
  allocations: Array<{
    categoryId: string;
    groupType: "needs" | "wants" | "savings";
    allocatedAmount: number;
  }>;
}): Promise<string> {
  await openDb();
  const userId = await getCurrentUserId();

  const budgetId = genId("budget");
  const startSec = Math.floor(input.startDate.getTime() / 1000);
  const endSec = input.endDate
    ? Math.floor(input.endDate.getTime() / 1000)
    : null;
  const now = Math.floor(Date.now() / 1000);

  await db.runAsync(
    `INSERT INTO budgets(
      id, user_id, name, total_income, period, lifestyle_desc, start_date, end_date, created_at, updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    // @ts-ignore
    [
      budgetId,
      userId,
      input.name,
      input.totalIncome,
      input.period,
      input.lifestyleDesc ?? null,
      startSec,
      endSec,
      now,
      now,
    ] as any
  );

  // Insert allocations
  for (const alloc of input.allocations) {
    // Verify category exists before inserting
    const categoryCheck = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM categories WHERE id=?`,
      [alloc.categoryId] as any
    );

    if (!categoryCheck) {
      console.warn(
        `Category ${alloc.categoryId} not found, skipping allocation`
      );
      continue;
    }

    const allocId = genId("alloc");
    await db.runAsync(
      `INSERT INTO budget_allocations(
        id, budget_id, category_id, group_type, allocated_amount, created_at
      ) VALUES(?,?,?,?,?,?)`,
      // @ts-ignore
      [
        allocId,
        budgetId,
        alloc.categoryId,
        alloc.groupType,
        alloc.allocatedAmount,
        now,
      ] as any
    );
  }

  // Trigger immediate alerts in case existing spending already crosses thresholds
  try {
    const { triggerBudgetAlertsForBudget } = await import(
      "@/services/smartNotificationService"
    );
    await triggerBudgetAlertsForBudget(budgetId);
  } catch (err) {
    console.error("Failed to trigger budget alerts after creation:", err);
  }

  return budgetId;
}

export async function listBudgets(userId?: string): Promise<Budget[]> {
  await openDb();
  if (!userId) {
    userId = await getCurrentUserId();
  }
  // @ts-ignore
  return db.getAllAsync<Budget>(
    `SELECT * FROM budgets WHERE user_id=? ORDER BY created_at DESC`,
    [userId] as any
  );
}

export async function getBudgetById(
  id: string,
  userId?: string
): Promise<Budget | undefined> {
  await openDb();
  if (!userId) {
    userId = await getCurrentUserId();
  }
  // @ts-ignore
  return db.getFirstAsync<Budget>(
    `SELECT * FROM budgets WHERE id=? AND user_id=?`,
    [id, userId] as any
  );
}

export async function listBudgetAllocations(
  budgetId: string
): Promise<BudgetAllocation[]> {
  await openDb();
  // @ts-ignore
  const rows = await db.getAllAsync<BudgetAllocation>(
    `SELECT ba.id, ba.budget_id, ba.category_id, ba.group_type, ba.allocated_amount, ba.created_at,
            c.name as category_name, c.icon as category_icon, c.color as category_color
     FROM budget_allocations ba
     JOIN categories c ON c.id = ba.category_id
     WHERE ba.budget_id=?
     ORDER BY ba.group_type, c.name`,
    [budgetId] as any
  );
  return rows;
}

export async function deleteBudget(id: string, userId?: string) {
  await openDb();
  if (!userId) {
    userId = await getCurrentUserId();
  }
  // @ts-ignore
  await db.runAsync(`DELETE FROM budgets WHERE id=? AND user_id=?`, [
    id,
    userId,
  ] as any);
}

export async function updateBudget(input: {
  id: string;
  name: string;
  totalIncome: number;
  period: "daily" | "weekly" | "monthly";
  lifestyleDesc?: string;
  startDate: Date;
  endDate?: Date;
  allocations: Array<{
    categoryId: string;
    groupType: "needs" | "wants" | "savings";
    allocatedAmount: number;
  }>;
}): Promise<void> {
  await openDb();
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error("USER_NOT_LOGGED_IN");
  }

  const startSec = Math.floor(input.startDate.getTime() / 1000);
  const endSec = input.endDate
    ? Math.floor(input.endDate.getTime() / 1000)
    : null;

  // Update budget
  // @ts-ignore
  await db.runAsync(
    `UPDATE budgets 
     SET name=?, total_income=?, period=?, lifestyle_desc=?, start_date=?, end_date=?, updated_at=?
     WHERE id=? AND user_id=?`,
    [
      input.name,
      input.totalIncome,
      input.period,
      input.lifestyleDesc ?? null,
      startSec,
      endSec,
      Math.floor(Date.now() / 1000),
      input.id,
      userId,
    ] as any
  );

  // Delete old allocations
  // @ts-ignore
  await db.runAsync(`DELETE FROM budget_allocations WHERE budget_id=?`, [
    input.id,
  ] as any);

  // Insert new allocations
  for (const alloc of input.allocations) {
    // Verify category exists before inserting
    const categoryCheck = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM categories WHERE id=?`,
      [alloc.categoryId] as any
    );

    if (!categoryCheck) {
      console.warn(
        `Category ${alloc.categoryId} not found, skipping allocation in update`
      );
      continue;
    }

    const allocId = genId("alloc");
    // @ts-ignore
    await db.runAsync(
      `INSERT INTO budget_allocations (id, budget_id, category_id, group_type, allocated_amount, created_at)
       VALUES (?,?,?,?,?,?)`,
      [
        allocId,
        input.id,
        alloc.categoryId,
        alloc.groupType,
        alloc.allocatedAmount,
        Math.floor(Date.now() / 1000),
      ] as any
    );
  }

  // Trigger immediate budget alerts for updated allocations (no anti-spam)
  try {
    const { triggerBudgetAlertsForBudget } = await import(
      "@/services/smartNotificationService"
    );
    await triggerBudgetAlertsForBudget(input.id);
  } catch (err) {
    console.error("Failed to trigger budget alerts after update:", err);
  }
}

/** ===== Budget analysis ===== */
export async function computeBudgetProgress(
  budgetId: string,
  userId?: string
): Promise<{
  budget: Budget;
  allocations: Array<
    BudgetAllocation & {
      spent_amount: number;
      percent: number;
      exceeded: boolean;
    }
  >;
  totalAllocated: number;
  totalSpent: number;
}> {
  if (!userId) {
    userId = await getCurrentUserId();
  }

  const budget = await getBudgetById(budgetId, userId);
  if (!budget) throw new Error("Budget not found");

  const allocations = await listBudgetAllocations(budgetId);

  // Compute period bounds for spending
  const startSec = budget.start_date;
  const endSec = budget.end_date ?? Math.floor(Date.now() / 1000);

  // Compute spending per category
  const breakdown = await categoryBreakdown(startSec, endSec, "expense");
  const spendingMap = new Map(
    breakdown.map((b) => [b.category_id ?? "null", b.total])
  );

  let totalAllocated = 0;
  let totalSpent = 0;
  const enhanced = allocations.map((alloc) => {
    const spent = spendingMap.get(alloc.category_id) ?? 0;
    totalAllocated += alloc.allocated_amount;
    totalSpent += spent;
    const percent =
      alloc.allocated_amount > 0
        ? Math.round((spent / alloc.allocated_amount) * 100)
        : 0;
    const exceeded = spent > alloc.allocated_amount;
    return { ...alloc, spent_amount: spent, percent, exceeded };
  });

  return { budget, allocations: enhanced, totalAllocated, totalSpent };
}

/** ===== Active budget ===== */
export async function getActiveBudget(
  userId?: string
): Promise<Budget | undefined> {
  await openDb();
  if (!userId) {
    userId = await getCurrentUserId();
  }

  const now = Math.floor(Date.now() / 1000);
  // @ts-ignore
  return db.getFirstAsync<Budget>(
    `SELECT * FROM budgets
     WHERE user_id=?
       AND start_date <= ?
       AND (end_date IS NULL OR end_date >= ?)
     ORDER BY start_date DESC
     LIMIT 1`,
    [userId, now, now] as any
  );
}
