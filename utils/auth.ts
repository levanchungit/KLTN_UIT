// utils/auth.ts
import { loadSession } from "@/context/session";

/**
 * Get the current user's ID. Throws if no user is logged in.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const session = await loadSession();
  return session && session.id ? session.id : null;
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
  if (!userId) throw new Error("USER_NOT_LOGGED_IN");
  return userId;
}

/**
 * Initialize local user session if no session exists
 */
// Note: local_user support removed. The app requires a signed-in user to operate.
export async function ensureLocalUser(): Promise<void> {
  // No-op kept for compatibility — previously created local user concept removed.
  return;
}
