export async function syncAll(userId: string): Promise<void> {
  // Placeholder sync implementation.
  // TODO: replace with real server sync logic (upload local DB, pull remote updates).
  console.log("Starting sync for user:", userId);
  // Simulate work
  await new Promise((resolve) => setTimeout(resolve, 1200));
  console.log("Sync complete for user:", userId);
}
