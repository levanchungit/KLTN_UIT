import syncState from "@/services/syncState";

// Coalesce concurrent syncAll calls so we don't run multiple parallel syncs
let _syncInFlight: Promise<boolean> | null = null;

export async function syncAll(userId?: string): Promise<boolean> {
  // If a sync is already in-flight, return the same promise (coalesce)
  if (_syncInFlight) {
    console.log(
      "syncAll: coalescing concurrent call for user:",
      userId ?? "(current)"
    );
    return _syncInFlight;
  }

  // Run sync in-flight marker
  _syncInFlight = (async () => {
    console.log("Starting sync for user:", userId ?? "(current)");
    syncState.setStatus("syncing");

    const startedAt = Math.floor(Date.now() / 1000);
    let didAnySync = false;

    // Try Firestore sync (if available/initialized). If anything fails, fall back
    // to a no-op but keep logging the error for debugging.
    try {
      // dynamic import so the app won't crash if module missing
      const syncModule = await import("@/services/firestoreSync");
      if (syncModule) {
        // Wait for Firestore + Auth init logs to complete (or timeout)
        if (typeof syncModule.waitForAuthAndFirestoreInit === "function") {
          try {
            await syncModule.waitForAuthAndFirestoreInit(5000);
          } catch (e) {
            // ignore
          }
        }
        // If Firebase Auth isn't signed in, skip attempting Firestore sync
        // and schedule a retry shortly after (best-effort).
        if (typeof syncModule.isFirebaseSignedIn === "function") {
          try {
            const signedIn = await syncModule.isFirebaseSignedIn();
            if (!signedIn) {
              console.warn(
                "Skipping Firestore sync: no authenticated Firebase user"
              );
              // schedule retry after short delay so when auth finishes we resync
              try {
                const trig = await import("@/services/syncTrigger");
                if (trig && typeof trig.scheduleSyncDebounced === "function") {
                  // small delay (2s) to avoid tight loops while auth finishes
                  trig.scheduleSyncDebounced(userId, 2000);
                }
              } catch (e) {
                // ignore scheduling errors
              }
              syncState.setStatus("idle");
              return;
            }
          } catch (e) {
            // if check failed, fall through to attempt sync which will error later
            console.warn(
              "isFirebaseSignedIn check failed, proceeding to attempt sync:",
              e
            );
          }
        }

        if (syncModule.syncAllToFirestore) {
          try {
            const didSync = await syncModule.syncAllToFirestore(userId);
            if (didSync) {
              didAnySync = true;
              syncState.setLastSynced(Math.floor(Date.now() / 1000));
              console.log(
                "Firestore sync complete for user:",
                userId ?? "(current)"
              );
            } else {
              console.log(
                "Firestore sync skipped (no work performed) for user:",
                userId ?? "(current)"
              );
            }
          } catch (e) {
            console.warn("syncAllToFirestore threw:", e);
            // treat as no successful sync
          }
        }
        syncState.setStatus("idle");
        return didAnySync;
      }
    } catch (err: any) {
      console.warn(
        "Firestore sync failed or not configured:",
        err?.message ?? err
      );
      syncState.setStatus("error", String(err?.message ?? err));
    }

    // Fallback behavior: keep placeholder timing so callers don't hang.
    await new Promise((resolve) => setTimeout(resolve, 500));
    // Do NOT mark lastSynced on fallback — treat as no real sync
    syncState.setStatus("idle");
    console.log("Sync finished (fallback) for user:", userId ?? "(current)");
    return false;
  })();

  try {
    return await _syncInFlight;
  } finally {
    _syncInFlight = null;
  }
}

export default { syncAll };
