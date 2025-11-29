// services/syncTrigger.ts
// Debounced sync trigger to avoid excessive sync calls after many repo writes.

const timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
// Simple counters for observability/optimization
const stats = {
  coalescedCalls: 0,
  scheduledCalls: 0,
  immediateCalls: 0,
};
const DEFAULT_DELAY_MS = 4000; // 4 seconds debounce
const lastSyncTs: Map<string, number> = new Map();
const retryCounts: Map<string, number> = new Map();
const MIN_INTERVAL_MS = 15_000; // don't perform sync more often than every 15s per user

/**
 * Schedule a debounced sync for a specific user (or current user if not provided).
 * Multiple calls within the debounce window will coalesce into a single sync.
 */
export function scheduleSyncDebounced(
  userId?: string,
  delayMs = DEFAULT_DELAY_MS
) {
  const key = userId ?? "__global";
  const existing = timers.get(key);
  if (existing) {
    // existing pending timer -> this call will be coalesced
    stats.coalescedCalls++;
    clearTimeout(existing);
  }

  const t = setTimeout(async () => {
    stats.scheduledCalls++;
    timers.delete(key);
    try {
      // Rate limit: if last sync was recent, schedule a short-delay instead of running now
      const last = lastSyncTs.get(key) ?? 0;
      const elapsed = Date.now() - last;
      if (elapsed < MIN_INTERVAL_MS) {
        // schedule to run after remaining time
        const remaining = MIN_INTERVAL_MS - elapsed + 1000;
        scheduleSyncDebounced(userId, Math.max(1000, remaining));
        return;
      }

      // Try to detect offline state (best-effort). If NetInfo is available, use it.
      // Be defensive: handle default export, missing native module, and call failures.
      let online = true;
      try {
        const netMod = await import("@react-native-community/netinfo");
        const NetInfo = (netMod && (netMod.default || netMod)) as any;
        const fetchFn = NetInfo && (NetInfo.fetch || NetInfo.getCurrentState);
        if (typeof fetchFn === "function") {
          try {
            // Call the available API and guard against native errors
            const state = await fetchFn.call(NetInfo);
            online = !!(state && state.isConnected);
          } catch (callErr) {
            console.warn(
              "NetInfo available but fetch/getCurrentState failed:",
              callErr
            );
            // If NetInfo is broken (native module missing), assume online to avoid crashes
            online = true;
          }
        }
      } catch (e) {
        // netinfo not installed or import failed; assume online
      }
      if (!online) {
        // schedule retry with backoff
        const rc = (retryCounts.get(key) ?? 0) + 1;
        retryCounts.set(key, rc);
        const backoff = Math.min(60_000, 1000 * Math.pow(2, rc));
        scheduleSyncDebounced(userId, backoff);
        return;
      }

      // Check Firebase sign-in before attempting sync to avoid repeated skips.
      try {
        const fsync = await import("@/services/firestoreSync");
        if (fsync && typeof fsync.isFirebaseSignedIn === "function") {
          try {
            const signedIn = await fsync.isFirebaseSignedIn();
            if (!signedIn) {
              console.warn(
                "Skipping Firestore sync: no authenticated Firebase user"
              );
              // schedule retry later with backoff
              const rc = (retryCounts.get(key) ?? 0) + 1;
              retryCounts.set(key, rc);
              const backoff = Math.min(60_000, 1000 * Math.pow(2, rc));
              scheduleSyncDebounced(userId, backoff);
              return;
            }
          } catch (e) {
            // If check failed, fall through to attempt sync
            console.warn(
              "isFirebaseSignedIn check failed, proceeding to attempt sync:",
              e
            );
          }
        }
      } catch (e) {
        // ignore import errors and proceed
      }

      const svc = await import("@/services/syncService");
      try {
        const did = await svc.syncAll(userId);
        if (did) {
          lastSyncTs.set(key, Date.now());
        }
      } catch (e) {
        throw e;
      }
      retryCounts.delete(key);
    } catch (e) {
      console.warn("Debounced sync failed:", e);
      // on failure schedule retry with exponential backoff
      const rc = (retryCounts.get(key) ?? 0) + 1;
      retryCounts.set(key, rc);
      const backoff = Math.min(60_000, 1000 * Math.pow(2, rc));
      scheduleSyncDebounced(userId, backoff);
    }
  }, delayMs) as ReturnType<typeof setTimeout>;

  timers.set(key, t);
}

/** Trigger an immediate sync (cancels any pending debounced sync). */
export async function triggerImmediate(userId?: string) {
  const key = userId ?? "__global";
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.delete(key);
  stats.immediateCalls++;
  try {
    // Check Firebase sign-in before attempting sync
    try {
      const fsync = await import("@/services/firestoreSync");
      if (fsync && typeof fsync.isFirebaseSignedIn === "function") {
        const signedIn = await fsync.isFirebaseSignedIn();
        if (!signedIn) {
          console.warn(
            "Skipping Firestore sync (immediate): no authenticated Firebase user"
          );
          const rc = (retryCounts.get(key) ?? 0) + 1;
          retryCounts.set(key, rc);
          const backoff = Math.min(60_000, 1000 * Math.pow(2, rc));
          scheduleSyncDebounced(userId, backoff);
          return;
        }
      }
    } catch (e) {
      // ignore and proceed
    }

    const svc = await import("@/services/syncService");
    const did = await svc.syncAll(userId);
    if (did) lastSyncTs.set(key, Date.now());
    retryCounts.delete(key);
  } catch (e) {
    console.warn("Immediate sync failed:", e);
    const rc = (retryCounts.get(key) ?? 0) + 1;
    retryCounts.set(key, rc);
    const backoff = Math.min(60_000, 1000 * Math.pow(2, rc));
    scheduleSyncDebounced(userId, backoff);
  }
}

export function getSyncTriggerStats() {
  return { ...stats };
}

export default { scheduleSyncDebounced, triggerImmediate, getSyncTriggerStats };
