// src/userContext.tsx
import React, { createContext, useContext, useEffect, useState } from "react";
import { NativeModules } from "react-native";
import { clearSession, loadSession, saveSession, UserSession } from "./session";

type Ctx = {
  user: UserSession | null;
  setUser: (u: UserSession | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  loginSet: (u: UserSession) => Promise<void>;
};

const UserCtx = createContext<Ctx | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(null);

  useEffect(() => {
    (async () => {
      const u = await loadSession();
      setUser(u);
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
  };

  const logout = async () => {
    // Do NOT migrate or change DB ownership on logout. Clear saved session only.
    await clearSession();
    // Try to sign out the native GoogleSignin module so the next Google login
    // can pick a different account. Guard against running in Expo Go or when
    // the native module isn't registered.
    try {
      if (NativeModules && (NativeModules as any).RNGoogleSignin) {
        // Require dynamically to avoid top-level native import that crashes in Expo Go
        // if the native module isn't present.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const {
          GoogleSignin,
        } = require("@react-native-google-signin/google-signin");
        if (GoogleSignin && typeof GoogleSignin.signOut === "function") {
          await GoogleSignin.signOut();
        }
        if (GoogleSignin && typeof GoogleSignin.revokeAccess === "function") {
          // revokeAccess is optional but ensures tokens/consent are cleared
          await GoogleSignin.revokeAccess().catch(() => {});
        }
      }
    } catch (e) {
      // Non-critical; log and continue clearing local session
      console.warn("Google sign-out failed:", e);
    }

    setUser(null);
  };

  return (
    <UserCtx.Provider value={{ user, setUser, refresh, logout, loginSet }}>
      {children}
    </UserCtx.Provider>
  );
}

export function useUser() {
  const ctx = useContext(UserCtx);
  if (!ctx) throw new Error("useUser must be used within <UserProvider>");
  return ctx;
}
