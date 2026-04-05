import { openDb } from "@/db";
import { scheduleSyncDebounced } from "@/services/syncTrigger";
import { refreshWidgetSilent } from "@/services/widgetService";
import { getCurrentUserId } from "@/utils/auth";

export type Account = {
  id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  balance_cached: number;
  include_in_total: 0 | 1;
  created_at?: number;
};

const genId = () => "acc_" + Math.random().toString(36).slice(2, 10);

export async function listAccounts(): Promise<Account[]> {
  const db = await openDb();
  const userId = await getCurrentUserId();
  return db.getAllAsync<Account>(
    `SELECT id,name,icon,color,balance_cached,include_in_total,created_at
     FROM accounts WHERE user_id=? ORDER BY created_at ASC`,
    [userId]
  );
}

export async function getAccountById(id: string) {
  const db = await openDb();
  const userId = await getCurrentUserId();
  // chọn thêm created_at để xác định default theo thời gian tạo
  return db.getFirstAsync<Account>(
    `SELECT id,name,icon,color,balance_cached,include_in_total,created_at
     FROM accounts WHERE id=? AND user_id=?`,
    [id, userId]
  );
}

export async function createAccount(input: {
  name: string;
  icon?: string | null;
  color?: string | null;
  includeInTotal: boolean;
  balance: number;
}) {
  const db = await openDb();
  const userId = await getCurrentUserId();
  const id = genId();
  await db.runAsync(
    `INSERT INTO accounts(id,user_id,name,icon,color,include_in_total,balance_cached,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?, strftime('%s','now'), strftime('%s','now'))`,
    [
      id,
      userId,
      input.name.trim(),
      input.icon ?? null,
      input.color ?? null,
      input.includeInTotal ? 1 : 0,
      Math.trunc(input.balance) || 0,
    ]
  );
  
  // ⚡ PERFORMANCE: Invalidate cache after creating account
  const { invalidateAccountsCache } = await import("@/services/cacheService");
  invalidateAccountsCache();
  
  try {
    scheduleSyncDebounced(userId ?? undefined);
  } catch (e) {
    scheduleSyncDebounced();
  }
  // Refresh widget balance
  refreshWidgetSilent();
  return id;
}

export async function updateAccount(
  id: string,
  input: {
    name?: string;
    icon?: string | null;
    color?: string | null;
    includeInTotal?: boolean;
    balance?: number;
  }
) {
  const db = await openDb();
  const userId = await getCurrentUserId();

  const set: string[] = [];
  const vals: any[] = [];

  if (input.name != null) {
    set.push("name=?");
    vals.push(input.name.trim());
  }
  if (input.icon !== undefined) {
    set.push("icon=?");
    vals.push(input.icon ?? null);
  }
  if (input.color !== undefined) {
    set.push("color=?");
    vals.push(input.color ?? null);
  }
  if (input.includeInTotal != null) {
    set.push("include_in_total=?");
    vals.push(input.includeInTotal ? 1 : 0);
  }
  if (input.balance != null) {
    set.push("balance_cached=?");
    vals.push(Math.trunc(input.balance));
  }

  set.push("updated_at=strftime('%s','now')");

  await db.runAsync(
    `UPDATE accounts SET ${set.join(",")} WHERE id=? AND user_id=?`,
    [...vals, id, userId]
  );
  
  // ⚡ PERFORMANCE: Invalidate cache after updating account
  const { invalidateAccountsCache } = await import("@/services/cacheService");
  invalidateAccountsCache();
  
  try {
    scheduleSyncDebounced(userId ?? undefined);
  } catch (e) {
    scheduleSyncDebounced();
  }
  // Refresh widget balance
  refreshWidgetSilent();
}

// ===== Helpers cho xoá với luật "mặc định không xoá" =====
export async function countAccounts(): Promise<number> {
  const db = await openDb();
  const userId = await getCurrentUserId();
  const row = await db.getFirstAsync<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM accounts WHERE user_id=?`,
    [userId]
  );
  return row?.cnt ?? 0;
}

export async function getDefaultAccountId(): Promise<string | null> {
  const db = await openDb();
  const userId = await getCurrentUserId();
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM accounts WHERE user_id=? ORDER BY created_at ASC LIMIT 1`,
    [userId]
  );
  return row?.id ?? null;
}

