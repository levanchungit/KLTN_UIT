import {
  AppThemeProvider,
  useTheme as useAppTheme,
} from "@/app/providers/ThemeProvider";
import { UserProvider, useUser } from "@/context/userContext";
import { db, openDb } from "@/db";
import { I18nProvider } from "@/i18n/I18nProvider";
import { setupNotificationListener } from "@/services/notificationService";
import { initSmartNotifications } from "@/services/smartNotificationService";
import { requestBiometricUnlock } from "@/utils/biometric";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
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
  const [biometricChecked, setBiometricChecked] = useState(false);
  const [hasCheckedBiometric, setHasCheckedBiometric] = useState(false);

  // Reset biometric check when user changes (login/logout)
  useEffect(() => {
    if (!isLoading) {
      if (!user) {
        setHasCheckedBiometric(false);
        setBiometricChecked(false);
      }
    }
  }, [user, isLoading]);

  useEffect(() => {
    // Don't do routing while still loading session
    if (isLoading) {
      console.log(
        "RootLayoutNav: Still loading session, skipping routing logic"
      );
      setBiometricChecked(false);
      setHasCheckedBiometric(false);
      return;
    }

    // Control routing for onboarding/auth flow.
    const inAuthGroup = segments[0] === "auth";
    const inOnboarding = segments[0] === "onboarding";

    // Require a signed-in user for gating purposes.
    const isAuthenticated = !!user;

    console.log("RootLayoutNav: Routing check", {
      inAuthGroup,
      inOnboarding,
      isAuthenticated,
      user: user?.username,
      segments,
      hasCheckedBiometric,
    });

    // If not on onboarding/auth screens and not authenticated, start onboarding
    if (!inAuthGroup && !inOnboarding && !isAuthenticated) {
      console.log("RootLayoutNav: Redirecting to onboarding/welcome");
      setBiometricChecked(false);
      setHasCheckedBiometric(false);
      router.replace("/onboarding/welcome");
      return;
    }

    // Always verify a logged-in user's essential setup (accounts, categories).
    // If missing, force the appropriate onboarding step before allowing access
    // to the main app. Additionally preserve the 'requires_onboarding'
    // shortcut for freshly-registered users so they continue to chatbox-intro
    // after creating required resources.
    if (isAuthenticated && !inOnboarding && !inAuthGroup) {
      // Only check biometric once per session
      if (!hasCheckedBiometric) {
        setHasCheckedBiometric(true);
        (async () => {
          // Check biometric authentication if enabled
          try {
            const biometricUnlocked = await requestBiometricUnlock(
              "Xác thực để vào ứng dụng"
            );
            if (!biometricUnlocked) {
              console.log(
                "RootLayoutNav: Biometric authentication failed, redirecting to login"
              );
              setBiometricChecked(false);
              setHasCheckedBiometric(false);
              router.replace("/auth/login");
              return;
            }
          } catch (error) {
            console.warn("RootLayoutNav: Biometric check failed:", error);
            // Allow access if biometric check fails (e.g., hardware not available)
          }

          // Check onboarding requirements
          try {
            await openDb();

            const accRow = await db.getFirstAsync<{ cnt: number }>(
              `SELECT COUNT(*) as cnt FROM accounts WHERE user_id=?`,
              user.id as any
            );
            const accCount = accRow?.cnt ?? 0;
            if (accCount <= 0) {
              setBiometricChecked(false);
              router.replace("/onboarding/wallet-setup");
              return;
            }

            // If the freshly-registered flag is set, continue onboarding to chatbox.
            const requires = await AsyncStorage.getItem("requires_onboarding");
            if (requires === user.id) {
              setBiometricChecked(false);
              router.replace("/onboarding/chatbox-intro");
              return;
            }

            // Otherwise user is fully set up — allow normal navigation (tabs).
            setBiometricChecked(true);
          } catch (e) {
            console.warn("Onboarding gating check failed:", e);
            setBiometricChecked(true); // Allow access on error
          }
        })();
      }
    }

    // If we're on auth and already logged in with a real account, go to main tabs
    if (inAuthGroup && isAuthenticated) {
      setBiometricChecked(false);
      setHasCheckedBiometric(false);
      router.replace("/(tabs)");
    }
  }, [user, segments, isLoading, hasCheckedBiometric]);

  // Show loading screen while biometric check is in progress
  if (
    isLoading ||
    (user &&
      !biometricChecked &&
      segments[0] !== "auth" &&
      segments[0] !== "onboarding")
  ) {
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
