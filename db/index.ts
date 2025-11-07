import * as SQLite from "expo-sqlite";
import { runMigrations } from "./migrate";
import { seedIfEmpty } from "./seed-internal";

let _db: SQLite.SQLiteDatabase | null = null;
let _opening: Promise<SQLite.SQLiteDatabase> | null = null;
let _initialized = false;

// Hàng đợi: mọi lệnh SQL sẽ chạy lần lượt
let _queue: Promise<unknown> = Promise.resolve();

async function _ensureOpen(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  if (!_opening) {
    _opening = SQLite.openDatabaseAsync("money.db").then(async (db) => {
      // WAL = hiệu năng tốt hơn, ít khóa ghi
      await db.execAsync("PRAGMA journal_mode = WAL;");
      await db.execAsync("PRAGMA foreign_keys = ON;");
      _db = db;
      return db;
    });
  }
  return _opening;
}

/** Mặc định export: hàng đợi bao bọc các hàm async của DB */
export const db = {
  getAllAsync<T = any>(
    ...args: Parameters<SQLite.SQLiteDatabase["getAllAsync"]>
  ): Promise<T[]> {
    const job = _queue.then(async () => {
      const conn = await _ensureOpen();
      // @ts-ignore
      return conn.getAllAsync<T>(...args);
    });
    // nối chuỗi để tuần tự
    _queue = job.catch(() => undefined);
    return job as Promise<T[]>;
  },

  getFirstAsync<T = any>(
    ...args: Parameters<SQLite.SQLiteDatabase["getFirstAsync"]>
  ): Promise<T | undefined> {
    const job = _queue.then(async () => {
      const conn = await _ensureOpen();
      // @ts-ignore
      return conn.getFirstAsync<T>(...args);
    });
    _queue = job.catch(() => undefined);
    return job as Promise<T | undefined>;
  },

  runAsync(
    ...args: Parameters<SQLite.SQLiteDatabase["runAsync"]>
  ): Promise<void> {
    const job = _queue.then(async () => {
      const conn = await _ensureOpen();
      // @ts-ignore
      return conn.runAsync(...args);
    });
    _queue = job.catch(() => undefined);
    return job.then(() => {}) as Promise<void>;
  },

  execAsync(
    ...args: Parameters<SQLite.SQLiteDatabase["execAsync"]>
  ): Promise<void> {
    const job = _queue.then(async () => {
      const conn = await _ensureOpen();
      // @ts-ignore
      return conn.execAsync(...args);
    });
    _queue = job.catch(() => undefined);
    return job as Promise<void>;
  },
};

/** Gọi 1 lần ở app init (vd. RootLayout) */
export async function openDb() {
  const conn = await _ensureOpen();
  if (!_initialized) {
    await runMigrations(conn);
    await seedIfEmpty(conn);
    await ensureDbIndexes(); // quan trọng cho truy vấn theo thời gian
    _initialized = true;
  }
  return conn;
}

/** Index giúp truy vấn nhanh theo (user_id, occurred_at) */
export async function ensureDbIndexes() {
  await db.execAsync(
    "CREATE INDEX IF NOT EXISTS idx_tx_user_time ON transactions(user_id, occurred_at);"
  );
}
