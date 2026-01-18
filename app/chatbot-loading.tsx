import { useTheme } from "@/app/providers/ThemeProvider";
import { useModelTraining } from "@/context/modelTrainingContext";
import { useI18n } from "@/i18n/I18nProvider";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function ChatbotLoadingScreen() {
  const router = useRouter();
  const { isTraining, progress, isReady, isQuickMode, startTraining, enableQuickMode, cancelTraining } =
    useModelTraining();
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    // start training when this screen mounts
    if (!isReady && !isQuickMode && !isTraining) {
      startTraining();
    }
    // when ready or quick mode enabled, navigate to chatbot
  }, []);

  useEffect(() => {
    if (isReady || isQuickMode) {
      // replace with chatbot screen
      router.replace("/chatbot");
    }
  }, [isReady, isQuickMode]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { top: insets.top ?? 0, paddingHorizontal: 12 },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerBtn}
          accessibilityLabel="Quay lại"
        >
          <Ionicons name="arrow-back" size={22} color="#111" />
        </TouchableOpacity>

        <View style={{ flex: 1 }} />

        <TouchableOpacity
          onPress={() => router.replace("/")}
          style={styles.headerBtn}
          accessibilityLabel="Trang chủ"
        >
          <Ionicons name="home" size={22} color="#111" />
        </TouchableOpacity>
      </View>
      <View style={styles.loadingWrap}>
        <View style={[styles.card, { width: "94%", maxWidth: 520 }]}>
          <Text style={styles.title}>{t("trainingTitle")}</Text>
          <Text style={styles.desc}>{t("trainingDesc")}</Text>
          <View style={styles.progressBar}>
            <Animated.View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.percent}>{progress}%</Text>

          <TouchableOpacity
            style={styles.primaryFull}
            onPress={() => {
              enableQuickMode();
              router.replace("/chatbot");
            }}
            activeOpacity={0.9}
          >
            <Text style={styles.btnTextWhite}>{t("continueQuickMode")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.28)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "transparent",
    borderRadius: 0,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  header: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    zIndex: 20,
  },
  headerBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#E6E6E6",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 6,
  },
  loadingWrap: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryFull: {
    marginTop: 12,
    backgroundColor: "#059669",
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 18, fontWeight: "700", marginBottom: 8 },
  desc: { fontSize: 14, color: "#6B7280", marginBottom: 14, textAlign: "center" },
  progressBar: {
    width: "100%",
    height: 10,
    backgroundColor: "#F1F5F9",
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 8,
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#059669",
  },
  percent: { fontSize: 13, color: "#374151", marginBottom: 12 },
  actions: {
    flexDirection: "row",
    width: "100%",
    justifyContent: "space-between",
    alignItems: "center",
  },
  btnPrimary: {
    backgroundColor: "#059669",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    flex: 0.7,
    alignItems: "center",
    justifyContent: "center",
  },
  btnSecondary: {
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    flex: 0.3,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  btnText: { color: "#111", fontSize: 13 },
  btnTextWhite: { color: "#fff", fontWeight: "600", fontSize: 13 },
});