import syncState from "@/services/syncState";

export async function syncAll(userId?: string): Promise<void> {
  console.log("Starting sync for user:", userId ?? "(current)");
  syncState.setStatus("syncing");

  const startedAt = Math.floor(Date.now() / 1000);

  // Try Firestore sync (if available/initialized). If anything fails, fall back
  // to a no-op but keep logging the error for debugging.
  try {
    // dynamic import so the app won't crash if module missing
    const syncModule = await import("@/services/firestoreSync");
    if (syncModule) {
      // If Firebase Auth isn't signed in, skip attempting Firestore sync.
      if (typeof syncModule.isFirebaseSignedIn === "function") {
        try {
          const signedIn = await syncModule.isFirebaseSignedIn();
          if (!signedIn) {
            console.warn(
              "Skipping Firestore sync: no authenticated Firebase user"
            );
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
        await syncModule.syncAllToFirestore(userId);
      }
      syncState.setLastSynced(Math.floor(Date.now() / 1000));
      syncState.setStatus("idle");
      console.log("Firestore sync complete for user:", userId ?? "(current)");
      return;
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
  syncState.setLastSynced(Math.floor(Date.now() / 1000));
  syncState.setStatus("idle");
  console.log("Sync finished (fallback) for user:", userId ?? "(current)");
}
