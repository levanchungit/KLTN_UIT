// src/userContext.tsx
import React, { createContext, useContext, useEffect, useState } from "react";
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
    // Do NOT change local SQLite ownership on login.
    // Login only stores session for cloud sync later; local DB remains owned by `local_user`.
    await saveSession(u);
    setUser(u);
  };

  const logout = async () => {
    // Do NOT migrate or change DB ownership on logout. Clear saved session only.
    await clearSession();
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
