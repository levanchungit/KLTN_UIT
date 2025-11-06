// src/db/index.ts
import * as SQLite from "expo-sqlite";
import { runMigrations } from "./migrate";
import { seedIfEmpty } from "./seed-internal";

export let db: SQLite.SQLiteDatabase | undefined;

export async function openDb() {
  if (db) return db;
  db = await SQLite.openDatabaseAsync("money.db");
  await db.execAsync(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`);
  await runMigrations(db);
  await seedIfEmpty(db);
  return db;
}
