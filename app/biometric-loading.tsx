import { requestBiometricUnlock } from "@/utils/biometric";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function BiometricLoadingScreen() {
  useEffect(() => {
    const checkBiometric = async () => {
      try {
        const biometricResult = await requestBiometricUnlock(
          "Xác thực để vào ứng dụng"
        );
        if (biometricResult.success) {
          router.replace("/(tabs)");
        } else {
          router.replace("/auth/login");
        }
      } catch (error) {
        console.warn("Biometric check failed:", error);
        router.replace("/auth/login");
      }
    };

    checkBiometric();
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.inner}>
        <View style={styles.logoContainer}>
          <MaterialCommunityIcons
            name="fingerprint"
            size={80}
            color="#16A34A"
          />
        </View>
        <Text style={styles.title}>Xác thực sinh trắc học</Text>
        <Text style={styles.subtitle}>
          Vui lòng xác thực để tiếp tục sử dụng ứng dụng
        </Text>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#16A34A" />
          <Text style={styles.loadingText}>Đang xác thực...</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  inner: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  logoContainer: {
    marginBottom: 32,
    alignItems: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1f2937",
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 48,
    lineHeight: 24,
  },
  loadingContainer: {
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: "#6b7280",
    fontWeight: "500",
  },
});
