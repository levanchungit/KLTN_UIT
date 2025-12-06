// services/firestoreSync.ts
// @ts-nocheck
// Lightweight Firestore sync helpers for categories, transactions and accounts.
// NOTE: This file expects the Firebase JS SDK (v9 modular) to be installed.
// Install with: `npm install firebase` or `yarn add firebase`.

import { db as _db } from "@/db";
import { getCurrentUserId } from "@/utils/auth";
// In this file we frequently pass nullable or mixed-typed params to the
// local wrapper around SQLite bindings. For practicality we treat `db`
// as `any` here to avoid repetitive casts in every call site.
const db: any = _db;

// Use lazy imports so the app won't crash if firebase isn't installed yet.
let _initialized = false;
let _firestore: any = null;
let _fsModule: any = null;
let _firebaseApp: any = null;
let _authInitialized = false;
let _authInitAttempted = false;
// In-memory cooldown to avoid frequent sync runs
let _lastSyncRun = 0;
const SYNC_COOLDOWN_MS = 30 * 1000; // 30s default cooldown

// Cache of last per-user per-collection sync timestamps (seconds since epoch)
const _lastSyncTimestamps: Record<string, number> = {};

async function _getAsyncStorage() {
  try {
    const s = await import("@react-native-async-storage/async-storage");
    return s.default || s;
  } catch (e) {
    // Try expo-secure-store as a fallback adapter (works in Expo Go / dev client)
    try {
      const ss = await import("expo-secure-store");
      const SecureStore = ss.default || ss;
      if (
        SecureStore &&
        (SecureStore.getItemAsync || SecureStore.setItemAsync)
      ) {
        // Adapter exposing getItem/setItem/removeItem to match AsyncStorage API
        const adapter = {
          getItem: async (k: string) => {
            try {
              return await SecureStore.getItemAsync(k);
            } catch (e) {
              return null;
            }
          },
          setItem: async (k: string, v: string) => {
            try {
              await SecureStore.setItemAsync(k, v);
            } catch (e) {
              /* ignore */
            }
          },
          removeItem: async (k: string) => {
            try {
              await SecureStore.deleteItemAsync(k);
            } catch (e) {
              /* ignore */
            }
          },
        } as any;
        console.log("_getAsyncStorage: using expo-secure-store adapter");
        return adapter;
      }
    } catch (e2) {
      // ignore
    }
    console.log("_getAsyncStorage: no AsyncStorage or SecureStore available");
    return null;
  }
}

async function getLastSyncTime(remoteUid: string, collection: string) {
  try {
    const key = `sync:last:${remoteUid}:${collection}`;
    if (_lastSyncTimestamps[key]) return _lastSyncTimestamps[key];
    const AS = await _getAsyncStorage();
    if (!AS || !AS.getItem) return 0;
    const v = await AS.getItem(key);
    const n = v ? Number(v) : 0;
    _lastSyncTimestamps[key] = n || 0;
    return _lastSyncTimestamps[key];
  } catch (e) {
    return 0;
  }
}

async function setLastSyncTime(
  remoteUid: string,
  collection: string,
  ts: number
) {
  try {
    const key = `sync:last:${remoteUid}:${collection}`;
    _lastSyncTimestamps[key] = ts;
    const AS = await _getAsyncStorage();
    if (!AS || !AS.setItem) return;
    await AS.setItem(key, String(ts));
  } catch (e) {
    // ignore
  }
}

// Defensive helper: ensure a document path has an even number of segments.
// If odd, append a fallback document id (`meta`) and log a warning.
function ensureDocPathEven(path: string) {
  try {
    const segs = path.replace(/^\/+|\/+$/g, "").split("/");
    if (segs.length % 2 === 0) return path;
    const fixed = path.replace(/\/+$/g, "") + "/meta";
    console.warn(
      "Adjusted Firestore doc path to even segments:",
      path,
      "->",
      fixed
    );
    return fixed;
  } catch (e) {
    return path;
  }
}

