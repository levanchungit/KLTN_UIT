// services/firestoreSync.ts
// Lightweight Firestore sync helpers for categories, transactions and accounts.
// NOTE: This file expects the Firebase JS SDK (v9 modular) to be installed.
// Install with: `npm install firebase` or `yarn add firebase`.

import { db } from "@/db";
import { getCurrentUserId } from "@/utils/auth";

// Use lazy imports so the app won't crash if firebase isn't installed yet.
let _initialized = false;
let _firestore: any = null;
let _fsModule: any = null;
let _firebaseApp: any = null;
let _authInitialized = false;

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

  // Initialize Firebase Auth for React Native. This must run before any getAuth() calls
  try {
    const authMod: any = await import("firebase/auth");
    if (authMod && authMod.initializeAuth) {
      try {
        // prefer AsyncStorage persistence if available
        const RNAsyncStorage = await import(
          "@react-native-async-storage/async-storage"
        );
        try {
          authMod.initializeAuth(
            _firebaseApp || (firebaseApp.getApp && firebaseApp.getApp()),
            {
              persistence: authMod.getReactNativePersistence(
                RNAsyncStorage.default || RNAsyncStorage
              ),
            }
          );
          _authInitialized = true;
          console.log(
            "Firebase Auth initialized with ReactNative AsyncStorage persistence"
          );
        } catch (ie) {
          // fallback to initialize without persistence option
          try {
            authMod.initializeAuth(
              _firebaseApp || (firebaseApp.getApp && firebaseApp.getApp())
            );
            _authInitialized = true;
            console.log(
              "Firebase Auth initialized (no AsyncStorage available)"
            );
          } catch (ie2) {
            console.warn("initializeAuth failed:", ie2);
          }
        }
      } catch (rnErr) {
        // AsyncStorage not installed; initialize auth without persistence
        try {
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
          const RNAsyncStorage = await import(
            "@react-native-async-storage/async-storage"
          );
          try {
            authMod.initializeAuth(_firebaseApp || undefined, {
              persistence: authMod.getReactNativePersistence(
                RNAsyncStorage.default || RNAsyncStorage
              ),
            });
            _authInitialized = true;
            console.log(
              "Firebase Auth initialized with ReactNative AsyncStorage persistence (ensure)"
            );
            return;
          } catch (ie) {
            // fallback to initialize without persistence
          }
        } catch (rnErr) {
          // AsyncStorage not available
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

/** Sync categories to Firestore under `users/{userId}/categories/{categoryId}` */
export async function syncCategories(userId?: string) {
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

  // load local categories
  const cats = await db.getAllAsync<any>(
    `SELECT id, name, type, icon, color, parent_id, created_at, updated_at FROM categories WHERE user_id=?`,
    [localUid]
  );

  // batch write
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
export async function syncAccounts(userId?: string) {
  const localUid = userId ?? (await getCurrentUserId());
  if (!localUid) throw new Error("No user logged in");

  const { fdb, firestore } = await _getFirestore();

  let rUid: string;
  try {
    rUid = await getAuthUid();
  } catch (e) {
    rUid = localUid;
  }

  const accs = await db.getAllAsync<any>(
    `SELECT id, name, icon, color, balance_cached, include_in_total, created_at, updated_at FROM accounts WHERE user_id=?`,
    [localUid]
  );

  const batch = firestore.writeBatch(fdb);
  for (const a of accs) {
    const ref = firestore.doc(fdb, `users/${rUid}/accounts/${a.id}`);
    const payload = {
      id: a.id,
      name: a.name,
      icon: a.icon ?? null,
      color: a.color ?? null,
      balance_cached: toNum(a.balance_cached) ?? 0,
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
export async function syncTransactions(userId?: string) {
  const localUid = userId ?? (await getCurrentUserId());
  if (!localUid) throw new Error("No user logged in");

  const { fdb, firestore } = await _getFirestore();

  let rUid: string;
  try {
    rUid = await getAuthUid();
  } catch (e) {
    rUid = localUid;
  }

  const txs = await db.getAllAsync<any>(
    `SELECT id, account_id, category_id, type, amount, note, occurred_at, created_at, updated_at FROM transactions WHERE user_id=?`,
    [localUid]
  );

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

/** Convenience: sync all three collections */
export async function syncAllToFirestore(userId?: string) {
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

  // Decide: pull (if remote already has data) or push (if remote empty).
  try {
    const metaRef = firestore.doc(fdb, `users/${authUid}/__meta`);
    const metaSnap = await firestore.getDoc(metaRef);
    if (metaSnap && metaSnap.exists && metaSnap.exists()) {
      // remote has data -> perform pull-then-push reconciliation
      await syncAccountsPullAndPush(localUid, authUid);
      await syncCategoriesPullAndPush(localUid, authUid);
      await syncTransactionsPullAndPush(localUid, authUid);
    } else {
      // remote empty -> push local to remote and create meta marker
      await syncAccounts(localUid);
      await syncCategories(localUid);
      await syncTransactions(localUid);
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
  } catch (e) {
    console.warn("Error during syncAllToFirestore decision flow:", e);
    throw e;
  }
}

/**
 * Mark a remote document as deleted (tombstone) for other clients to pick up.
 * This writes `{ _deleted: true, updated_at: now }` to the remote doc.
 */
export async function markRemoteDeleted(
  collectionName: "categories" | "accounts" | "transactions",
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
async function syncCategoriesPullAndPush(userId?: string, remoteUid?: string) {
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

  const colRef = firestore.collection(fdb, `users/${rUid}/categories`);
  const snap = await firestore.getDocs(colRef);

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

async function syncAccountsPullAndPush(userId?: string, remoteUid?: string) {
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

  const colRef = firestore.collection(fdb, `users/${rUid}/accounts`);
  const snap = await firestore.getDocs(colRef);

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
      await db.runAsync(
        `UPDATE accounts SET name=?, icon=?, color=?, balance_cached=?, include_in_total=?, updated_at=? WHERE id=? AND user_id=?`,
        [
          safeStr(data.name),
          safeStr(data.icon),
          safeStr(data.color),
          toNum(data.balance_cached) ?? 0,
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

  const locals = await db.getAllAsync<any>(
    `SELECT id,name,icon,color,balance_cached,include_in_total,created_at,updated_at FROM accounts WHERE user_id=?`,
    [localUid]
  );
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
          balance_cached: toNum(l.balance_cached) ?? 0,
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
        balance_cached: toNum(p.row.balance_cached) ?? 0,
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
  remoteUid?: string
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

  const colRef = firestore.collection(fdb, `users/${rUid}/transactions`);
  const snap = await firestore.getDocs(colRef);

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
          uid,
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
          uid,
        ]
      );
    } else if (localUpdated > remoteUpdated) {
      toPush.push({ id, row: local });
    }
  }

  const locals = await db.getAllAsync<any>(
    `SELECT id,account_id,category_id,type,amount,note,occurred_at,created_at,updated_at FROM transactions WHERE user_id=?`,
    [uid]
  );
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
  syncAllToFirestore,
};
