import { openDb } from "@/db";
import { scheduleSyncDebounced } from "@/services/syncTrigger";
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
      Math.max(0, Math.trunc(input.balance) || 0),
    ]
  );
  try {
    scheduleSyncDebounced(userId);
  } catch (e) {
    scheduleSyncDebounced();
  }
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
    vals.push(Math.max(0, Math.trunc(input.balance)));
  }

  set.push("updated_at=strftime('%s','now')");

  await db.runAsync(
    `UPDATE accounts SET ${set.join(",")} WHERE id=? AND user_id=?`,
    [...vals, id, userId]
  );
  try {
    scheduleSyncDebounced(userId);
  } catch (e) {
    scheduleSyncDebounced();
  }
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
  try {
    scheduleSyncDebounced(userId);
  } catch (e) {
    scheduleSyncDebounced();
  }
  try {
    const s = await import("@/services/firestoreSync");
    s.markRemoteDeleted("accounts", id, userId).catch((e) => console.warn(e));
  } catch (e) {
    // ignore if firestore not available
  }
  // Lưu ý FK: nếu có bảng giao dịch tham chiếu accounts mà không ON DELETE CASCADE,
  // thao tác có thể fail → khi đó cân nhắc dùng soft-delete hoặc báo lỗi người dùng.
}
