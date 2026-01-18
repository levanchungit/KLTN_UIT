import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar as RNStatusBar } from "react-native";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useColorScheme } from "react-native";

type Mode = "light" | "dark";
type Colors = {
  background: string;
  card: string;
  text: string;
  subText: string;
  divider: string;
  icon: string;
};
type Preference = "system" | Mode;
type ThemeCtx = {
  mode: Mode; // effective mode (after applying preference + system)
  preference: Preference; // user preference (system, light, dark)
  colors: Colors;
  cyclePreference: () => void; // cycle system -> dark -> light -> system
  setPreference: (p: Preference) => void;
};

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
  preference: "system",
  colors: light,
  cyclePreference: () => {},
  setPreference: () => {},
});

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreference] = useState<Preference>("system");

  // Load saved preference
  useEffect(() => {
    AsyncStorage.getItem("@theme-preference").then((val) => {
      if (val === "system" || val === "light" || val === "dark") {
        setPreference(val);
      }
    });
  }, []);

  // Persist preference
  useEffect(() => {
    AsyncStorage.setItem("@theme-preference", preference).catch(() => {});
  }, [preference]);

  const effectiveMode: Mode =
    preference === "system"
      ? systemScheme === "dark"
        ? "dark"
        : "light"
      : preference;

  const value = useMemo<ThemeCtx>(
    () => ({
      mode: effectiveMode,
      preference,
      colors: effectiveMode === "light" ? light : dark,
      cyclePreference: () =>
        setPreference((prev) =>
          prev === "system" ? "dark" : prev === "dark" ? "light" : "system"
        ),
      setPreference,
    }),
    [effectiveMode, preference]
  );

  return (
    <ThemeContext.Provider value={value}>
      {/* Make native status bar translucent so app content can draw under it.
          This allows overlays (like the offline pill) to appear over the system bar. */}
      <RNStatusBar
        translucent
        backgroundColor="transparent"
        barStyle={effectiveMode === "light" ? "dark-content" : "light-content"}
      />
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
