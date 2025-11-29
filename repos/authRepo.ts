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
  name?: string | null;
  image?: string | null;
  created_at: number;
};

export async function ensureAuthTables() {
  await openDb();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS users(
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      image TEXT,
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
}): Promise<{
  id: string;
  username: string;
  name?: string | null;
  image?: string | null;
}> {
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
    name?: string | null;
    image?: string | null;
  }>(
    `SELECT id, username, password_hash, name, image
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

  return {
    id: user.id,
    username: user.username,
    name: user.name,
    image: user.image,
  };
}

/**
 * Create or return a user based on Google OAuth identity.
 * We store Google users with username `google:<googleId>` to keep them unique.
 */
export async function loginOrCreateUserWithGoogle({
  googleId,
  email,
  name,
  image,
}: {
  googleId: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
}): Promise<{
  id: string;
  username: string;
  name?: string | null;
  image?: string | null;
}> {
  await ensureAuthTables();
  // Prefer using the user's email as the username when available so Google
  // accounts are stored as their email. Fall back to `google:<id>` when
  // no email is provided.
  const emailNorm = email ? String(email).trim().toLowerCase() : null;

  // Check existing user by that username (this will also link to an
  // existing local account that used the same email).
  const existing = await db.getFirstAsync<{ id: string; username: string }>(
    `SELECT id, username FROM users WHERE username=?`,
    [emailNorm]
  );
  if (existing) {
    // Update profile fields if provided (non-destructive)
    try {
      const now = Math.floor(Date.now() / 1000);
      await db.runAsync(
        `UPDATE users SET name = COALESCE(?, name), image = COALESCE(?, image), updated_at = ? WHERE id = ?`,
        [name ?? null, image ?? null, now, existing.id]
      );
    } catch (_) {}
    return { id: existing.id, username: existing.username };
  }

  // Create new user record. We don't store a real password for OAuth users;
  // instead store a random hash so the schema's not violated.
  const randomPwd = Math.random().toString(36).slice(2, 10) + Date.now();
  const password_hash = bcrypt.hashSync(randomPwd, 10);

  const id = genId("u_");
  const now = Math.floor(Date.now() / 1000);

  await db.runAsync(
    `INSERT INTO users(id,username,password_hash,name,image,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?)`,
    [id, emailNorm, password_hash, name ?? null, image ?? null, now, now]
  );

  // Optionally populate a profile table in future. For now return id/username.
  return {
    id,
    username: emailNorm || `google:${googleId}`,
    name: name ?? null,
    image: image ?? null,
  };
}

/**
 * Ensure a local user record exists for a federated/OAuth user.
 * If `id` is provided it will be used as the primary key (this is used
 * for Firebase UID so local rows persist across reinstalls when the same
 * Firebase account signs in again). If `id` is omitted we fall back to
 * the existing `loginOrCreateUserWithGoogle` behaviour.
 */
export async function upsertUserFromOAuth({
  id,
  googleId,
  email,
  name,
  image,
}: {
  id?: string | null;
  googleId?: string | null;
  email?: string | null;
  name?: string | null;
  image?: string | null;
}): Promise<{
  id: string;
  username: string;
  name?: string | null;
  image?: string | null;
}> {
  await ensureAuthTables();

  const emailNorm = email ? String(email).trim().toLowerCase() : null;
  const useId = id || (emailNorm ? null : `google:${googleId}`) || genId("u_");
  const username = emailNorm || `google:${googleId}` || useId;

  // If a row already exists with this id, update profile fields, else create.
  const existingById = await db.getFirstAsync<{ id: string; username: string }>(
    `SELECT id, username FROM users WHERE id = ?`,
    [useId]
  );
  const now = Math.floor(Date.now() / 1000);

  if (existingById) {
    try {
      await db.runAsync(
        `UPDATE users SET username = COALESCE(?, username), name = COALESCE(?, name), image = COALESCE(?, image), updated_at = ? WHERE id = ?`,
        [username, name ?? null, image ?? null, now, useId]
      );
    } catch (e) {
      // non-critical
    }
    return { id: useId, username, name: name ?? null, image: image ?? null };
  }

  // No row with this id — attempt to create one. If username (email) collides,
  // append suffix to keep unique.
  let finalUsername = username;
  if (emailNorm) {
    const existed = await db.getFirstAsync<{ cnt: number }>(
      `SELECT COUNT(1) AS cnt FROM users WHERE username = ?`,
      [emailNorm]
    );
    if ((existed?.cnt ?? 0) > 0) {
      // email already used by another account; fall back to `google:<id>` username
      finalUsername = `google:${googleId}`;
    }
  }

  const password_hash = bcrypt.hashSync(
    Math.random().toString(36).slice(2, 10),
    6
  );
  try {
    await db.runAsync(
      `INSERT INTO users(id,username,password_hash,name,image,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`,
      [
        useId,
        finalUsername,
        password_hash,
        name ?? null,
        image ?? null,
        now,
        now,
      ]
    );
  } catch (err: any) {
    // If insert failed due to username uniqueness, try alternative username.
    if (
      String(err?.message || "").includes("UNIQUE") &&
      finalUsername.startsWith("google:")
    ) {
      const alt = `${finalUsername}_${Math.random().toString(36).slice(2, 6)}`;
      await db.runAsync(
        `INSERT INTO users(id,username,password_hash,name,image,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`,
        [useId, alt, password_hash, name ?? null, image ?? null, now, now]
      );
      finalUsername = alt;
    } else {
      throw err;
    }
  }

  return {
    id: useId,
    username: finalUsername,
    name: name ?? null,
    image: image ?? null,
  };
}

/**
 * Migrate local users by mapping their username (email) to a Firebase UID.
 * `mapping` is an object where keys are email (username) and values are the
 * corresponding Firebase UID. This function will update related tables
 * (`accounts`, `categories`, `transactions`) to point to the new UID and
 * remove or merge old user rows.
 */
export async function migrateUsersToFirebase(mapping: Record<string, string>) {
  await ensureAuthTables();
  const results: { migrated: number; skipped: string[]; errors: string[] } = {
    migrated: 0,
    skipped: [],
    errors: [],
  };

  for (const [email, newUid] of Object.entries(mapping)) {
    try {
      const local = await db.getFirstAsync<{ id: string }>(
        `SELECT id FROM users WHERE username = ?`,
        [email] as any
      );
      if (!local) {
        results.skipped.push(email);
        continue;
      }
      const oldId = local.id;
      if (oldId === newUid) {
        results.migrated++;
        continue;
      }

      const existsNew = await db.getFirstAsync<{ id: string }>(
        `SELECT id FROM users WHERE id = ?`,
        [newUid] as any
      );

      if (existsNew) {
        // Merge: reassign related rows to newUid, then delete old user
        await db.runAsync(`UPDATE accounts SET user_id = ? WHERE user_id = ?`, [
          newUid,
          oldId,
        ] as any);
        await db.runAsync(
          `UPDATE categories SET user_id = ? WHERE user_id = ?`,
          [newUid, oldId] as any
        );
        await db.runAsync(
          `UPDATE transactions SET user_id = ? WHERE user_id = ?`,
          [newUid, oldId] as any
        );
        try {
          await db.runAsync(`DELETE FROM users WHERE id = ?`, [oldId] as any);
        } catch (e) {
          // ignore delete error
        }
      } else {
        // Update the users primary key to newUid and move related rows
        try {
          await db.runAsync(
            `UPDATE users SET id = ?, username = ? WHERE id = ?`,
            [newUid, email, oldId] as any
          );
        } catch (e) {
          // If updating primary key fails (unique constraint), try create+move
          try {
            const row = await db.getFirstAsync<any>(
              `SELECT username, name, image, created_at, updated_at FROM users WHERE id = ?`,
              [oldId] as any
            );
            const now = Math.floor(Date.now() / 1000);
            await db.runAsync(
              `INSERT INTO users(id,username,password_hash,name,image,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`,
              [
                newUid,
                row.username || email,
                bcrypt.hashSync(Math.random().toString(36).slice(2, 8), 6),
                row.name || null,
                row.image || null,
                now,
                now,
              ] as any
            );
            await db.runAsync(
              `UPDATE accounts SET user_id = ? WHERE user_id = ?`,
              [newUid, oldId] as any
            );
            await db.runAsync(
              `UPDATE categories SET user_id = ? WHERE user_id = ?`,
              [newUid, oldId] as any
            );
            await db.runAsync(
              `UPDATE transactions SET user_id = ? WHERE user_id = ?`,
              [newUid, oldId] as any
            );
            await db.runAsync(`DELETE FROM users WHERE id = ?`, [oldId] as any);
          } catch (e2) {
            results.errors.push(`failed to migrate ${email}: ${String(e2)}`);
            continue;
          }
        }
      }

      results.migrated++;
    } catch (err: any) {
      results.errors.push(`error for ${email}: ${String(err)}`);
    }
  }

  return results;
}
