// migrate.ts
import type { SQLiteDatabase } from "expo-sqlite";

const initSQL = `
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,
  icon TEXT, color TEXT,
  currency_code TEXT NOT NULL DEFAULT 'VND',
  include_in_total INTEGER NOT NULL DEFAULT 1,
  balance_cached INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('expense','income')),
  icon TEXT, color TEXT,
  parent_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);
CREATE INDEX IF NOT EXISTS idx_categories_type ON categories(type);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  account_id TEXT NOT NULL,
  category_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('expense','income','transfer')),
  amount INTEGER NOT NULL,
  note TEXT,
  occurred_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_user_time ON transactions(user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);

CREATE TRIGGER IF NOT EXISTS trg_tx_after_insert
AFTER INSERT ON transactions
BEGIN
  UPDATE accounts
  SET balance_cached = balance_cached +
    CASE
      WHEN NEW.type='income' THEN NEW.amount
      WHEN NEW.type='expense' THEN -NEW.amount
      ELSE 0
    END,
    updated_at = strftime('%s','now')
  WHERE id = NEW.account_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_tx_after_delete
AFTER DELETE ON transactions
BEGIN
  UPDATE accounts
  SET balance_cached = balance_cached -
    CASE
      WHEN OLD.type='income' THEN OLD.amount
      WHEN OLD.type='expense' THEN -OLD.amount
      ELSE 0
    END,
    updated_at = strftime('%s','now')
  WHERE id = OLD.account_id;
END;

INSERT OR REPLACE INTO settings(key,value) VALUES('schema_version','1');
`;

// Đảm bảo cột tồn tại: nếu thiếu thì ADD COLUMN + backfill
async function ensureColumn(
  db: SQLiteDatabase,
  table: string,
  col: string,
  ddl: string, // "INTEGER" | "TEXT"...
  backfillSQL?: string // ví dụ: UPDATE categories SET updated_at = ...
) {
  const cols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table})`
  );
  const has = cols.some((c) => c.name === col);
  if (!has) {
    await db.runAsync(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
    if (backfillSQL) await db.runAsync(backfillSQL);
  }
}

export async function runMigrations(db: SQLiteDatabase) {
  // 1) Tạo bảng/cấu trúc cơ bản
  await db.execAsync(initSQL);

  // 2) Nâng cấp bảng cũ (nếu đã tồn tại từ trước) — thêm cột còn thiếu
  // categories
  await ensureColumn(
    db,
    "categories",
    "type",
    "TEXT",
    `UPDATE categories SET type = COALESCE(type, 'expense')`
  );
  await ensureColumn(db, "categories", "parent_id", "TEXT");
  await ensureColumn(
    db,
    "categories",
    "created_at",
    "INTEGER",
    `UPDATE categories SET created_at = COALESCE(created_at, strftime('%s','now'))`
  );
  await ensureColumn(
    db,
    "categories",
    "updated_at",
    "INTEGER",
    `UPDATE categories SET updated_at = COALESCE(updated_at, created_at, strftime('%s','now'))`
  );

  // accounts
  await ensureColumn(
    db,
    "accounts",
    "updated_at",
    "INTEGER",
    `UPDATE accounts SET updated_at = COALESCE(updated_at, created_at, strftime('%s','now'))`
  );

  // transactions
  await ensureColumn(
    db,
    "transactions",
    "updated_at",
    "INTEGER",
    `UPDATE transactions SET updated_at = COALESCE(updated_at, created_at, strftime('%s','now'))`
  );

  await ensureColumn(db, "users", "username", "TEXT");
  await ensureColumn(db, "users", "password_hash", "TEXT");
  await ensureColumn(
    db,
    "users",
    "created_at",
    "INTEGER",
    `UPDATE users SET created_at = strftime('%s','now')`
  );
  await ensureColumn(
    db,
    "users",
    "updated_at",
    "INTEGER",
    `UPDATE users SET updated_at = strftime('%s','now')`
  );
}
