import { useTheme } from "@/app/providers/ThemeProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { requestBiometricUnlock } from "@/utils/biometric";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function BiometricLoadingScreen() {
  const { colors } = useTheme();
  const { t } = useI18n();

  useEffect(() => {
    const checkBiometric = async () => {
      try {
        const biometricResult = await requestBiometricUnlock(
          t("biometricPrompt")
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
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["top", "bottom"]}
    >
      <View style={styles.inner}>
        <View style={styles.logoContainer}>
          <MaterialCommunityIcons
            name="fingerprint"
            size={80}
            color="#16A34A"
          />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>
          {t("biometricTitle")}
        </Text>
        <Text style={[styles.subtitle, { color: colors.subText }]}>
          {t("biometricSubtitle")}
        </Text>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#16A34A" />
          <Text style={[styles.loadingText, { color: colors.subText }]}>
            {t("authenticating")}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
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
    fontWeight: "500",
  },
});