export async function initFirestore(firebaseConfig: any) {
  if (_initialized) return _firestore;
  if (!firebaseConfig) {
    throw new Error(
      "initFirestore requires a firebaseConfig object. Provide it from your Firebase console."
    );
  }

  // Dynamic import so installation is optional until sync is used.
  const firebaseApp = await import("firebase/app");
  const firebaseFirestore = await import("firebase/firestore");

  // Initialize app if none
  try {
    // @ts-ignore
    if (firebaseApp.getApps && firebaseApp.getApps().length === 0) {
      // @ts-ignore
      firebaseApp.initializeApp(firebaseConfig);
    }
  } catch (e) {
    // ignore if already initialized
    console.warn("Firebase init warning:", e);
  }

  // Cache app instance for auth operations
  try {
    // @ts-ignore
    _firebaseApp = firebaseApp.getApp();
  } catch (e) {
    try {
      // @ts-ignore
      _firebaseApp = firebaseApp.initializeApp(firebaseConfig);
    } catch (ee) {
      // ignore
    }
  }

  // @ts-ignore
  _firestore = firebaseFirestore.getFirestore(
    _firebaseApp || (firebaseApp.getApp && firebaseApp.getApp())
  );
  // keep module reference to avoid re-import issues later
  _fsModule = firebaseFirestore;
  _initialized = true;

  // Configure Firebase logging to suppress error messages and use warnings instead
  try {
    const { logToConsole } = await import("firebase/logger");
    if (logToConsole) {
      logToConsole(true, "warn"); // Only show warnings and below, not errors
    }
  } catch (e) {
    // Firebase logger not available, suppress errors and only log warnings
    const originalError = console.error;
    console.error = function (...args: any[]) {
      const msg = args[0]?.toString?.() || "";
      // Convert Firebase/Firestore errors to warnings
      if (
        msg.includes("@firebase") ||
        msg.includes("Firestore") ||
        msg.includes("Connection failed") ||
        msg.includes("unavailable")
      ) {
        console.warn("[Firebase]", ...args);
      }
      // Silently suppress other Firebase errors - don't call originalError
    };
  }


  // Initialize Firebase Auth for React Native. This must run before any getAuth() calls
  try {
    _authInitAttempted = true;
    const authMod: any = await import("firebase/auth");
    if (authMod && authMod.initializeAuth) {
      try {
        // prefer AsyncStorage persistence if available (try AsyncStorage, then expo SecureStore)
        const AS = await _getAsyncStorage();
        if (AS) {
          try {
            // Ensure getReactNativePersistence is available
            if (typeof authMod.getReactNativePersistence === "function") {
              let persistence: any = null;
              try {
                persistence = authMod.getReactNativePersistence(AS);
                console.log(
                  "initializeAuth: getReactNativePersistence returned:",
                  typeof persistence
                );
              } catch (gpErr) {
                console.warn(
                  "initializeAuth: getReactNativePersistence failed:",
                  gpErr
                );
              }

              if (persistence) {
                authMod.initializeAuth(
                  _firebaseApp || (firebaseApp.getApp && firebaseApp.getApp()),
                  { persistence }
                );
                _authInitialized = true;
                console.log(
                  "Firebase Auth initialized with ReactNative persistence (Async or SecureStore)"
                );
              } else {
                console.warn(
                  "initializeAuth: persistence object falsy, falling back to memory"
                );
                authMod.initializeAuth(
                  _firebaseApp || (firebaseApp.getApp && firebaseApp.getApp())
                );
                _authInitialized = true;
                console.log(
                  "Firebase Auth initialized (fallback, memory persistence)"
                );
              }
            } else {
              console.warn(
                "initializeAuth: authMod.getReactNativePersistence not available"
              );
              authMod.initializeAuth(
                _firebaseApp || (firebaseApp.getApp && firebaseApp.getApp())
              );
              _authInitialized = true;
              console.log(
                "Firebase Auth initialized (fallback, memory persistence)"
              );
            }
          } catch (ie) {
            console.warn(
              "initializeAuth failed while using storage, falling back:",
              ie
            );
            try {
              authMod.initializeAuth(
                _firebaseApp || (firebaseApp.getApp && firebaseApp.getApp())
              );
              _authInitialized = true;
              console.log(
                "Firebase Auth initialized (fallback, memory persistence)"
              );
            } catch (ie2) {
              console.warn("initializeAuth failed:", ie2);
            }
          }
        } else {
          // No storage available -> memory persistence
          try {
            console.log(
              "initializeAuth: no storage available, using memory persistence"
            );
            authMod.initializeAuth(
              _firebaseApp || (firebaseApp.getApp && firebaseApp.getApp())
            );
            _authInitialized = true;
            console.log(
              "Firebase Auth initialized without AsyncStorage (memory persistence)"
            );
          } catch (ie3) {
            console.warn("initializeAuth failed (no AsyncStorage):", ie3);
          }
        }
      } catch (err) {
        console.warn("initializeAuth setup failed:", err);
      }
    }
  } catch (e) {
    // auth module not available; skip
  }

  return _firestore;
}

/** Ensure Firebase Auth is available and return the auth.uid (sign-in anonymously if needed).
 * This UID will be used as the canonical remote user id (path `users/{authUid}/...`).
 */
async function getAuthUid(): Promise<string> {
  // Ensure auth is initialized before attempting to get current user
  async function ensureAuthInitialized() {
    if (_authInitialized) return;
    try {
      const authMod: any = await import("firebase/auth");
      if (authMod && authMod.initializeAuth) {
        try {
          const AS = await _getAsyncStorage();
          if (AS) {
            try {
              authMod.initializeAuth(_firebaseApp || undefined, {
                persistence: authMod.getReactNativePersistence(AS),
              });
              _authInitialized = true;
              console.log(
                "Firebase Auth initialized with ReactNative persistence (ensure)"
              );
              return;
            } catch (ie) {
              // fallback
            }
          }
        } catch (err) {
          // ignore
        }
        try {
          authMod.initializeAuth(_firebaseApp || undefined);
          _authInitialized = true;
          console.log("Firebase Auth initialized (ensure, memory persistence)");
        } catch (ie2) {
          console.warn("ensureAuthInitialized.initializeAuth failed:", ie2);
        }
      }
    } catch (e) {
      // auth module not available
    }
  }

  await ensureAuthInitialized();
  try {
    // ensure firebase app initialized
    // try to import auth module
    const authMod: any = await import("firebase/auth");
    // getAuth is the modular API; prefer app-scoped auth instance
    const auth = authMod.getAuth
      ? authMod.getAuth(_firebaseApp || undefined)
      : authMod.auth
      ? authMod.auth()
      : null;
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user) {
      // Do NOT create anonymous sessions automatically for this app.
      // The app requires a signed-in user (email/password or Google). Instruct caller to sign in.
      throw new Error(
        "No authenticated Firebase user found. Please sign in (Google or registered account) before syncing."
      );
    }
    if (!user || !user.uid)
      throw new Error("Unable to obtain auth.currentUser.uid");
    return user.uid;
  } catch (e: any) {
    console.warn("getAuthUid failed:", e);
    throw new Error(
      "Firebase Auth not initialized or not available: " + (e?.message ?? e)
    );
  }
}

/**
 * Check whether Firebase Auth currently has an authenticated user.
 * Returns `true` only when the auth module is available and `currentUser` exists.
 * Never throws — failures return `false`.
 */
export async function isFirebaseSignedIn(): Promise<boolean> {
  try {
    const authMod: any = await import("firebase/auth");
    const auth = authMod.getAuth
      ? authMod.getAuth(_firebaseApp || undefined)
      : authMod.auth
      ? authMod.auth()
      : null;
    if (!auth) return false;
    const user = auth.currentUser;
    return !!(user && user.uid);
  } catch (e) {
    return false;
  }
}

async function ensureFirestore() {
  if (!_initialized) {
    throw new Error(
      "Firestore not initialized. Call initFirestore(firebaseConfig) before syncing."
    );
  }
  return _firestore;
}

function toNum(v: any): number | null {
  if (v == null) return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  return Math.trunc(n);
}

function safeStr(v: any) {
  if (v == null) return null;
  return String(v);
}

