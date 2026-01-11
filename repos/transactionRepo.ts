import { db, openDb } from "@/db";
import { scheduleSyncDebounced } from "@/services/syncTrigger";
import { transactionClassifier } from "@/services/transactionClassifier";
import { getCurrentUserId } from "@/utils/auth";

export type TxDetailRow = {
  id: string;
  amount: number;
  note: string | null;
  occurred_at: number;
  updated_at: number;
  account_name: string;
  category_id: string | null;
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
  type?: "expense" | "income";
};

export async function totalInRange(
  startSec: number,
  endSec: number,
  type: "expense" | "income"
) {
  await openDb();
  const userId = await getCurrentUserId();
  // Guest mode check removed

  const row = await db.getFirstAsync<{ sum: number }>(
    `SELECT COALESCE(SUM(amount),0) AS sum
     FROM transactions
     WHERE user_id=? AND type=? AND occurred_at>=? AND occurred_at<?`,
    [userId, type, startSec, endSec]
  );
  return row?.sum ?? 0;
}

// Compute total assets by summing transactions per account (income +, expense -)
// Only accounts with include_in_total=1 are counted. This derives the total directly
// Get total assets from account balances (which are computed from transactions)
export async function totalAssetsFromTransactions(): Promise<number> {
  await openDb();
  const userId = await getCurrentUserId();
  const row = await db.getFirstAsync<{ total: number }>(
    `
    SELECT COALESCE(SUM(balance_cached), 0) AS total
    FROM accounts
    WHERE user_id=? AND include_in_total=1
  `,
    [userId]
  );
  return row?.total ?? 0;
}

export async function categoryBreakdown(
  startSec: number,
  endSec: number,
  type: "expense" | "income"
) {
  await openDb();
  const userId = await getCurrentUserId();
  // Guest mode check removed

  return db.getAllAsync<{
    category_id: string | null;
    name: string | null;
    color: string | null;
    icon: string | null;
    total: number;
  }>(
    `
    SELECT c.id AS category_id, c.name, c.color, c.icon,
           SUM(t.amount) AS total
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.user_id=?
      AND t.type=?
      AND t.occurred_at>=? AND t.occurred_at<?
    GROUP BY c.id
    HAVING total IS NOT NULL
    ORDER BY total DESC
  `,
    [userId, type, startSec, endSec]
  );
}

export async function seedSampleMonthRandom({
  year,
  month,
  count = 20, // số giao dịch muốn thêm
}: {
  year: number;
  month: number;
  count?: number;
}) {
  const db = await openDb();
  const userId = await getCurrentUserId();
  // Guest mode check removed
  const accountId = "acc_bank";

  // danh mục mẫu
  const categories = [
    { id: "cat_4g", type: "expense", label: "4G" },
    { id: "cat_electric", type: "expense", label: "Điện" },
    { id: "cat_grocery", type: "expense", label: "Tạp phẩm" },
    { id: "cat_party", type: "expense", label: "Đám tiệc" },
    { id: "cat_salary", type: "income", label: "Lương" },
  ];

  await db.execAsync("BEGIN");
  try {
    const rand = (min: number, max: number) =>
      Math.floor(Math.random() * (max - min + 1)) + min;

    for (let i = 0; i < count; i++) {
      const cat = categories[rand(0, categories.length - 1)];
      const day = rand(1, 28); // ngày 1-28 để an toàn
      const amount =
        cat.type === "income"
          ? rand(2_000_000, 15_000_000)
          : rand(50_000, 900_000);

      const note =
        cat.type === "income"
          ? `Nhận ${cat.label} (${day}/${month + 1})`
          : `Chi ${cat.label} (${day}/${month + 1})`;

      const occurred_at = Math.floor(
        new Date(year, month, day).getTime() / 1000
      );
      const id = `tx_${Math.random().toString(36).slice(2, 8)}`;

      await db.runAsync(
        `INSERT INTO transactions(id,user_id,account_id,category_id,type,amount,note,occurred_at)
         VALUES(?,?,?,?,?,?,?,?)`,
        [id, userId, accountId, cat.id, cat.type, amount, note, occurred_at]
      );
    }

    await db.execAsync("COMMIT");
  } catch (e) {
    await db.execAsync("ROLLBACK");
    console.error("❌ Seed random lỗi:", e);
  }
}

