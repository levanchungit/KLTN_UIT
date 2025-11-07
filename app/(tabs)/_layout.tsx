import VenmoTabBar from "@/components/VenmoTabBar";
import { UserProvider } from "@/context/userContext";
import { useI18n } from "@/i18n/I18nProvider";
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";

export default function TabsLayout() {
  const { t } = useI18n();
  return (
    <UserProvider>
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <VenmoTabBar {...props} />}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t("home"),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="transactions"
          options={{
            title: t("transactions"),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="trending-up-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="budget"
          options={{
            title: t("budget"),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="wallet-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="setting"
          options={{
            title: t("setting"),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="settings-outline" size={size} color={color} />
            ),
          }}
        />
      </Tabs>
    </UserProvider>
  );
}
