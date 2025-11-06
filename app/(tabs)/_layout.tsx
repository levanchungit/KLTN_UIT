import VenmoTabBar from "@/components/VenmoTabBar";
import { UserProvider } from "@/context/userContext";
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";

export default function TabsLayout() {
  return (
    <UserProvider>
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <VenmoTabBar {...props} />}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Trang chủ",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="transactions"
          options={{
            title: "Giao dịch",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="trending-up-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="budget"
          options={{
            title: "Ngân sách",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="wallet-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="setting"
          options={{
            title: "Cài đặt",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="settings-outline" size={size} color={color} />
            ),
          }}
        />

        {/* Ẩn các route phụ (bar custom tự bỏ qua chúng) */}
        <Tabs.Screen name="budget/setup" options={{ href: null }} />
        <Tabs.Screen name="budget/suggest" options={{ href: null }} />
      </Tabs>
    </UserProvider>
  );
}
