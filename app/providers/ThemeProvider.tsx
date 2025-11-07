import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type Mode = "light" | "dark";
type Colors = {
  background: string;
  card: string;
  text: string;
  subText: string;
  divider: string;
  icon: string;
};
type ThemeCtx = { mode: Mode; colors: Colors; toggleTheme: () => void };

const light: Colors = {
  background: "#FAFBFC",
  card: "#FFFFFF",
  text: "#111827",
  subText: "#6B7280",
  divider: "#EFF2F6",
  icon: "#4B5563",
};

const dark: Colors = {
  background: "#0F172A",
  card: "#1F2937",
  text: "#F3F4F6",
  subText: "#9CA3AF",
  divider: "#374151",
  icon: "#D1D5DB",
};

const ThemeContext = createContext<ThemeCtx>({
  mode: "light",
  colors: light,
  toggleTheme: () => {},
});

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>("light");

  useEffect(() => {
    AsyncStorage.getItem("@app-theme").then((val) => {
      if (val === "dark" || val === "light") setMode(val);
    });
  }, []);

  useEffect(() => {
    AsyncStorage.setItem("@app-theme", mode).catch(() => {});
  }, [mode]);

  const value = useMemo<ThemeCtx>(
    () => ({
      mode,
      colors: mode === "light" ? light : dark,
      toggleTheme: () => setMode((m) => (m === "light" ? "dark" : "light")),
    }),
    [mode]
  );

  return (
    <ThemeContext.Provider value={value}>
      <StatusBar style={mode === "light" ? "dark" : "light"} />
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

// Default export required for Expo Router
export default function ThemeProviderRoute() {
  return null;
}