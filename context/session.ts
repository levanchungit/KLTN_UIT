// src/session.ts
import * as SecureStore from "expo-secure-store";

export type UserSession = {
  id: string;
  username: string;
  name?: string | null;
  image?: string | null;
};

const KEY = "user_session";

export async function saveSession(user: UserSession) {
  await SecureStore.setItemAsync(KEY, JSON.stringify(user));
}

export async function loadSession(): Promise<UserSession | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function clearSession() {
  await SecureStore.deleteItemAsync(KEY);
}
