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
    (async () => {
      try {
        const u = await loadSession();
        setUser(u);
      } catch (error) {
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

    // Try to sign out from Firebase Auth if the SDK is available. We avoid
    // clearing the whole AsyncStorage because that also removes Firebase
    // auth persistence and other packages' data. Instead we clear only the
    // app session (via `clearSession`) and any auth sessions from native
    // modules (GoogleSignin). This preserves proper Firebase initialization
    // behavior on next app start.
    try {
      // Attempt to require firebase/auth dynamically at runtime without
      // letting Metro statically analyze the require call. Using `eval("require")`
      // prevents the bundler from trying to resolve the module at bundle-time
      // when `firebase` is not installed.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const r: any = eval("require");
      let firebaseAuth: any = null;
      try {
        firebaseAuth = r("firebase/auth");
      } catch (err) {
        // modular auth not available; we'll try compat below
        firebaseAuth = null;
      }

      if (firebaseAuth && typeof firebaseAuth.getAuth === "function") {
        const { getAuth, signOut } = firebaseAuth;
        try {
          const auth = getAuth();
          if (auth && auth.currentUser && typeof signOut === "function") {
            await signOut(auth).catch(() => {});
            console.log("Signed out from Firebase Auth (modular)");
          }
        } catch (e) {
          console.log("Firebase modular signOut failed:", e);
        }
      } else {
        // compat fallback (older firebase installs)
        try {
          const fb = r("firebase");
          if (fb && fb.auth && typeof fb.auth === "function") {
            try {
              await fb
                .auth()
                .signOut()
                .catch(() => {});
              console.log("Signed out from Firebase Auth (compat)");
            } catch (e) {
              console.log("Firebase compat signOut failed:", e);
            }
          }
        } catch (e) {
          // compat package not available either
          // fall through to non-critical behavior
          console.log("Firebase compat module not available:", e);
        }
      }
    } catch (e) {
      // Non-critical; log and continue
      console.log("Firebase signOut not available or failed:", e);
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
