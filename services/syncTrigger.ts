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
      let online = true;
      try {
        const NetInfo = await import("@react-native-community/netinfo");
        if (NetInfo && NetInfo.fetch) {
          const state = await NetInfo.fetch();
          online = !!state.isConnected;
        }
      } catch (e) {
        // netinfo not installed; assume online
      }
      if (!online) {
        // schedule retry with backoff
        const rc = (retryCounts.get(key) ?? 0) + 1;
        retryCounts.set(key, rc);
        const backoff = Math.min(60_000, 1000 * Math.pow(2, rc));
        scheduleSyncDebounced(userId, backoff);
        return;
      }

      const svc = await import("@/services/syncService");
      await svc.syncAll(userId);
      lastSyncTs.set(key, Date.now());
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
    const svc = await import("@/services/syncService");
    await svc.syncAll(userId);
    lastSyncTs.set(key, Date.now());
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