export async function isDefaultAccount(id: string): Promise<boolean> {
  const defId = await getDefaultAccountId();
  return defId === id;
}

export async function setDefaultAccount(id: string) {
  const db = await openDb();
  const userId = await getCurrentUserId();
  
  // Get current minimum created_at
  const row = await db.getFirstAsync<{ min_created_at: number }>(
    `SELECT MIN(created_at) as min_created_at FROM accounts WHERE user_id=?`,
    [userId]
  );
  
  let newCreatedAt = Date.now() / 1000;
  if (row && row.min_created_at != null) {
    newCreatedAt = row.min_created_at - 1;
  }
  
  await db.runAsync(
    `UPDATE accounts SET created_at=?, updated_at=strftime('%s','now') WHERE id=? AND user_id=?`,
    [newCreatedAt, id, userId]
  );
  
  const { invalidateAccountsCache } = await import("@/services/cacheService");
  invalidateAccountsCache();
  
  try {
    scheduleSyncDebounced(userId ?? undefined);
  } catch (e) {
    scheduleSyncDebounced();
  }
}

export async function deleteAccount(id: string) {
  const db = await openDb();
  const userId = await getCurrentUserId();

  // Không cho xoá nếu là tài khoản mặc định
  if (await isDefaultAccount(id)) {
    const err: any = new Error("DEFAULT_ACCOUNT");
    err.code = "DEFAULT_ACCOUNT";
    throw err;
  }

  // Tuỳ chính sách: có thể không cho xoá nếu chỉ còn 1 tài khoản
  const total = await countAccounts();
  if (total <= 1) {
    const err: any = new Error("LAST_ACCOUNT");
    err.code = "LAST_ACCOUNT";
    throw err;
  }

  // Xoá
  await db.runAsync(`DELETE FROM accounts WHERE id=? AND user_id=?`, [
    id,
    userId,
  ]);
  
  // ⚡ PERFORMANCE: Invalidate cache after deleting account
  const { invalidateAccountsCache } = await import("@/services/cacheService");
  invalidateAccountsCache();
  
  try {
    scheduleSyncDebounced(userId ?? undefined);
  } catch (e) {
    scheduleSyncDebounced();
  }
  // Refresh widget balance
  refreshWidgetSilent();
  try {
    const s = await import("@/services/firestoreSync");
    s.markRemoteDeleted("accounts", id, userId ?? undefined).catch((e) => console.warn(e));
  } catch (e) {
    // ignore if firestore not available
  }
  // Lưu ý FK: nếu có bảng giao dịch tham chiếu accounts mà không ON DELETE CASCADE,
  // thao tác có thể fail → khi đó cân nhắc dùng soft-delete hoặc báo lỗi người dùng.
}

/**
 * Chuyển tiền giữa hai ví trong cùng một tài khoản user.
 * Cả hai balance_cached được cập nhật trong một SQLite transaction.
 * @returns transfer record id
 */
