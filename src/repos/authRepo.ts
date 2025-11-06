import bcrypt from "bcryptjs";
import { db, openDb } from "../db";

bcrypt.setRandomFallback((len) => {
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = Math.floor(Math.random() * 256);
  return arr;
});

export type AppUser = {
  id: string;
  username: string;
  password: string;
  created_at: number;
};

export async function ensureAuthTables() {
  await openDb();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS users(
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

function genId(prefix = "u_") {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Đăng ký người dùng mới (Register)
 * @throws "USERNAME_TAKEN", "USERNAME_TOO_SHORT", "PASSWORD_TOO_SHORT"
 */
export async function createUserWithPassword({
  username,
  password,
}: {
  username: string;
  password: string;
}): Promise<string> {
  await ensureAuthTables();

  const uname = String(username ?? "")
    .trim()
    .toLowerCase();
  const pwd = String(password ?? "").trim();

  if (!uname || !pwd) throw new Error("EMPTY_FIELDS");
  if (uname.length < 3) throw new Error("USERNAME_TOO_SHORT");
  if (pwd.length < 4) throw new Error("PASSWORD_TOO_SHORT");

  const existed = await db.getFirstAsync<{ cnt: number }>(
    `SELECT COUNT(1) AS cnt FROM users WHERE username=?`,
    [uname]
  );
  if ((existed?.cnt ?? 0) > 0) throw new Error("USERNAME_TAKEN");

  // DÙNG hashSync với rounds (10)
  const password_hash = bcrypt.hashSync(pwd, 10);

  const id = genId("u_");
  const now = Math.floor(Date.now() / 1000);

  await db.runAsync(
    `INSERT INTO users(id,username,password_hash,created_at,updated_at)
     VALUES(?,?,?,?,?)`,
    [id, uname, password_hash, now, now]
  );

  return id;
}

/**
 * Đăng nhập (Login)
 * Trả về user nếu đúng, null nếu sai
 */
export async function loginWithPassword({
  username,
  password,
}: {
  username: string;
  password: string;
}): Promise<{ id: string; username: string }> {
  await ensureAuthTables();

  const uname = String(username ?? "")
    .trim()
    .toLowerCase();
  const pwd = String(password ?? "").trim();

  if (!uname || !pwd) throw new Error("EMPTY_FIELDS");

  // Lấy password_hash theo username
  const user = await db.getFirstAsync<{
    id: string;
    username: string;
    password_hash: string;
  }>(
    `SELECT id, username, password_hash
     FROM users
     WHERE username = ?`,
    [uname]
  );

  if (!user) {
    // Không tiết lộ tài khoản có tồn tại hay không (bảo mật) — tuỳ bạn:
    // throw new Error("USER_NOT_FOUND");
    throw new Error("WRONG_CREDENTIALS");
  }

  // So sánh mật khẩu
  const ok = bcrypt.compareSync(pwd, user.password_hash);
  if (!ok) {
    // throw new Error("WRONG_PASSWORD");
    throw new Error("WRONG_CREDENTIALS");
  }

  // Cập nhật last_login_at / updated_at (tuỳ schema)
  const now = Math.floor(Date.now() / 1000);
  try {
    await db.runAsync(
      `UPDATE users
         SET updated_at = ?, last_login_at = ?
       WHERE id = ?`,
      [now, now, user.id]
    );
  } catch (_) {
    // Không critical; có thể bỏ qua nếu schema chưa có last_login_at
  }

  return { id: user.id, username: user.username };
}
