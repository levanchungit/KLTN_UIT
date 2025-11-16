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

-- ML training samples (for improving on-device/offline models)
CREATE TABLE IF NOT EXISTS ml_training_samples (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  text TEXT NOT NULL,
  amount INTEGER,
  io TEXT CHECK (io IN ('IN','OUT')),
  predicted_category_id TEXT,
  chosen_category_id TEXT,
  confidence REAL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (predicted_category_id) REFERENCES categories(id) ON DELETE SET NULL,
  FOREIGN KEY (chosen_category_id) REFERENCES categories(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ml_samples_user_time ON ml_training_samples(user_id, created_at);

-- Budgets: overall budget plans
CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,
  total_income INTEGER NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('daily','weekly','monthly')),
  lifestyle_desc TEXT,
  start_date INTEGER NOT NULL,
  end_date INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_budgets_user ON budgets(user_id);

-- Budget allocations: per-category limits within a budget
CREATE TABLE IF NOT EXISTS budget_allocations (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  group_type TEXT NOT NULL CHECK (group_type IN ('needs','wants','savings')),
  allocated_amount INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_budget_alloc_budget ON budget_allocations(budget_id);
CREATE INDEX IF NOT EXISTS idx_budget_alloc_category ON budget_allocations(category_id);
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

  // 2) Đảm bảo local user tồn tại (cho SQLite offline usage)
  const localUser = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM users WHERE id=?`,
    ["local_user"]
  );
  if (!localUser) {
    await db.runAsync(
      `INSERT OR IGNORE INTO users(id, username, password_hash, created_at, updated_at)
       VALUES(?, ?, ?, strftime('%s','now'), strftime('%s','now'))`,
      ["local_user", "Local User", ""]
    );
  }

  // Create default account for local_user if not exists
  const defaultAccount = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM accounts WHERE user_id=? AND name=?`,
    ["local_user", "Ví mặc định"]
  );
  if (!defaultAccount) {
    await db.runAsync(
      `INSERT INTO accounts(id, user_id, name, icon, color, include_in_total, balance_cached, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, strftime('%s','now'), strftime('%s','now'))`,
      ["acc_default", "local_user", "Ví mặc định", "wallet", "#007AFF", 1, 0]
    );
  }

  // Keep u_demo for backward compatibility
  const demoUser = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM users WHERE id=?`,
    ["u_demo"]
  );
  if (!demoUser) {
    await db.runAsync(
      `INSERT OR IGNORE INTO users(id, username, password_hash, created_at, updated_at)
       VALUES(?, ?, ?, strftime('%s','now'), strftime('%s','now'))`,
      ["u_demo", "demo", "demo_hash"]
    );
  }

  // 3) Nâng cấp bảng cũ (nếu đã tồn tại từ trước) — thêm cột còn thiếu
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
