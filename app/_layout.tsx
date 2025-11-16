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
import { useFonts } from "expo-font";
import {
  Stack,
  useGlobalSearchParams,
  useRouter,
  useSegments,
} from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { LogBox, Platform, StyleSheet, UIManager } from "react-native";
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
  const { user } = useUser();
  const segments = useSegments();
  const router = useRouter();
  const params = useGlobalSearchParams();
  const upgradeIntent = params.upgrade === "1";
  const [authenticated, setAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    // Ensure we only allow access to main tabs when a real session exists.
    // If no session (user === null), redirect to auth/login.
    const inAuthGroup = segments[0] === "auth";
    if (!inAuthGroup && !user) {
      router.replace("/auth/login");
      return;
    }
    // If we're on auth and already logged in, go to main tabs
    if (inAuthGroup && user) {
      router.replace("/(tabs)");
    }
  }, [user, segments]);

  return (
    <ThemeProvider value={mode === "dark" ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="auth/login" />
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

const styles = StyleSheet.create({
  blockedContainer: {
    flex: 1,
    backgroundColor: "#0F172A",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  blockedIcon: {
    fontSize: 64,
    marginBottom: 24,
  },
  blockedTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#F3F4F6",
    marginBottom: 12,
    textAlign: "center",
  },
  blockedText: {
    fontSize: 16,
    color: "#9CA3AF",
    textAlign: "center",
    lineHeight: 24,
  },
});