async function _getFirestore() {
  const fdb = await ensureFirestore();
  // prefer cached module from init, fallback to dynamic import
  let firestore = _fsModule;
  if (!firestore) {
    try {
      firestore = await import("firebase/firestore");
      _fsModule = firestore;
    } catch (e) {
      console.warn("Failed to import firebase/firestore module:", e);
      throw e;
    }
  }

  if (!firestore) {
    throw new Error("Firestore module unavailable after import");
  }
  // Helpful debug logging when running into undefined-export issues
  try {
    if (!firestore.writeBatch) {
      console.warn(
        "Firestore module does not export `writeBatch`. Available exports:",
        Object.keys(firestore)
      );
    }
  } catch (e) {
    // ignore
  }
  return { fdb, firestore };
}

// Robustly ensure we have a firestore module that exposes writeBatch/doc/getDocs/etc.
async function ensureFsModule() {
  if (_fsModule) return _fsModule;
  try {
    const m = await import("firebase/firestore");
    if (m && (m.writeBatch || m.batch || m.default)) {
      _fsModule = m;
      return _fsModule;
    }
  } catch (e) {
    // ignore
  }

  // Try compat build as fallback
  try {
    const compat = await import("firebase/compat/firestore");
    if (compat) {
      console.warn("Using firebase compat/firestore fallback module");
      _fsModule = compat;
      return _fsModule;
    }
  } catch (e) {
    // ignore
  }

  throw new Error("Unable to import a usable firebase/firestore module");
}

// Compute per-account balance based on transactions (income +, expense -)
// Returns a map accountId -> computed balance (number)
async function computeAccountBalances(userId: string) {
  try {
    const rows = await db.getAllAsync<any>(
      `
      SELECT a.id AS account_id,
             COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount WHEN t.type='expense' THEN -t.amount ELSE 0 END), 0) AS computed_balance
      FROM accounts a
      LEFT JOIN transactions t ON t.account_id = a.id AND t.user_id = ?
      WHERE a.user_id = ?
      GROUP BY a.id
    `,
      [userId, userId]
    );
    const map: Record<string, number> = {};
    for (const r of rows || []) {
      map[String(r.account_id)] = toNum(r.computed_balance) ?? 0;
    }
    return map;
  } catch (e) {
    console.warn("computeAccountBalances failed:", e);
    return {};
  }
}

/** Sync categories to Firestore under `users/{userId}/categories/{categoryId}` */
export async function syncCategories(userId?: string, since?: number) {
  const localUid = userId ?? (await getCurrentUserId());
  if (!localUid) throw new Error("No user logged in");

  const { fdb, firestore } = await _getFirestore();

  // determine remote uid (auth) and fall back to local id if unavailable
  let rUid: string;
  try {
    rUid = await getAuthUid();
  } catch (e) {
    rUid = localUid;
  }

  // load local categories (only changed since `since` if provided)
  const args: any[] = [localUid];
  let sql = `SELECT id, name, type, icon, color, parent_id, created_at, updated_at FROM categories WHERE user_id=?`;
  if (since && Number.isFinite(since) && since > 0) {
    sql += ` AND (updated_at > ? OR created_at > ?)`;
    args.push(since, since);
  }
  const cats = await db.getAllAsync<any>(sql, args);

  if (!cats || cats.length === 0) return;

  // batch write only changed locals
  const batch = firestore.writeBatch(fdb);
  for (const c of cats) {
    const ref = firestore.doc(fdb, `users/${rUid}/categories/${c.id}`);
    const payload = {
      id: c.id,
      name: c.name,
      type: c.type,
      icon: c.icon ?? null,
      color: c.color ?? null,
      parent_id: c.parent_id ?? null,
      created_at: toNum(c.created_at),
      updated_at: toNum(c.updated_at),
      _synced_at: Math.floor(Date.now() / 1000),
    };
    batch.set(ref, payload, { merge: true });
  }

  await batch.commit();
}

/** Sync accounts to Firestore under `users/{userId}/accounts/{accountId}` */
export async function syncAccounts(userId?: string, since?: number) {
  const localUid = userId ?? (await getCurrentUserId());
  if (!localUid) throw new Error("No user logged in");

  const { fdb, firestore } = await _getFirestore();

  let rUid: string;
  try {
    rUid = await getAuthUid();
  } catch (e) {
    rUid = localUid;
  }

  // Compute authoritative balances from transactions and prefer those when pushing
  const computed = await computeAccountBalances(localUid);

  // Load local accounts; if `since` provided, limit to changed rows
  let accSql = `SELECT id, name, icon, color, include_in_total, created_at, updated_at FROM accounts WHERE user_id=?`;
  const accArgs: any[] = [localUid];
  if (since && Number.isFinite(since) && since > 0) {
    accSql += ` AND (updated_at > ? OR created_at > ?)`;
    accArgs.push(since, since);
  }
  const accs = await db.getAllAsync<any>(accSql, accArgs);

  const batch = firestore.writeBatch(fdb);
  for (const a of accs) {
    const ref = firestore.doc(fdb, `users/${rUid}/accounts/${a.id}`);
    const payload = {
      id: a.id,
      name: a.name,
      icon: a.icon ?? null,
      color: a.color ?? null,
      // Use computed balance derived from transactions so remote reflects transaction history
      balance_cached: toNum(computed[a.id]) ?? 0,
      include_in_total: a.include_in_total ? 1 : 0,
      created_at: toNum(a.created_at),
      updated_at: toNum(a.updated_at),
      _synced_at: Math.floor(Date.now() / 1000),
    };
    batch.set(ref, payload, { merge: true });
  }

  await batch.commit();
}

