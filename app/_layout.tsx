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
  const [hasCheckedBiometric, setHasCheckedBiometric] = useState(false);

  // Reset biometric check when user changes (login/logout)
  useEffect(() => {
    if (!isLoading) {
      if (!user) {
        setHasCheckedBiometric(false);
      }
    }
  }, [user, isLoading]);

  useEffect(() => {
    // Don't do routing while still loading session
    if (isLoading) {
      console.log(
        "RootLayoutNav: Still loading session, skipping routing logic"
      );
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
      console.log("RootLayoutNav: Redirecting to onboarding/welcome");
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