export async function addExpense({
  accountId,
  categoryId,
  amount,
  note,
  when,
  updatedAt,
}: {
  accountId: string;
  categoryId: string;
  amount: number;
  note?: string;
  when: Date;
  updatedAt: Date;
}) {
  await openDb();
  const userId = await getCurrentUserId();
  // Guest mode check removed

  const id = `tx_${Math.random().toString(36).slice(2)}`;
  const occurred = Math.floor(when.getTime() / 1000);
  const updated = Math.floor(updatedAt.getTime() / 1000);
  await db.runAsync(
    `INSERT INTO transactions
      (id,user_id,account_id,category_id,type,amount,note,occurred_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    [
      id,
      userId,
      accountId,
      categoryId,
      "expense",
      amount,
      note ?? null,
      occurred,
      updated,
    ]
  );

  // Auto-train AI model with new transaction
  if (note && note.trim()) {
    transactionClassifier
      .learnFromNewTransaction(note, categoryId)
      .catch((err) => {
        console.error("Failed to update AI model:", err);
      });
  }

  // Check budget alert for this category
  import("@/services/smartNotificationService")
    .then(({ checkBudgetAlert }) => checkBudgetAlert(categoryId, amount))
    .catch((err) => console.error("Budget alert check failed:", err));

  // schedule debounced sync
  try {
    scheduleSyncDebounced(userId);
  } catch (e) {
    scheduleSyncDebounced();
  }

  return id;
}

export async function addIncome({
  accountId,
  categoryId,
  amount,
  note,
  when,
  updatedAt,
}: {
  accountId: string;
  categoryId: string;
  amount: number;
  note?: string;
  when: Date;
  updatedAt: Date;
}) {
  await openDb();
  const userId = await getCurrentUserId();
  // Guest mode check removed

  const id = `tx_${Math.random().toString(36).slice(2)}`;
  const occurred = Math.floor(when.getTime() / 1000);
  const updated = Math.floor(updatedAt.getTime() / 1000);

  await db.runAsync(
    `INSERT INTO transactions
      (id,user_id,account_id,category_id,type,amount,note,occurred_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    [
      id,
      userId,
      accountId,
      categoryId,
      "income",
      amount,
      note ?? null,
      occurred,
      updated,
    ]
  );

  // Auto-train AI model with new transaction (income)
  if (note && note.trim()) {
    transactionClassifier
      .learnFromNewTransaction(note, categoryId)
      .catch((err) => {
        console.error("Failed to update AI model:", err);
      });
  }

  try {
    scheduleSyncDebounced(userId);
  } catch (e) {
    scheduleSyncDebounced();
  }

  return id;
}

export async function listByDay(day: Date) {
  await openDb();
  const userId = await getCurrentUserId();
  // Guest mode check removed

  const start = new Date(day);
  if (!isFinite(start.getTime())) return []; // ⬅️ guard

  start.setHours(0, 0, 0, 0);
  const s = Math.floor(start.getTime() / 1000);
  const e = s + 86400;

  try {
    return await db.getAllAsync<any>(
      `
      SELECT t.*, a.name account_name, c.name category_name, c.icon category_icon, c.color category_color
      FROM transactions t
      JOIN accounts a ON a.id=t.account_id
      LEFT JOIN categories c ON c.id=t.category_id
      WHERE t.user_id=? AND t.occurred_at>=? AND t.occurred_at<?
      ORDER BY t.occurred_at DESC
      `,
      [userId, s, e] // ⬅️ đảm bảo luôn là số
    );
  } catch (err) {
    console.warn("listByDay error", err, { s, e }); // ⬅️ log để debug
    return [];
  }
}

export async function listTxByCategory(params: {
  userId?: string;
  categoryId?: string;
  categoryName?: string;
  fromSec?: number;
  toSec?: number;
}): Promise<TxDetailRow[]> {
  let { userId, categoryId, categoryName, fromSec, toSec } = params;

  // If userId not provided, get current user
  if (!userId) {
    userId = (await getCurrentUserId()) || undefined;
    // Guest mode check removed
  }

  if (!categoryId && !categoryName) {
    throw new Error("listTxByCategory: cần categoryId hoặc categoryName");
  }

  await openDb();

  // Xây WHERE động
  const whereParts = [`t.user_id=?`];
  const args: any[] = [userId];

  if (categoryId) {
    whereParts.push(`c.id=?`);
    args.push(categoryId);
  } else if (categoryName) {
    whereParts.push(`c.name=?`);
    args.push(categoryName);
  }

  if (typeof fromSec === "number") {
    whereParts.push(`t.occurred_at>=?`);
    args.push(fromSec);
  }
  if (typeof toSec === "number") {
    whereParts.push(`t.occurred_at<?`);
    args.push(toSec);
  }

  const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  return db.getAllAsync<TxDetailRow>(
    `
    SELECT t.id,
           t.amount,
           t.note,
           t.occurred_at,
           t.updated_at,
           a.name AS account_name,
           c.name AS category_name,
           c.icon AS category_icon,
           c.color AS category_color
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    ${whereSql}
    ORDER BY t.occurred_at DESC
    `,
    args
  );
}

export async function deleteTx(id: string, userId?: string) {
  await openDb();
  if (!userId) {
    userId = (await getCurrentUserId()) || undefined;
    // Guest mode check removed
  }
  await db.runAsync(`DELETE FROM transactions WHERE id=? AND user_id=?`, [
    id,
    userId,
  ]);
  try {
    scheduleSyncDebounced(userId as string);
  } catch (e) {
    scheduleSyncDebounced();
  }
  // mark remote tombstone
  try {
    const s = await import("@/services/firestoreSync");
    s.markRemoteDeleted("transactions", id, userId as string).catch((e) =>
      console.warn(e)
    );
  } catch (e) {
    // ignore
  }
}

export async function updateTransaction({
  id,
  accountId,
  categoryId,
  type, // "expense" | "income"
  amount,
  note,
  when, // Date
}: {
  id: string;
  accountId: string;
  categoryId: string | null;
  type: "expense" | "income";
  amount: number;
  note?: string | null;
  when: Date;
}) {
  await openDb();
  const userId = await getCurrentUserId();
  // Guest mode check removed

  const occurred = Math.floor(when.getTime() / 1000);
  const updated = Math.floor(Date.now() / 1000);

  await db.runAsync(
    `UPDATE transactions
       SET account_id=?,
           category_id=?,
           type=?,
           amount=?,
           note=?,
           occurred_at=?,
           updated_at=?
     WHERE id=? AND user_id=?`,
    [
      accountId,
      categoryId,
      type,
      amount,
      note ?? null,
      occurred,
      updated,
      id,
      userId,
    ]
  );

  // Auto-train AI with corrected transaction (WAIT for completion)
  if (note && note.trim() && categoryId) {
    try {
      await transactionClassifier.learnFromCorrection(note, categoryId);
      console.log("✅ AI updated successfully after transaction edit");
    } catch (err: any) {
      console.error("❌ Failed to update AI after transaction edit:", err);
    }
  }

  try {
    scheduleSyncDebounced(userId);
  } catch (e) {
    scheduleSyncDebounced();
  }

  return id;
}

export async function getTxById(id: string) {
  await openDb();
  const userId = await getCurrentUserId();
  // Guest mode check removed

  return db.getFirstAsync<{
    id: string;
    amount: number;
    note: string | null;
    occurred_at: number;
    updated_at: number | null;
    account_id: string;
    account_name: string;
    category_id: string | null;
    category_name: string | null;
    category_icon: string | null;
    category_color: string | null;
    type: "expense" | "income";
  }>(
    `
    SELECT t.id,
           t.amount,
           t.note,
           t.occurred_at,
           t.updated_at,
           t.account_id,
           t.category_id,
           t.type,
           a.name AS account_name,
           c.name AS category_name,
           c.icon AS category_icon,
           c.color AS category_color
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.user_id=? AND t.id=?
    `,
    [userId, id]
  );
}

export async function listBetween(
  fromSec: number,
  toSec: number
): Promise<TxDetailRow[]> {
  await openDb();
  const userId = await getCurrentUserId();
  // Guest mode check removed

  return db.getAllAsync<TxDetailRow>(
    `
    SELECT t.id, t.amount, t.note, t.occurred_at, t.updated_at, t.type,
           a.name AS account_name,
           t.category_id,
           c.name AS category_name,
           c.icon AS category_icon,
           c.color AS category_color
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.user_id=?
      AND t.occurred_at>=? AND t.occurred_at<?
    ORDER BY t.occurred_at DESC
    `,
    [userId, fromSec, toSec]
  );
}

export async function listRecent(
  limit: number,
  offset: number = 0
): Promise<TxDetailRow[]> {
  await openDb();
  const userId = await getCurrentUserId();

  return db.getAllAsync<TxDetailRow>(
    `
    SELECT t.id, t.amount, t.note, t.occurred_at, t.updated_at, t.type,
           a.name AS account_name,
           t.category_id,
           c.name AS category_name,
           c.icon AS category_icon,
           c.color AS category_color
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.user_id=?
    ORDER BY t.occurred_at DESC
    LIMIT ? OFFSET ?
    `,
    [userId, limit, offset]
  );
}
