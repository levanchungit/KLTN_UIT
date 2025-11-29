// src/session.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";
import * as SecureStore from "expo-secure-store";

export type UserSession = {
  id: string;
  username: string;
  name?: string | null;
  image?: string | null;
};

const KEY = "user_session";

// Check if SecureStore is available (not in Expo Go)
const isSecureStoreAvailable = async (): Promise<boolean> => {
  try {
    // Try to access SecureStore
    await SecureStore.getItemAsync("test");
    return true;
  } catch (error) {
    console.log(
      "SecureStore not available, using AsyncStorage fallback:",
      error
    );
    return false;
  }
};

export async function saveSession(user: UserSession) {
  console.log("Saving session for user:", user.username);
  try {
    const secureAvailable = await isSecureStoreAvailable();
    if (secureAvailable) {
      await SecureStore.setItemAsync(KEY, JSON.stringify(user));
      console.log("Session saved to SecureStore");
    } else {
      await AsyncStorage.setItem(KEY, JSON.stringify(user));
      console.log("Session saved to AsyncStorage (fallback)");
    }
    // Also write a small file for native widget to read user id
    try {
      const path =
        (FileSystem.documentDirectory || "") + "kltn_widget_user.json";
      await FileSystem.writeAsStringAsync(
        path,
        JSON.stringify({ id: user.id, username: user.username })
      );
      console.log("Wrote widget user file:", path);
    } catch (e) {
      console.log("Failed to write widget user file", e);
    }
  } catch (error) {
    console.log("Error saving session:", error);
    // Try AsyncStorage as last resort
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(user));
      console.log("Session saved to AsyncStorage (fallback after error)");
      // write file (best effort)
      try {
        const path =
          (FileSystem.documentDirectory || "") + "kltn_widget_user.json";
        await FileSystem.writeAsStringAsync(
          path,
          JSON.stringify({ id: user.id, username: user.username })
        );
        console.log("Wrote widget user file (fallback):", path);
      } catch (e) {
        console.log("Failed to write widget user file (fallback)", e);
      }
    } catch (fallbackError) {
      console.log("Failed to save session to any storage:", fallbackError);
    }
  }
}

export async function loadSession(): Promise<UserSession | null> {
  try {
    const secureAvailable = await isSecureStoreAvailable();
    let raw: string | null = null;

    if (secureAvailable) {
      raw = await SecureStore.getItemAsync(KEY);
    } else {
      raw = await AsyncStorage.getItem(KEY);
      console.log("Loaded from AsyncStorage (fallback):", raw);
    }

    if (!raw) {
      console.log("No session data found");
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      return parsed;
    } catch (error) {
      console.log("Error parsing session:", error);
      return null;
    }
  } catch (error) {
    console.log("Error loading session, trying AsyncStorage fallback:", error);
    // Try AsyncStorage as last resort
    try {
      const raw = await AsyncStorage.getItem(KEY);
      console.log("Loaded from AsyncStorage (fallback after error):", raw);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed;
    } catch (fallbackError) {
      console.log("Failed to load session from any storage:", fallbackError);
      return null;
    }
  }
}

export async function clearSession() {
  console.log("Clearing session");
  try {
    const secureAvailable = await isSecureStoreAvailable();
    if (secureAvailable) {
      await SecureStore.deleteItemAsync(KEY);
      console.log("Session cleared from SecureStore");
    } else {
      await AsyncStorage.removeItem(KEY);
      console.log("Session cleared from AsyncStorage (fallback)");
    }
  } catch (error) {
    console.log(
      "Error clearing session from primary storage, trying fallback:",
      error
    );
    // Try AsyncStorage as fallback
    try {
      await AsyncStorage.removeItem(KEY);
      console.log("Session cleared from AsyncStorage (fallback after error)");
    } catch (fallbackError) {
      console.log("Failed to clear session from any storage:", fallbackError);
    }
  }
}
