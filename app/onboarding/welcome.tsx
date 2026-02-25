import { useTheme } from "@/app/providers/ThemeProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { router } from "expo-router";
import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useI18n();

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["top", "bottom"]}
    >
      <View style={styles.inner}>
        <Image
          source={require("../../assets/images/iconai.png")}
          style={styles.image}
          resizeMode="contain"
        />

        <Text style={[styles.title, { color: colors.text }]}>
          {t("welcomeTitle")}
        </Text>
        <Text style={[styles.subtitle, { color: colors.subText }]}>
          {t("welcomeSubtitle")}
        </Text>

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
            <Text style={styles.primaryText}>{t("getStarted")}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.ghost}
            onPress={() => router.push("/auth/login?onboarding=1")}
          >
            <Text style={[styles.ghostText, { color: "#16A34A" }]}>
              {t("loginOrExisting")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  },
  subtitle: {
    fontSize: 16,
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
  ghostText: { fontSize: 15 },
});
