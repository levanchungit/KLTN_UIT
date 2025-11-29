import {
  AppThemeProvider,
  useTheme as useAppTheme,
} from "@/app/providers/ThemeProvider";
import { UserProvider, useUser } from "@/context/userContext";
import { I18nProvider } from "@/i18n/I18nProvider";
import { setupNotificationListener } from "@/services/notificationService";
import { initSmartNotifications } from "@/services/smartNotificationService";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import Constants from "expo-constants";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  LogBox,
  Platform,
  UIManager,
  View,
} from "react-native";
import { PaperProvider } from "react-native-paper";

// Suppress warnings in New Architecture and Expo Go limitations
LogBox.ignoreLogs([
  /setLayoutAnimationEnabledExperimental/,
  /No route named/,
  /expo-notifications: Android Push notifications.*removed from Expo Go/i,
]);

if (Platform.OS === "android") {
  if (typeof UIManager?.setLayoutAnimationEnabledExperimental === "function") {
    // Suppress the warning but don't call it in New Architecture
  }
}

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from "expo-router";

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: "(tabs)",
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  useEffect(() => {
    // Setup notification listener
    const unsubscribe = setupNotificationListener();

    // Initialize smart notification system (daily, weekly, inactivity checks)
    initSmartNotifications();

    // Initialize Firestore if config present in app config (or inferred in app.config.js)
    (async () => {
      try {
        const cfg = (Constants.expoConfig as any)?.extra?.FIREBASE_CONFIG;
        if (cfg) {
          const fs = await import("@/services/firestoreSync");
          await fs.initFirestore(cfg);
          console.log("Firestore initialized (auto)");
        } else {
          console.log(
            "No FIREBASE_CONFIG found in expo extra; Firestore not initialized."
          );
        }
      } catch (e) {
        console.warn("Failed to init Firestore:", e);
      }
    })();

    return unsubscribe;
  }, []);

  if (!loaded) {
    return null;
  }

  return (
    <I18nProvider>
      <AppThemeProvider>
        <UserProvider>
          <PaperProvider>
            <RootLayoutNav />
          </PaperProvider>
        </UserProvider>
      </AppThemeProvider>
    </I18nProvider>
  );
}

function RootLayoutNav() {
  const { mode } = useAppTheme();
  const { user, isLoading } = useUser();
  const segments = useSegments();
  const router = useRouter();
  const [hasCheckedBiometric, setHasCheckedBiometric] = useState(false);

  // Reset biometric check when user changes (login/logout)
  useEffect(() => {
    if (!isLoading) {
      if (!user) {
        setHasCheckedBiometric(false);
      }
    }
  }, [user, isLoading]);

  // Deep link handling from Android widget: kltnuit://add?text=...
  useEffect(() => {
    const handleUrl = (url: string | null) => {
      if (!url) return;
      try {
        const parsed = new URL(url);
        const pathname = parsed.pathname.replace(/^\//, "");
        const params = Object.fromEntries(parsed.searchParams.entries());
        console.log("Deep link received:", url, pathname, params);
        if (pathname === "add" || pathname === "add-transaction") {
          const text = params["text"];
          if (text) {
            router.push(`/add-transaction?text=${encodeURIComponent(text)}`);
          } else {
            router.push("/add-transaction");
          }
        } else if (pathname === "chatbox") {
          // support mode=voice|image|text and optional text param
          const mode = params["mode"];
          const text = params["text"];
          let path = "/chatbox";
          const q: string[] = [];
          if (mode) q.push(`mode=${encodeURIComponent(mode)}`);
          if (text) q.push(`text=${encodeURIComponent(text)}`);
          if (q.length) path = `${path}?${q.join("&")}`;
          router.push(path as any);
        }
      } catch (e) {
        // ignore
      }
    };

    (async () => {
      const initial = await Linking.getInitialURL();
      handleUrl(initial);
    })();

    const sub = Linking.addEventListener("url", (ev) =>
      handleUrl((ev as any).url)
    );
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Don't do routing while still loading session
    if (isLoading) {
      setHasCheckedBiometric(false);
      return;
    }

    // Control routing for onboarding/auth flow.
    const inAuthGroup = segments[0] === "auth";
    const inOnboarding = segments[0] === "onboarding";

    // Require a signed-in user for gating purposes.
    const isAuthenticated = !!user;

    // If not on onboarding/auth screens and not authenticated, start onboarding
    if (!inAuthGroup && !inOnboarding && !isAuthenticated) {
      router.replace("/onboarding/welcome");
      return;
    }

    if (
      isAuthenticated &&
      !inOnboarding &&
      !inAuthGroup &&
      !hasCheckedBiometric
    ) {
      setHasCheckedBiometric(true);
      router.replace("/biometric-loading");
    }

    // If we're on auth and already logged in with a real account, go to main tabs
    if (inAuthGroup && isAuthenticated) {
      router.replace("/(tabs)");
    }
  }, [user, segments, isLoading, hasCheckedBiometric]);

  // Auto-sync on app foreground and periodically
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    let mounted = true;

    const handleAppState = (next: any) => {
      try {
        if (next === "active") {
          // run sync when app comes to foreground
          if (user) {
            import("@/services/syncService").then(({ syncAll }) =>
              syncAll(user.id).catch((e) => console.warn("Auto sync failed", e))
            );
          }
        }
      } catch (e) {
        console.warn("AppState sync error", e);
      }
    };

    const sub = AppState.addEventListener
      ? AppState.addEventListener("change", handleAppState)
      : // fallback for older RN
        (AppState as any).addEventListener("change", handleAppState);

    // periodic sync every 5 minutes
    if (user) {
      interval = setInterval(() => {
        import("@/services/syncService").then(({ syncAll }) =>
          syncAll(user.id).catch((e) => console.warn("Periodic sync failed", e))
        );
      }, 5 * 60 * 1000);
    }

    return () => {
      mounted = false;
      try {
        if (sub && typeof sub.remove === "function") sub.remove();
        else if ((AppState as any).removeEventListener)
          (AppState as any).removeEventListener("change", handleAppState);
      } catch (e) {
        // ignore
      }
      if (interval) clearInterval(interval as any);
    };
  }, [user]);

  // Show loading screen while session is loading
  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#fff",
        }}
      >
        <ActivityIndicator size="large" color="#16A34A" />
      </View>
    );
  }

  return (
    <ThemeProvider value={mode === "dark" ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        {/* Onboarding flow */}
        <Stack.Screen name="onboarding/welcome" />
        <Stack.Screen name="onboarding/slides" />
        <Stack.Screen name="onboarding/wallet-setup" />
        <Stack.Screen name="onboarding/categories-setup" />
        <Stack.Screen name="onboarding/chatbox-intro" />
        <Stack.Screen name="onboarding/reminder-setup" />
        <Stack.Screen name="biometric-loading" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="chatbox" />
        <Stack.Screen name="budget/setup" />
        <Stack.Screen name="budget/suggest" />
        <Stack.Screen name="setting/categories" />
        <Stack.Screen name="setting/wallet" />
      </Stack>
    </ThemeProvider>
  );
}