/** Sync all transactions to Firestore under `users/{userId}/transactions/{txId}` */
export async function syncTransactions(userId?: string, since?: number) {
  const localUid = userId ?? (await getCurrentUserId());
  if (!localUid) throw new Error("No user logged in");

  const { fdb, firestore } = await _getFirestore();

  let rUid: string;
  try {
    rUid = await getAuthUid();
  } catch (e) {
    rUid = localUid;
  }

  let txSql = `SELECT id, account_id, category_id, type, amount, note, occurred_at, created_at, updated_at FROM transactions WHERE user_id=?`;
  const txArgs: any[] = [localUid];
  if (since && Number.isFinite(since) && since > 0) {
    txSql += ` AND (updated_at > ? OR created_at > ?)`;
    txArgs.push(since, since);
  }
  const txs = await db.getAllAsync<any>(txSql, txArgs);

  const batch = firestore.writeBatch(fdb);
  for (const t of txs) {
    const ref = firestore.doc(fdb, `users/${rUid}/transactions/${t.id}`);
    const payload = {
      id: t.id,
      account_id: t.account_id,
      category_id: t.category_id ?? null,
      type: t.type,
      amount: toNum(t.amount) ?? 0,
      note: t.note ?? null,
      occurred_at: toNum(t.occurred_at),
      created_at: toNum(t.created_at),
      updated_at: toNum(t.updated_at),
      _synced_at: Math.floor(Date.now() / 1000),
    };
    batch.set(ref, payload, { merge: true });
  }

  await batch.commit();
}

/** Sync budgets and budget_allocations to Firestore under `users/{userId}/budgets/{budgetId}` and `.../allocations/{allocId}` */
export async function syncBudgets(userId?: string, since?: number) {
  const localUid = userId ?? (await getCurrentUserId());
  if (!localUid) throw new Error("No user logged in");

  const { fdb, firestore } = await _getFirestore();

  let rUid: string;
  try {
    rUid = await getAuthUid();
  } catch (e) {
    rUid = localUid;
  }

  // Load budgets and allocations
  // Load budgets; if `since` provided, limit to changed rows
  let budSql = `SELECT id, name, total_income, period, lifestyle_desc, start_date, end_date, created_at, updated_at FROM budgets WHERE user_id=?`;
  const budArgs: any[] = [localUid];
  if (since && Number.isFinite(since) && since > 0) {
    budSql += ` AND (updated_at > ? OR created_at > ?)`;
    budArgs.push(since, since);
  }
  const budgets = await db.getAllAsync<any>(budSql, budArgs);

  const batch = firestore.writeBatch(fdb);
  for (const b of budgets) {
    const ref = firestore.doc(fdb, `users/${rUid}/budgets/${b.id}`);
    const payload = {
      id: b.id,
      name: b.name,
      total_income: toNum(b.total_income) ?? 0,
      period: safeStr(b.period) ?? null,
      lifestyle_desc: safeStr(b.lifestyle_desc) ?? null,
      start_date: toNum(b.start_date) ?? null,
      end_date: toNum(b.end_date) ?? null,
      created_at: toNum(b.created_at) ?? null,
      updated_at: toNum(b.updated_at) ?? null,
      _synced_at: Math.floor(Date.now() / 1000),
    };
    batch.set(ref, payload, { merge: true });

    // push allocations for this budget
    const allocs = await db.getAllAsync<any>(
      `SELECT id, budget_id, category_id, group_type, allocated_amount, created_at FROM budget_allocations WHERE budget_id=?`,
      [b.id]
    );
    for (const a of allocs) {
      const aRef = firestore.doc(
        fdb,
        `users/${rUid}/budgets/${b.id}/allocations/${a.id}`
      );
      batch.set(
        aRef,
        {
          id: a.id,
          budget_id: a.budget_id,
          category_id: a.category_id,
          group_type: safeStr(a.group_type) ?? null,
          allocated_amount: toNum(a.allocated_amount) ?? 0,
          created_at: toNum(a.created_at) ?? null,
          _synced_at: Math.floor(Date.now() / 1000),
        },
        { merge: true }
      );
    }
  }

  await batch.commit();
}

