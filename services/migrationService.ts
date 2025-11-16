import { openDb } from "@/db";

/**
 * Migrate rows owned by "local_user" to the newly logged-in user.
 * This is a simple ownership transfer and does not attempt to merge duplicates.
 */
export async function migrateLocalDataToUser(
  newUserId: string,
  username?: string
) {
  const conn = await openDb();
  await conn.execAsync("BEGIN");
  try {
    // Ensure the users table has an entry for the new user so FKs keep working
    await conn.runAsync(
      `INSERT OR IGNORE INTO users(id, username, password_hash, created_at, updated_at)
       VALUES(?, ?, ?, strftime('%s','now'), strftime('%s','now'))`,
      [newUserId, username || newUserId, ""]
    );

    // Transfer ownership of accounts, categories, transactions, budgets, ml samples
    await conn.runAsync(`UPDATE accounts SET user_id=? WHERE user_id=?`, [
      newUserId,
      "local_user",
    ]);

    await conn.runAsync(`UPDATE categories SET user_id=? WHERE user_id=?`, [
      newUserId,
      "local_user",
    ]);

    await conn.runAsync(`UPDATE transactions SET user_id=? WHERE user_id=?`, [
      newUserId,
      "local_user",
    ]);

    await conn.runAsync(`UPDATE budgets SET user_id=? WHERE user_id=?`, [
      newUserId,
      "local_user",
    ]);

    await conn.runAsync(
      `UPDATE ml_training_samples SET user_id=? WHERE user_id=?`,
      [newUserId, "local_user"]
    );

    await conn.execAsync("COMMIT");
  } catch (err) {
    await conn.execAsync("ROLLBACK");
    throw err;
  }
}

/**
 * Reverse migration: move rows owned by `fromUserId` into `local_user`.
 * Used when a user logs out so their device data remains visible under the local account.
 */
export async function migrateUserDataToLocal(fromUserId: string) {
  const conn = await openDb();
  await conn.execAsync("BEGIN");
  try {
    // Ensure local_user exists
    await conn.runAsync(
      `INSERT OR IGNORE INTO users(id, username, password_hash, created_at, updated_at)
       VALUES(?, ?, ?, strftime('%s','now'), strftime('%s','now'))`,
      ["local_user", "Local User", ""]
    );

    // Transfer ownership to local_user
    await conn.runAsync(`UPDATE accounts SET user_id=? WHERE user_id=?`, [
      "local_user",
      fromUserId,
    ]);

    await conn.runAsync(`UPDATE categories SET user_id=? WHERE user_id=?`, [
      "local_user",
      fromUserId,
    ]);

    await conn.runAsync(`UPDATE transactions SET user_id=? WHERE user_id=?`, [
      "local_user",
      fromUserId,
    ]);

    await conn.runAsync(`UPDATE budgets SET user_id=? WHERE user_id=?`, [
      "local_user",
      fromUserId,
    ]);

    await conn.runAsync(
      `UPDATE ml_training_samples SET user_id=? WHERE user_id=?`,
      ["local_user", fromUserId]
    );

    await conn.execAsync("COMMIT");
  } catch (err) {
    await conn.execAsync("ROLLBACK");
    throw err;
  }
}
