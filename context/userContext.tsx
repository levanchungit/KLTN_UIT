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
    await saveSession(u);
    setUser(u);
  };

  const logout = async () => {
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