async function syncBudgetsPullAndPush(
  userId?: string,
  remoteUid?: string,
  since?: number
) {
  const localUid = userId ?? (await getCurrentUserId());
  if (!localUid) throw new Error("No user logged in");
  const { fdb, firestore } = await _getFirestore();

  const rUid =
    remoteUid ??
    (await (async () => {
      try {
        return await getAuthUid();
      } catch (_) {
        return localUid;
      }
    })());

  let snap: any = null;
  try {
    const colBase = firestore.collection(fdb, `users/${rUid}/budgets`);
    if (
      since &&
      Number.isFinite(since) &&
      since > 0 &&
      firestore.query &&
      firestore.where
    ) {
      const q = firestore.query(
        colBase,
        firestore.where("updated_at", ">", since)
      );
      snap = await firestore.getDocs(q);
    } else {
      snap = await firestore.getDocs(colBase);
    }
  } catch (e) {
    console.warn("Failed to query remote budgets (pull):", e);
    snap = { docs: [] };
  }

  const remoteIds = new Set<string>();
  const toPush: any[] = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const id = safeStr(data.id ?? doc.id);
    remoteIds.add(id);
    if (data._deleted) {
      await db.runAsync(`DELETE FROM budget_allocations WHERE budget_id=?`, [
        id,
      ]);
      await db.runAsync(`DELETE FROM budgets WHERE id=? AND user_id=?`, [
        id,
        localUid,
      ]);
      continue;
    }

    const remoteUpdated = toNum(data.updated_at) ?? 0;
    const local = await db.getFirstAsync<any>(
      `SELECT * FROM budgets WHERE id=? AND user_id=?`,
      [id, localUid]
    );
    if (!local) {
      await db.runAsync(
        `INSERT OR REPLACE INTO budgets(id,user_id,name,total_income,period,lifestyle_desc,start_date,end_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          localUid,
          safeStr(data.name),
          toNum(data.total_income) ?? 0,
          safeStr(data.period) ?? null,
          safeStr(data.lifestyle_desc) ?? null,
          toNum(data.start_date) ?? null,
          toNum(data.end_date) ?? null,
          toNum(data.created_at) ?? null,
          remoteUpdated || null,
        ]
      );

      // pull allocations for this budget
      try {
        const allocCol = firestore.collection(
          fdb,
          `users/${rUid}/budgets/${id}/allocations`
        );
        const allocSnap = await firestore.getDocs(allocCol);
        for (const ad of allocSnap.docs) {
          const adata = ad.data();
          await db.runAsync(
            `INSERT OR REPLACE INTO budget_allocations(id,budget_id,category_id,group_type,allocated_amount,created_at) VALUES(?,?,?,?,?,?)`,
            [
              safeStr(adata.id ?? ad.id),
              id,
              safeStr(adata.category_id),
              safeStr(adata.group_type),
              toNum(adata.allocated_amount) ?? 0,
              toNum(adata.created_at) ?? null,
            ]
          );
        }
      } catch (e) {
        console.warn("Failed to pull budget allocations:", e);
      }

      continue;
    }

    const localUpdated = Number(local.updated_at) || 0;
    if (remoteUpdated > localUpdated) {
      await db.runAsync(
        `UPDATE budgets SET name=?, total_income=?, period=?, lifestyle_desc=?, start_date=?, end_date=?, updated_at=? WHERE id=? AND user_id=?`,
        [
          safeStr(data.name),
          toNum(data.total_income) ?? 0,
          safeStr(data.period) ?? null,
          safeStr(data.lifestyle_desc) ?? null,
          toNum(data.start_date) ?? null,
          toNum(data.end_date) ?? null,
          remoteUpdated || null,
          id,
          localUid,
        ]
      );

      // update allocations: replace existing for simplicity
      try {
        await db.runAsync(`DELETE FROM budget_allocations WHERE budget_id=?`, [
          id,
        ]);
        const allocCol = firestore.collection(
          fdb,
          `users/${rUid}/budgets/${id}/allocations`
        );
        const allocSnap = await firestore.getDocs(allocCol);
        for (const ad of allocSnap.docs) {
          const adata = ad.data();
          await db.runAsync(
            `INSERT INTO budget_allocations(id,budget_id,category_id,group_type,allocated_amount,created_at) VALUES(?,?,?,?,?,?)`,
            [
              safeStr(adata.id ?? ad.id),
              id,
              safeStr(adata.category_id) ?? null,
              safeStr(adata.group_type) ?? null,
              toNum(adata.allocated_amount) ?? 0,
              toNum(adata.created_at) ?? null,
            ]
          );
        }
      } catch (e) {
        console.warn("Failed to sync budget allocations from remote:", e);
      }
    } else if (localUpdated > remoteUpdated) {
      toPush.push({ id, row: local });
    }
  }

  // push local budgets that are missing or newer remotely
  let localsSql = `SELECT id,name,total_income,period,lifestyle_desc,start_date,end_date,created_at,updated_at FROM budgets WHERE user_id=?`;
  const localsArgs: any[] = [localUid];
  if (since && Number.isFinite(since) && since > 0) {
    localsSql += ` AND (updated_at > ? OR created_at > ?)`;
    localsArgs.push(since, since);
  }
  const locals = await db.getAllAsync<any>(localsSql, localsArgs);
  const fs = firestore;
  const batch = fs.writeBatch(fdb);
  for (const l of locals) {
    if (!remoteIds.has(l.id)) {
      const ref = fs.doc(fdb, `users/${rUid}/budgets/${l.id}`);
      batch.set(
        ref,
        {
          id: l.id,
          name: l.name,
          total_income: toNum(l.total_income) ?? 0,
          period: safeStr(l.period) ?? null,
          lifestyle_desc: safeStr(l.lifestyle_desc) ?? null,
          start_date: toNum(l.start_date) ?? null,
          end_date: toNum(l.end_date) ?? null,
          created_at: toNum(l.created_at) ?? null,
          updated_at: toNum(l.updated_at) ?? null,
          _synced_at: Math.floor(Date.now() / 1000),
        },
        { merge: true }
      );

      // allocations for this budget
      const allocs = await db.getAllAsync<any>(
        `SELECT id,budget_id,category_id,group_type,allocated_amount,created_at FROM budget_allocations WHERE budget_id=?`,
        [l.id]
      );
      for (const a of allocs) {
        const aRef = fs.doc(
          fdb,
          `users/${rUid}/budgets/${l.id}/allocations/${a.id}`
        );
        batch.set(
          aRef,
          {
            id: a.id,
            budget_id: a.budget_id,
            category_id: a.category_id,
            group_type: safeStr(a.group_type) ?? null,
            allocated_amount: toNum(a.allocated_amount) ?? 0,
            created_at: toNum(a.created_at) ?? null,
            _synced_at: Math.floor(Date.now() / 1000),
          },
          { merge: true }
        );
      }
    }
  }

  for (const p of toPush) {
    const ref = fs.doc(fdb, `users/${rUid}/budgets/${p.id}`);
    batch.set(
      ref,
      {
        id: p.id,
        name: p.row.name,
        total_income: toNum(p.row.total_income) ?? 0,
        period: safeStr(p.row.period) ?? null,
        lifestyle_desc: safeStr(p.row.lifestyle_desc) ?? null,
        start_date: toNum(p.row.start_date) ?? null,
        end_date: toNum(p.row.end_date) ?? null,
        created_at: toNum(p.row.created_at) ?? null,
        updated_at: toNum(p.row.updated_at) ?? null,
        _synced_at: Math.floor(Date.now() / 1000),
      },
      { merge: true }
    );

    // push allocations for toPush budget
    const allocs = await db.getAllAsync<any>(
      `SELECT id,budget_id,category_id,group_type,allocated_amount,created_at FROM budget_allocations WHERE budget_id=?`,
      [p.id]
    );
    for (const a of allocs) {
      const aRef = fs.doc(
        fdb,
        `users/${rUid}/budgets/${p.id}/allocations/${a.id}`
      );
      batch.set(
        aRef,
        {
          id: a.id,
          budget_id: a.budget_id,
          category_id: a.category_id,
          group_type: safeStr(a.group_type) ?? null,
          allocated_amount: toNum(a.allocated_amount) ?? 0,
          created_at: toNum(a.created_at) ?? null,
          _synced_at: Math.floor(Date.now() / 1000),
        },
        { merge: true }
      );
    }
  }

  await batch.commit();
}

/** Convenience: sync all three collections */
export async function syncAllToFirestore(userId?: string): Promise<boolean> {
  const localUid = userId ?? (await getCurrentUserId());
  if (!localUid) throw new Error("No user logged in");

  // Require an authenticated Firebase user; do not fall back silently.
  const { fdb, firestore } = await _getFirestore();
  let authUid: string;
  try {
    authUid = await getAuthUid();
  } catch (e) {
    console.warn(
      "Unable to obtain auth UID — ensure user is signed in before syncing:",
      e
    );
    throw e;
  }

  console.log(
    "syncAllToFirestore: using authUid=",
    authUid,
    "localUid=",
    localUid
  );

  // Cooldown: avoid running full sync too frequently
  try {
    const nowMs = Date.now();
    if (nowMs - _lastSyncRun < SYNC_COOLDOWN_MS) {
      console.log("syncAllToFirestore: skipping due to cooldown");
      return false;
    }
    _lastSyncRun = nowMs;
  } catch (e) {
    // ignore
  }

  // Determine per-collection `since` timestamps (seconds)
  const sinceCategories = Math.trunc(
    (await getLastSyncTime(authUid, "categories")) || 0
  );
  const sinceAccounts = Math.trunc(
    (await getLastSyncTime(authUid, "accounts")) || 0
  );
  const sinceTransactions = Math.trunc(
    (await getLastSyncTime(authUid, "transactions")) || 0
  );
  const sinceBudgets = Math.trunc(
    (await getLastSyncTime(authUid, "budgets")) || 0
  );

  // Decide: pull (if remote already has data) or push (if remote empty).
  try {
    // Ensure document reference has an even number of segments.
    // Use an explicit document id (`meta`) inside the `__meta` subcollection.
    const metaPath = ensureDocPathEven(`users/${authUid}/__meta/meta`);
    const metaRef = firestore.doc(fdb, metaPath);
    const metaSnap = await firestore.getDoc(metaRef);
    if (metaSnap && metaSnap.exists && metaSnap.exists()) {
      // remote has data -> perform pull-then-push reconciliation using per-collection `since`
      await syncAccountsPullAndPush(localUid, authUid, sinceAccounts);
      await syncCategoriesPullAndPush(localUid, authUid, sinceCategories);
      await syncTransactionsPullAndPush(localUid, authUid, sinceTransactions);
      await syncBudgetsPullAndPush(localUid, authUid, sinceBudgets);
    } else {
      // remote empty -> push local to remote (full push)
      await syncAccounts(localUid);
      await syncCategories(localUid);
      await syncTransactions(localUid);
      await syncBudgets(localUid);
      try {
        await firestore.setDoc(
          metaRef,
          { created_at: Math.floor(Date.now() / 1000), owner: authUid },
          { merge: true }
        );
      } catch (e) {
        console.warn("Failed to write remote meta doc:", e);
      }
    }

    // Record last-sync times on success
    const nowSeconds = Math.floor(Date.now() / 1000);
    await Promise.all([
      setLastSyncTime(authUid, "categories", nowSeconds),
      setLastSyncTime(authUid, "accounts", nowSeconds),
      setLastSyncTime(authUid, "transactions", nowSeconds),
      setLastSyncTime(authUid, "budgets", nowSeconds),
    ]).catch(() => {});

    return true;
  } catch (e) {
    console.warn("Error during syncAllToFirestore decision flow:", e);
    return false;
  }
}

/**
 * Wait until Firestore is initialized and Auth initialization has been attempted.
 * Returns after both conditions are met or when `timeoutMs` elapses.
 */
export async function waitForAuthAndFirestoreInit(timeoutMs = 5000) {
  const start = Date.now();
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
  while (true) {
    // Condition: firestore initialized and auth init at least attempted
    if (_initialized && (_authInitialized || _authInitAttempted)) return;
    if (Date.now() - start > timeoutMs) return;
    // small sleep
    // eslint-disable-next-line no-await-in-loop
    await delay(100);
  }
}

/**
 * Mark a remote document as deleted (tombstone) for other clients to pick up.
 * This writes `{ _deleted: true, updated_at: now }` to the remote doc.
 */
export async function markRemoteDeleted(
  collectionName: "categories" | "accounts" | "transactions" | "budgets",
  id: string,
  userId?: string
) {
  const localUid = userId ?? (await getCurrentUserId());
  if (!localUid) return;
  try {
    const { fdb, firestore } = await _getFirestore();
    let rUid: string;
    try {
      rUid = await getAuthUid();
    } catch (_) {
      rUid = localUid;
    }
    const ref = firestore.doc(fdb, `users/${rUid}/${collectionName}/${id}`);
    const now = Math.floor(Date.now() / 1000);
    await firestore.setDoc(
      ref,
      { _deleted: true, updated_at: now, _synced_at: now },
      { merge: true }
    );
  } catch (e) {
    console.warn("markRemoteDeleted failed:", e);
  }
}

/** Pull & merge helpers. Each will pull remote docs and upsert local rows when remote is newer.
 * If local row is newer, it will be queued to push to remote.
 */
async function syncCategoriesPullAndPush(
  userId?: string,
  remoteUid?: string,
  since?: number
) {
  const localUid = userId ?? (await getCurrentUserId());
  if (!localUid) throw new Error("No user logged in");
  const { fdb, firestore } = await _getFirestore();

  const rUid =
    remoteUid ??
    (await (async () => {
      try {
        return await getAuthUid();
      } catch (_) {
        return localUid;
      }
    })());

  // If we have a since timestamp, only pull remote docs updated since then.
  let snap: any = null;
  try {
    const colBase = firestore.collection(fdb, `users/${rUid}/categories`);
    if (
      since &&
      Number.isFinite(since) &&
      since > 0 &&
      firestore.query &&
      firestore.where
    ) {
      const q = firestore.query(
        colBase,
        firestore.where("updated_at", ">", since)
      );
      snap = await firestore.getDocs(q);
    } else {
      const colRef = colBase;
      snap = await firestore.getDocs(colRef);
    }
  } catch (e) {
    console.warn("Failed to query remote categories (pull):", e);
    snap = { docs: [] };
  }

  const remoteIds = new Set<string>();
  const toPush: any[] = [];

  // First, process remote docs
  for (const doc of snap.docs) {
    const data = doc.data();
    const id = safeStr(data.id ?? doc.id);
    remoteIds.add(id);
    if (data._deleted) {
      // remote tombstone -> delete local
      await db.runAsync(`DELETE FROM categories WHERE id=? AND user_id=?`, [
        id,
        localUid,
      ]);
      continue;
    }

    const remoteUpdated = toNum(data.updated_at) ?? 0;
    const local = await db.getFirstAsync<any>(
      `SELECT * FROM categories WHERE id=? AND user_id=?`,
      [id, localUid]
    );
    if (!local) {
      // insert
      await db.runAsync(
        `INSERT OR REPLACE INTO categories(id,user_id,name,type,icon,color,parent_id,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        [
          id,
          localUid,
          safeStr(data.name),
          safeStr(data.type),
          safeStr(data.icon),
          safeStr(data.color),
          safeStr(data.parent_id),
          toNum(data.created_at) ?? null,
          remoteUpdated || null,
        ]
      );
      continue;
    }

    const localUpdated = Number(local.updated_at) || 0;
    if (remoteUpdated > localUpdated) {
      // remote wins
      await db.runAsync(
        `UPDATE categories SET name=?, type=?, icon=?, color=?, parent_id=?, updated_at=? WHERE id=? AND user_id=?`,
        [
          safeStr(data.name),
          safeStr(data.type),
          safeStr(data.icon),
          safeStr(data.color),
          safeStr(data.parent_id),
          remoteUpdated || null,
          id,
          localUid,
        ]
      );
    } else if (localUpdated > remoteUpdated) {
      // local newer -> push later
      toPush.push({ id, row: local });
    }
  }

  // push local rows that are missing remotely or newer
  // collect all local rows
  const locals = await db.getAllAsync<any>(
    `SELECT id,name,type,icon,color,parent_id,created_at,updated_at FROM categories WHERE user_id=?`,
    [localUid]
  );
  // reuse the firestore module obtained earlier to ensure writeBatch exists
  const fs = firestore;
  const batch = fs.writeBatch(fdb);
  for (const l of locals) {
    if (!remoteIds.has(l.id)) {
      const ref = fs.doc(fdb, `users/${rUid}/categories/${l.id}`);
      batch.set(
        ref,
        {
          id: l.id,
          name: l.name,
          type: l.type,
          icon: l.icon ?? null,
          color: l.color ?? null,
          parent_id: l.parent_id ?? null,
          created_at: toNum(l.created_at),
          updated_at: toNum(l.updated_at),
          _synced_at: Math.floor(Date.now() / 1000),
        },
        { merge: true }
      );
    }
  }

  for (const p of toPush) {
    const ref = fs.doc(fdb, `users/${rUid}/categories/${p.id}`);
    batch.set(
      ref,
      {
        id: p.id,
        name: p.row.name,
        type: p.row.type,
        icon: p.row.icon ?? null,
        color: p.row.color ?? null,
        parent_id: p.row.parent_id ?? null,
        created_at: toNum(p.row.created_at),
        updated_at: toNum(p.row.updated_at),
        _synced_at: Math.floor(Date.now() / 1000),
      },
      { merge: true }
    );
  }

  await batch.commit();
}

