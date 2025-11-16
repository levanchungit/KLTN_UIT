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

  await db
    .runAsync(
      `INSERT INTO users(id,username,password_hash,created_at,updated_at)
     VALUES(?,?,?,?,?)`,
      [id, uname, password_hash, now, now]
    )
    .catch((err: any) => {
      // Convert SQLITE UNIQUE constraint into a friendly error code
      const message = String(err?.message || err);
      if (
        message.includes("UNIQUE constraint failed") &&
        message.includes("users.username")
      ) {
        throw new Error("USERNAME_TAKEN");
      }
      throw err;
    });

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

/**
 * Create or return a user based on Google OAuth identity.
 * We store Google users with username `google:<googleId>` to keep them unique.
 */
export async function loginOrCreateUserWithGoogle({
  googleId,
  email,
  name,
}: {
  googleId: string;
  email?: string | null;
  name?: string | null;
}): Promise<{ id: string; username: string }> {
  await ensureAuthTables();

  const uname = `google:${googleId}`;

  // Check existing
  const existing = await db.getFirstAsync<{ id: string; username: string }>(
    `SELECT id, username FROM users WHERE username=?`,
    [uname]
  );
  if (existing) return { id: existing.id, username: existing.username };

  // Create new user record. We don't store a real password for OAuth users;
  // instead store a random hash so the schema's not violated.
  const randomPwd = Math.random().toString(36).slice(2, 10) + Date.now();
  const password_hash = bcrypt.hashSync(randomPwd, 10);

  const id = genId("u_");
  const now = Math.floor(Date.now() / 1000);

  await db.runAsync(
    `INSERT INTO users(id,username,password_hash,created_at,updated_at)
     VALUES(?,?,?,?,?)`,
    [id, uname, password_hash, now, now]
  );

  // Optionally populate a profile table in future. For now return id/username.
  return { id, username: uname };
}
