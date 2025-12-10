import { router } from "expo-router";
import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

export default function Welcome() {
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.inner}>
        <Image
          source={require("../../assets/images/iconai.png")}
          style={styles.image}
          resizeMode="contain"
        />

        <Text style={styles.title}>Chào mừng đến với HugoKeeper</Text>
        <Text style={styles.subtitle}>Ứng dụng quản lý tài chính cá nhân</Text>

        <View
          style={[
            styles.actions,
            { paddingBottom: Math.max(16, insets.bottom) },
          ]}
        >
          <TouchableOpacity
            style={styles.primary}
            onPress={() => router.push("/onboarding/slides")}
          >
            <Text style={styles.primaryText}>Bắt đầu</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.ghost}
            onPress={() => router.push("/auth/login?onboarding=1")}
          >
            <Text style={styles.ghostText}>Đăng nhập / Đã có tài khoản</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  inner: {
    flex: 1,
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 16,
  },
  image: { width: "84%", height: 340, marginBottom: 8 },
  title: {
    fontSize: 30,
    fontWeight: "800",
    marginTop: 8,
    textAlign: "center",
    color: "#111827",
  },
  subtitle: {
    fontSize: 16,
    color: "#6B7280",
    marginTop: 6,
    textAlign: "center",
    paddingHorizontal: 12,
  },
  actions: { width: "100%", alignItems: "center" },
  primary: {
    backgroundColor: "#16A34A",
    paddingVertical: 18,
    paddingHorizontal: 48,
    borderRadius: 12,
    marginBottom: 12,
    width: "78%",
    alignItems: "center",
  },
  primaryText: { color: "#fff", fontSize: 18, fontWeight: "800" },
  ghost: { paddingVertical: 12 },
  ghostText: { color: "#16A34A", fontSize: 15 },
});
