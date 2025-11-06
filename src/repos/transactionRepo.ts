import { db, openDb } from "../db";

export type TxDetailRow = {
  id: string;
  amount: number;
  note: string | null;
  occurred_at: number;
  updated_at: number;
  account_name: string;
  category_name: string | null;
  category_icon: string | null;
};

export async function totalInRange(
  startSec: number,
  endSec: number,
  type: "expense" | "income"
) {
  await openDb();
  const row = await db.getFirstAsync<{ sum: number }>(
    `SELECT COALESCE(SUM(amount),0) AS sum
     FROM transactions
     WHERE user_id='u_demo' AND type=? AND occurred_at>=? AND occurred_at<?`,
    [type, startSec, endSec]
  );
  return row?.sum ?? 0;
}

export async function categoryBreakdown(
  startSec: number,
  endSec: number,
  type: "expense" | "income"
) {
  await openDb();
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
    WHERE t.user_id='u_demo'
      AND t.type=?
      AND t.occurred_at>=? AND t.occurred_at<?
    GROUP BY c.id
    HAVING total IS NOT NULL
    ORDER BY total DESC
  `,
    [type, startSec, endSec]
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
  const userId = "u_demo";
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
  const id = `tx_${Math.random().toString(36).slice(2)}`;
  const occurred = Math.floor(when.getTime() / 1000);
  const updated = Math.floor(updatedAt.getTime() / 1000);
  console.log(updated);
  await db.runAsync(
    `INSERT INTO transactions
      (id,user_id,account_id,category_id,type,amount,note,occurred_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    [
      id,
      "u_demo",
      accountId,
      categoryId,
      "expense",
      amount,
      note ?? null,
      occurred,
      updated,
    ]
  );
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
  const id = `tx_${Math.random().toString(36).slice(2)}`;
  const occurred = Math.floor(when.getTime() / 1000);
  const updated = Math.floor(updatedAt.getTime() / 1000);

  await db.runAsync(
    `INSERT INTO transactions
      (id,user_id,account_id,category_id,type,amount,note,occurred_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    [
      id,
      "u_demo",
      accountId,
      categoryId,
      "income",
      amount,
      note ?? null,
      occurred,
      updated,
    ]
  );
  return id;
}

export async function listByDay(day: Date) {
  await openDb();
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const s = Math.floor(start.getTime() / 1000);
  const e = s + 86400;
  return db.getAllAsync<any>(
    `
    SELECT t.*, a.name account_name, c.name category_name, c.icon category_icon
    FROM transactions t
    JOIN accounts a ON a.id=t.account_id
    LEFT JOIN categories c ON c.id=t.category_id
    WHERE t.user_id='u_demo' AND t.occurred_at>=? AND t.occurred_at<?
    ORDER BY t.occurred_at DESC
  `,
    [s, e]
  );
}

export async function listTxByCategory(params: {
  userId?: string;
  categoryId?: string;
  categoryName?: string;
  fromSec?: number;
  toSec?: number;
}): Promise<TxDetailRow[]> {
  const {
    userId = "u_demo",
    categoryId,
    categoryName,
    fromSec,
    toSec,
  } = params;

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
           c.icon AS category_icon
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    ${whereSql}
    ORDER BY t.occurred_at DESC
    `,
    args
  );
}

export async function deleteTx(id: string, userId = "u_demo") {
  await openDb();
  await db.runAsync(`DELETE FROM transactions WHERE id=? AND user_id=?`, [
    id,
    userId,
  ]);
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
     WHERE id=? AND user_id='u_demo'`,
    [accountId, categoryId, type, amount, note ?? null, occurred, updated, id]
  );
  return id;
}

export async function getTxById(id: string) {
  await openDb();
  return db.getFirstAsync<{
    id: string;
    amount: number;
    note: string | null;
    occurred_at: number;
    updated_at: number | null;
    account_name: string;
    category_name: string | null;
  }>(
    `
    SELECT t.id,
           t.amount,
           t.note,
           t.occurred_at,
           t.updated_at,
           a.name AS account_name,
           c.name AS category_name
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.user_id='u_demo' AND t.id=?
    `,
    [id]
  );
}
