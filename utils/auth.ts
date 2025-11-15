// utils/auth.ts
import { loadSession, saveSession } from "@/context/session";

const LOCAL_USER_ID = "local_user";

/**
 * Get the current user's ID.
 * Returns local user ID if not logged in (for offline SQLite usage).
 */
export async function getCurrentUserId(): Promise<string> {
  const session = await loadSession();
  return session?.id || LOCAL_USER_ID;
}

/**
 * Check if user is logged in with an account
 */
export async function isUserLoggedIn(): Promise<boolean> {
  const session = await loadSession();
  return session !== null;
}

/**
 * Get user ID or throw error if not logged in
 */
export async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error("USER_NOT_LOGGED_IN");
  }
  return userId;
}

/**
 * Initialize local user session if no session exists
 */
export async function ensureLocalUser(): Promise<void> {
  const session = await loadSession();
  if (!session) {
    // Create local user session for offline usage
    await saveSession({
      id: LOCAL_USER_ID,
      username: "Local User",
    });
  }
}