async function syncAccountsPullAndPush(
  userId?: string,
  remoteUid?: string,
  since?: number
) {
  const localUid = userId ?? (await getCurrentUserId());
  if (!localUid) throw new Error("No user logged in");
  const { fdb, firestore } = await _getFirestore();

  const rUid =
    remoteUid ??
    (await (async () => {
      try {
        return await getAuthUid();
      } catch (_) {
        return localUid;
      }
    })());

  let snap: any = null;
  try {
    const colBase = firestore.collection(fdb, `users/${rUid}/accounts`);
    if (
      since &&
      Number.isFinite(since) &&
      since > 0 &&
      firestore.query &&
      firestore.where
    ) {
      const q = firestore.query(
        colBase,
        firestore.where("updated_at", ">", since)
      );
      snap = await firestore.getDocs(q);
    } else {
      snap = await firestore.getDocs(colBase);
    }
  } catch (e) {
    console.warn("Failed to query remote accounts (pull):", e);
    snap = { docs: [] };
  }

  const remoteIds = new Set<string>();
  const toPush: any[] = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const id = safeStr(data.id ?? doc.id);
    remoteIds.add(id);
    if (data._deleted) {
      await db.runAsync(`DELETE FROM accounts WHERE id=? AND user_id=?`, [
        id,
        localUid,
      ]);
      continue;
    }

    const remoteUpdated = toNum(data.updated_at) ?? 0;
    const local = await db.getFirstAsync<any>(
      `SELECT * FROM accounts WHERE id=? AND user_id=?`,
      [id, localUid]
    );
    if (!local) {
      await db.runAsync(
        `INSERT OR REPLACE INTO accounts(id,user_id,name,icon,color,balance_cached,include_in_total,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        [
          id,
          localUid,
          safeStr(data.name),
          safeStr(data.icon),
          safeStr(data.color),
          toNum(data.balance_cached) ?? 0,
          data.include_in_total ? 1 : 0,
          toNum(data.created_at) ?? null,
          remoteUpdated || null,
        ]
      );
      continue;
    }

    const localUpdated = Number(local.updated_at) || 0;
    if (remoteUpdated > localUpdated) {
      // Do not overwrite local `balance_cached` from remote — local balance should be
      // authoritative via transaction history. Update other metadata only.
      await db.runAsync(
        `UPDATE accounts SET name=?, icon=?, color=?, include_in_total=?, updated_at=? WHERE id=? AND user_id=?`,
        [
          safeStr(data.name),
          safeStr(data.icon),
          safeStr(data.color),
          data.include_in_total ? 1 : 0,
          remoteUpdated || null,
          id,
          localUid,
        ]
      );
    } else if (localUpdated > remoteUpdated) {
      toPush.push({ id, row: local });
    }
  }

  // Compute balances to use when pushing local accounts
  const computed = await computeAccountBalances(localUid);
  // Only push local rows changed since `since` if provided; otherwise push missing locals
  let localsSql = `SELECT id,name,icon,color,include_in_total,created_at,updated_at FROM accounts WHERE user_id=?`;
  const localsArgs: any[] = [localUid];
  if (since && Number.isFinite(since) && since > 0) {
    localsSql += ` AND (updated_at > ? OR created_at > ?)`;
    localsArgs.push(since, since);
  }
  const locals = await db.getAllAsync<any>(localsSql, localsArgs);
  const fs = firestore;
  const batch = fs.writeBatch(fdb);
  for (const l of locals) {
    if (!remoteIds.has(l.id)) {
      const ref = fs.doc(fdb, `users/${rUid}/accounts/${l.id}`);
      batch.set(
        ref,
        {
          id: l.id,
          name: l.name,
          icon: l.icon ?? null,
          color: l.color ?? null,
          balance_cached: toNum(computed[l.id]) ?? 0,
          include_in_total: l.include_in_total ? 1 : 0,
          created_at: toNum(l.created_at),
          updated_at: toNum(l.updated_at),
          _synced_at: Math.floor(Date.now() / 1000),
        },
        { merge: true }
      );
    }
  }

  for (const p of toPush) {
    const ref = fs.doc(fdb, `users/${rUid}/accounts/${p.id}`);
    batch.set(
      ref,
      {
        id: p.id,
        name: p.row.name,
        icon: p.row.icon ?? null,
        color: p.row.color ?? null,
        balance_cached: toNum(computed[p.id]) ?? 0,
        include_in_total: p.row.include_in_total ? 1 : 0,
        created_at: toNum(p.row.created_at),
        updated_at: toNum(p.row.updated_at),
        _synced_at: Math.floor(Date.now() / 1000),
      },
      { merge: true }
    );
  }

  await batch.commit();
}

async function syncTransactionsPullAndPush(
  userId?: string,
  remoteUid?: string,
  since?: number
) {
  const localUid = userId ?? (await getCurrentUserId());
  if (!localUid) throw new Error("No user logged in");
  const { fdb, firestore } = await _getFirestore();

  const rUid =
    remoteUid ??
    (await (async () => {
      try {
        return await getAuthUid();
      } catch (_) {
        return localUid;
      }
    })());

  let snap: any = null;
  try {
    const colBase = firestore.collection(fdb, `users/${rUid}/transactions`);
    if (
      since &&
      Number.isFinite(since) &&
      since > 0 &&
      firestore.query &&
      firestore.where
    ) {
      const q = firestore.query(
        colBase,
        firestore.where("updated_at", ">", since)
      );
      snap = await firestore.getDocs(q);
    } else {
      snap = await firestore.getDocs(colBase);
    }
  } catch (e) {
    console.warn("Failed to query remote transactions (pull):", e);
    snap = { docs: [] };
  }

  const remoteIds = new Set<string>();
  const toPush: any[] = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const id = safeStr(data.id ?? doc.id);
    remoteIds.add(id);
    if (data._deleted) {
      await db.runAsync(`DELETE FROM transactions WHERE id=? AND user_id=?`, [
        id,
        localUid,
      ]);
      continue;
    }

    const remoteUpdated = toNum(data.updated_at) ?? 0;
    const local = await db.getFirstAsync<any>(
      `SELECT * FROM transactions WHERE id=? AND user_id=?`,
      [id, localUid]
    );
    if (!local) {
      // Insert transaction; foreign keys rely on accounts/categories being present
      await db.runAsync(
        `INSERT OR REPLACE INTO transactions(id,user_id,account_id,category_id,type,amount,note,occurred_at,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          localUid,
          safeStr(data.account_id),
          safeStr(data.category_id),
          safeStr(data.type),
          toNum(data.amount) ?? 0,
          safeStr(data.note),
          toNum(data.occurred_at) ?? null,
          toNum(data.created_at) ?? null,
          remoteUpdated || null,
        ]
      );
      continue;
    }

    const localUpdated = Number(local.updated_at) || 0;
    if (remoteUpdated > localUpdated) {
      await db.runAsync(
        `UPDATE transactions SET account_id=?, category_id=?, type=?, amount=?, note=?, occurred_at=?, updated_at=? WHERE id=? AND user_id=?`,
        [
          safeStr(data.account_id),
          safeStr(data.category_id),
          safeStr(data.type),
          toNum(data.amount) ?? 0,
          safeStr(data.note),
          toNum(data.occurred_at) ?? null,
          remoteUpdated || null,
          id,
          localUid,
        ]
      );
    } else if (localUpdated > remoteUpdated) {
      toPush.push({ id, row: local });
    }
  }

  let localsSql = `SELECT id,account_id,category_id,type,amount,note,occurred_at,created_at,updated_at FROM transactions WHERE user_id=?`;
  const localsArgs: any[] = [localUid];
  if (since && Number.isFinite(since) && since > 0) {
    localsSql += ` AND (updated_at > ? OR created_at > ?)`;
    localsArgs.push(since, since);
  }
  const locals = await db.getAllAsync<any>(localsSql, localsArgs);
  const fs = firestore;
  const batch = fs.writeBatch(fdb);
  for (const l of locals) {
    if (!remoteIds.has(l.id)) {
      const ref = fs.doc(fdb, `users/${rUid}/transactions/${l.id}`);
      batch.set(
        ref,
        {
          id: l.id,
          account_id: l.account_id,
          category_id: l.category_id ?? null,
          type: l.type,
          amount: toNum(l.amount) ?? 0,
          note: l.note ?? null,
          occurred_at: toNum(l.occurred_at),
          created_at: toNum(l.created_at),
          updated_at: toNum(l.updated_at),
          _synced_at: Math.floor(Date.now() / 1000),
        },
        { merge: true }
      );
    }
  }

  for (const p of toPush) {
    const ref = fs.doc(fdb, `users/${rUid}/transactions/${p.id}`);
    batch.set(
      ref,
      {
        id: p.id,
        account_id: p.row.account_id,
        category_id: p.row.category_id ?? null,
        type: p.row.type,
        amount: toNum(p.row.amount) ?? 0,
        note: p.row.note ?? null,
        occurred_at: toNum(p.row.occurred_at),
        created_at: toNum(p.row.created_at),
        updated_at: toNum(p.row.updated_at),
        _synced_at: Math.floor(Date.now() / 1000),
      },
      { merge: true }
    );
  }

  await batch.commit();
}

export default {
  initFirestore,
  syncCategories,
  syncAccounts,
  syncTransactions,
  syncBudgets,
  syncAllToFirestore,
};