export async function transferBetweenWallets({
  fromAccountId,
  toAccountId,
  amount,
  note,
  occurredAt,
}: {
  fromAccountId: string;
  toAccountId: string;
  amount: number; // phải > 0
  note?: string;
  occurredAt: Date;
}): Promise<string> {
  if (fromAccountId === toAccountId) {
    throw new Error("SAME_ACCOUNT");
  }
  if (amount <= 0) {
    throw new Error("INVALID_AMOUNT");
  }

  const db = await openDb();
  const userId = await getCurrentUserId();

  // Kiểm tra số dư ví nguồn
  const fromAcc = await db.getFirstAsync<Account>(
    `SELECT id, balance_cached FROM accounts WHERE id=? AND user_id=?`,
    [fromAccountId, userId]
  );
  if (!fromAcc) throw new Error("FROM_ACCOUNT_NOT_FOUND");
  if (fromAcc.balance_cached < amount) throw new Error("INSUFFICIENT_BALANCE");

  const toAcc = await db.getFirstAsync<Account>(
    `SELECT id FROM accounts WHERE id=? AND user_id=?`,
    [toAccountId, userId]
  );
  if (!toAcc) throw new Error("TO_ACCOUNT_NOT_FOUND");

  const transferId = "tr_" + Math.random().toString(36).slice(2, 10);
  const occurredSec = Math.floor(occurredAt.getTime() / 1000);
  const nowSec = Math.floor(Date.now() / 1000);

  // Thực hiện trong một transaction SQLite
  await db.withTransactionAsync(async () => {
    // Trừ tiền ví nguồn
    await db.runAsync(
      `UPDATE accounts SET balance_cached = balance_cached - ?, updated_at=? WHERE id=? AND user_id=?`,
      [Math.trunc(amount), nowSec, fromAccountId, userId]
    );
    // Cộng tiền ví đích
    await db.runAsync(
      `UPDATE accounts SET balance_cached = balance_cached + ?, updated_at=? WHERE id=? AND user_id=?`,
      [Math.trunc(amount), nowSec, toAccountId, userId]
    );
    // Ghi lịch sử chuyển tiền
    await db.runAsync(
      `INSERT INTO transactions(id,user_id,account_id,to_account_id,category_id,type,amount,note,occurred_at,updated_at)
       VALUES(?,?,?,?,NULL,'transfer',?,?,?,?)`,
      [
        transferId,
        userId,
        fromAccountId,
        toAccountId,
        Math.trunc(amount),
        note ?? null,
        occurredSec,
        nowSec,
      ]
    );
  });

  // Invalidate cache & sync
  const { invalidateAccountsCache } = await import("@/services/cacheService");
  invalidateAccountsCache();
  try {
    scheduleSyncDebounced(userId ?? undefined);
  } catch (e) {
    scheduleSyncDebounced();
  }
  refreshWidgetSilent();

  return transferId;
}

/** Lấy danh sách lịch sử chuyển tiền (type = 'transfer') */
export async function listTransfers(): Promise<
  {
    id: string;
    amount: number;
    note: string | null;
    occurred_at: number;
    from_account_id: string;
    from_account_name: string;
    to_account_id: string | null;
    to_account_name: string | null;
  }[]
> {
  const db = await openDb();
  const userId = await getCurrentUserId();
  return db.getAllAsync(
    `SELECT t.id, t.amount, t.note, t.occurred_at,
            t.account_id AS from_account_id,
            a.name AS from_account_name,
            t.to_account_id,
            a2.name AS to_account_name
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN accounts a2 ON a2.id = t.to_account_id
     WHERE t.user_id=? AND t.type='transfer'
     ORDER BY t.occurred_at DESC`,
    [userId]
  );
}

/** Xóa một lịch sử chuyển tiền và hoàn lại số dư cho 2 ví */
export async function deleteTransfer(id: string) {
  const db = await openDb();
  const userId = await getCurrentUserId();

  const tx = await db.getFirstAsync<any>(
    "SELECT id, amount, account_id, to_account_id FROM transactions WHERE id=? AND user_id=? AND type='transfer'",
    [id, userId]
  );
  if (!tx) throw new Error("TRANSFER_NOT_FOUND");

  const nowSec = Math.floor(Date.now() / 1000);

  await db.withTransactionAsync(async () => {
    // revert from account: cộng lại tiền cho ví nguồn
    await db.runAsync(
      "UPDATE accounts SET balance_cached = balance_cached + ?, updated_at=? WHERE id=? AND user_id=?",
      [tx.amount, nowSec, tx.account_id, userId]
    );
    // revert to account: trừ lại tiền khỏi ví đích
    if (tx.to_account_id) {
      await db.runAsync(
        "UPDATE accounts SET balance_cached = balance_cached - ?, updated_at=? WHERE id=? AND user_id=?",
        [tx.amount, nowSec, tx.to_account_id, userId]
      );
    }
    // xóa giao dịch
    await db.runAsync("DELETE FROM transactions WHERE id=?", [id]);
  });

  // Invalidate cache & sync
  const { invalidateAccountsCache } = await import("@/services/cacheService");
  invalidateAccountsCache();
  try {
    scheduleSyncDebounced(userId ?? undefined);
  } catch (e) {
    scheduleSyncDebounced();
  }
  refreshWidgetSilent();
}
