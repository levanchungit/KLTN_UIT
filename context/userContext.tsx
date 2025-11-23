// src/userContext.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";
import { NativeModules } from "react-native";
import { clearSession, loadSession, saveSession, UserSession } from "./session";

type Ctx = {
  user: UserSession | null;
  setUser: (u: UserSession | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  loginSet: (u: UserSession) => Promise<void>;
  isLoading: boolean;
};

const UserCtx = createContext<Ctx | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    console.log("UserProvider: Loading session on mount");
    (async () => {
      try {
        const u = await loadSession();
        console.log("UserProvider: Loaded user:", u);
        setUser(u);
      } catch (error) {
        console.log("UserProvider: Error loading session:", error);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const refresh = async () => {
    const u = await loadSession();
    setUser(u);
  };

  const loginSet = async (u: UserSession) => {
    // Persist session for authenticated user. The app requires an authenticated
    // user during usage; there is no 'local_user' ownership mode.
    await saveSession(u);
    setUser(u);
    setIsLoading(false);
  };

  const logout = async () => {
    console.log("Logging out user...");
    // Do NOT migrate or change DB ownership on logout. Clear saved session only.
    await clearSession();

    // Clear AsyncStorage cache to allow fresh login with different Google account
    try {
      console.log("Clearing AsyncStorage cache...");
      // Clear all AsyncStorage data to ensure fresh login
      await AsyncStorage.clear();
      console.log("AsyncStorage fully cleared");
    } catch (e) {
      console.warn("Failed to clear AsyncStorage:", e);
    }
    // Try to sign out the native GoogleSignin module so the next Google login
    // can pick a different account. Guard against running in Expo Go or when
    // the native module isn't registered.
    try {
      console.log("Signing out from Google...");
      if (NativeModules && (NativeModules as any).RNGoogleSignin) {
        // Require dynamically to avoid top-level native import that crashes in Expo Go
        // if the native module isn't present.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const {
          GoogleSignin,
        } = require("@react-native-google-signin/google-signin");
        if (GoogleSignin && typeof GoogleSignin.signOut === "function") {
          await GoogleSignin.signOut();
          console.log("Google sign out completed");
        }
        if (GoogleSignin && typeof GoogleSignin.revokeAccess === "function") {
          // revokeAccess is optional but ensures tokens/consent are cleared
          await GoogleSignin.revokeAccess().catch(() => {});
          console.log("Google revoke access completed");
        }
      }
    } catch (e) {
      // Non-critical; log and continue clearing local session
      console.warn("Google sign-out failed:", e);
    }

    setUser(null);
    setIsLoading(false);
    console.log("Logout completed");
  };

  return (
    <UserCtx.Provider
      value={{ user, setUser, refresh, logout, loginSet, isLoading }}
    >
      {children}
    </UserCtx.Provider>
  );
}

export function useUser() {
  const ctx = useContext(UserCtx);
  if (!ctx) throw new Error("useUser must be used within <UserProvider>");
  return ctx;
}
