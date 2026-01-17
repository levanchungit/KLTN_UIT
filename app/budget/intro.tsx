import { useTheme } from "@/app/providers/ThemeProvider";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

export default function AIBudgetIntroScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(
    () => makeStyles(colors, insets.bottom),
    [colors, insets.bottom]
  );

  const [income, setIncome] = useState("");
  const [period, setPeriod] = useState<"weekly" | "monthly">("monthly");
  const [error, setError] = useState("");
  const [lifestyleDesc, setLifestyleDesc] = useState("");
  const [showAnalyzingModal, setShowAnalyzingModal] = useState(false);
  const [analyzingStep, setAnalyzingStep] = useState(0);
  const [analyzingProgress, setAnalyzingProgress] = useState(0);

  // Animation
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const slideAnim = React.useRef(new Animated.Value(50)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const getValidatedIncome = () => {
    setError("");

    const incomeValue = parseInt(income.replace(/[^\d]/g, "") || "0", 10);

    if (!incomeValue || incomeValue <= 0) {
      setError("Vui lòng nhập thu nhập hợp lệ");
      return null;
    }

    if (incomeValue < 1_000_000) {
      setError("Thu nhập tối thiểu 1 triệu đồng");
      return null;
    }

    if (incomeValue > 1_000_000_000) {
      setError("Thu nhập vượt quá giới hạn");
      return null;
    }

    return incomeValue;
  };

  const suggestions = [
    "Tôi sống ở Hà Nội, trả khoảng 10 triệu đồng tiền thuê nhà mỗi tháng, và thường đi ăn ngoài 2 lần mỗi tuần",
    "Sống TP.HCM, ăn ngoài nhiều, thích shopping, không có mục tiêu tiết kiệm cụ thể",
    "Sống tỉnh, ở nhà riêng, ăn ngoài ít, muốn tiết kiệm để mua xe",
    "Thuê trọ 5tr, ăn uống 3tr, du lịch 2tr/tháng",
  ];

  const handleCreatePlan = async () => {
    const incomeValue = getValidatedIncome();
    if (!incomeValue) return;

    const finalLifestyle =
      lifestyleDesc.trim() ||
      "Áp dụng CHÍNH XÁC quy tắc 50/30/20: Nhu cầu 50%, Mong muốn 30%, Tiết kiệm 20%.";

    if (finalLifestyle.length < 10) {
      setError("Vui lòng nhập mô tả lối sống ít nhất 10 ký tự hoặc chọn gợi ý");
      return;
    }

    setShowAnalyzingModal(true);
    setAnalyzingStep(0);
    setAnalyzingProgress(0);

    // Simulate analyzing steps
    const steps = [
      { duration: 800 },
      { duration: 1200 },
      { duration: 1500 },
      { duration: 1000 },
      { duration: 800 },
    ];

    let currentStep = 0;
    for (const step of steps) {
      await new Promise((resolve) => setTimeout(resolve, step.duration));
      currentStep++;
      setAnalyzingStep(currentStep);
      setAnalyzingProgress((currentStep / steps.length) * 100);
    }

    // Run actual AI analysis
    try {
      const { generateAIBudgetAdvice } = await import(
        "@/services/aiBudgetAdvisor"
      );
      const result = await generateAIBudgetAdvice({
        income: incomeValue,
        description: finalLifestyle,
        period: period || "monthly",
      });

      setShowAnalyzingModal(false);

      // Navigate to result screen
      router.push({
        pathname: "/budget/result",
        params: {
          income: incomeValue.toString(),
          period,
          lifestyleDesc: finalLifestyle,
          resultJson: JSON.stringify(result),
        },
      });
    } catch (err: any) {
      console.error("[Intro] Analysis error:", err);
      setShowAnalyzingModal(false);
      setError(
        err?.message || "Đã xảy ra lỗi khi phân tích. Vui lòng thử lại."
      );
    }
  };

  const formatIncome = (value: string) => {
    const numericValue = value.replace(/[^\d]/g, "");
    if (!numericValue) return "";

    const number = parseInt(numericValue);
    return number.toLocaleString("vi-VN");
  };

  const handleIncomeChange = (text: string) => {
    const formatted = formatIncome(text);
    setIncome(formatted);
    setError("");
  };

  const quickAmounts = [5_000_000, 10_000_000, 15_000_000, 20_000_000];

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <Pressable
              onPress={() => router.back()}
              style={styles.backButton}
              hitSlop={8}
            >
              <MaterialCommunityIcons
                name="arrow-left"
                size={24}
                color={colors.text}
              />
            </Pressable>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              Trợ lý ngân sách AI
            </Text>
            <View style={{ width: 24 }} />
          </View>

          <Animated.View
            style={{
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            }}
          >
            {/* Title */}
            <View style={styles.heroRow}>
              <View
                style={[
                  styles.heroIcon,
                  {
                    backgroundColor: colors.icon + "18",
                    borderColor: colors.divider,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name="robot-outline"
                  size={20}
                  color={colors.icon}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: colors.text }]}>
                  Kế hoạch 50/30/20
                </Text>
                <Text style={[styles.subtitle, { color: colors.subText }]}>
                  Nhập thu nhập sau thuế và kỳ nhận lương để tạo ngân sách
                  nhanh.
                </Text>
              </View>
            </View>

            {/* Income Input */}
            <View style={styles.inputSection}>
              <Text style={[styles.label, { color: colors.text }]}>
                Thu nhập (sau thuế)
              </Text>
              <View
                style={[
                  styles.inputContainer,
                  { backgroundColor: colors.card, borderColor: colors.divider },
                  error ? styles.inputError : null,
                ]}
              >
                <TextInput
                  style={[styles.input, { color: colors.text }]}
                  value={income}
                  onChangeText={handleIncomeChange}
                  placeholder="0"
                  placeholderTextColor={colors.subText}
                  keyboardType="numeric"
                />
                <Text style={[styles.inputUnit, { color: colors.subText }]}>
                  VND
                </Text>
              </View>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              {/* Period Selector */}
              <View style={styles.periodContainer}>
                {(["monthly", "weekly"] as const).map((p) => (
                  <Pressable
                    key={p}
                    style={[
                      styles.periodButton,
                      {
                        backgroundColor: period === p ? "#16A34A" : colors.card,
                        borderColor: period === p ? "#16A34A" : colors.divider,
                      },
                    ]}
                    onPress={() => setPeriod(p)}
                  >
                    <Text
                      style={[
                        styles.periodText,
                        {
                          color: period === p ? "#fff" : colors.text,
                        },
                      ]}
                    >
                      {p === "monthly" ? "Hàng tháng" : "Hàng tuần"}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* Quick Amount Buttons */}
              <Text style={[styles.quickLabel, { color: colors.subText }]}>
                Hoặc chọn nhanh:
              </Text>
              <View style={styles.quickAmounts}>
                {quickAmounts.map((amount) => (
                  <Pressable
                    key={amount}
                    style={[
                      styles.quickButton,
                      {
                        borderColor: colors.divider,
                        backgroundColor: colors.card,
                      },
                    ]}
                    onPress={() =>
                      handleIncomeChange(amount.toLocaleString("vi-VN"))
                    }
                  >
                    <Text
                      style={[styles.quickButtonText, { color: "#16A34A" }]}
                    >
                      {(amount / 1_000_000).toFixed(0)}M
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Lifestyle description */}
            <View style={styles.lifestyleSection}>
              <Text style={[styles.label, { color: colors.text }]}>
                Mô tả lối sống (tuỳ chọn)
              </Text>
              <TextInput
                style={[
                  styles.lifestyleInput,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.divider,
                    color: colors.text,
                  },
                ]}
                value={lifestyleDesc}
                onChangeText={setLifestyleDesc}
                placeholder="Ví dụ: Sống TP.HCM, thuê trọ 7tr, ăn ngoài thường xuyên..."
                placeholderTextColor={colors.subText}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
              <Text style={[styles.lifestyleHint, { color: colors.subText }]}>
                Gợi ý nhanh:
              </Text>
              <View style={styles.suggestionsGrid}>
                {suggestions.map((sug, idx) => (
                  <Pressable
                    key={idx}
                    style={[
                      styles.suggestionChip,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.divider,
                      },
                    ]}
                    onPress={() => setLifestyleDesc(sug)}
                  >
                    <Text
                      style={[styles.suggestionText, { color: colors.text }]}
                      numberOfLines={2}
                    >
                      {sug}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </Animated.View>
        </ScrollView>

        {/* Continue Button */}
        <View style={[styles.footer, { backgroundColor: colors.background }]}>
          <Pressable
            style={[
              styles.primaryButton,
              {
                backgroundColor: income ? "#16A34A" : colors.divider,
              },
            ]}
            onPress={handleCreatePlan}
            disabled={!income}
          >
            <Text style={styles.primaryButtonText}>Tạo kế hoạch</Text>
            <MaterialCommunityIcons name="magic-staff" size={18} color="#fff" />
          </Pressable>
        </View>

        {/* Analyzing Modal */}
        <Modal
          visible={showAnalyzingModal}
          transparent
          animationType="fade"
          statusBarTranslucent
        >
          <View style={styles.modalOverlay}>
            <View
              style={[
                styles.modalContent,
                { backgroundColor: colors.background },
              ]}
            >
              <View
                style={[
                  styles.modalIconCircle,
                  { backgroundColor: colors.icon + "20" },
                ]}
              >
                <ActivityIndicator size="large" color={colors.icon} />
              </View>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Đang phân tích...
              </Text>
              {analyzingStep < 5 && (
                <View style={styles.modalStepContainer}>
                  <MaterialCommunityIcons
                    name={
                      [
                        "brain",
                        "text-search",
                        "chart-timeline-variant",
                        "sitemap",
                        "check-circle",
                      ][analyzingStep] as any
                    }
                    size={20}
                    color={colors.icon}
                  />
                  <Text
                    style={[styles.modalStepText, { color: colors.subText }]}
                  >
                    {
                      [
                        "Khởi tạo mô hình Neural Network...",
                        "Trích xuất tín hiệu lối sống...",
                        "Dự đoán phân bổ ngân sách...",
                        "Phân bổ vào categories...",
                        "Tạo insights cá nhân hóa...",
                      ][analyzingStep]
                    }
                  </Text>
                </View>
              )}
              <View style={styles.modalProgressContainer}>
                <View
                  style={[
                    styles.modalProgressBg,
                    { backgroundColor: colors.divider },
                  ]}
                >
                  <View
                    style={[
                      styles.modalProgressBar,
                      {
                        backgroundColor: colors.icon,
                        width: `${analyzingProgress}%`,
                      },
                    ]}
                  />
                </View>
                <Text
                  style={[styles.modalProgressText, { color: colors.subText }]}
                >
                  {Math.round(analyzingProgress)}%
                </Text>
              </View>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: any, bottomInset: number) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      padding: 16,
      paddingBottom: 110,
      flexGrow: 1,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    backButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: "600",
    },
    heroRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 12,
    },
    heroIcon: {
      width: 40,
      height: 40,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    title: {
      fontSize: 22,
      fontWeight: "800",
    },
    subtitle: {
      fontSize: 13,
      lineHeight: 18,
      marginTop: 2,
    },
    inputSection: {
      marginTop: 4,
    },
    label: {
      fontSize: 15,
      fontWeight: "600",
      marginBottom: 10,
    },
    inputContainer: {
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 2,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 2,
    },
    inputError: {
      borderColor: "#F44336",
    },
    input: {
      flex: 1,
      fontSize: 22,
      fontWeight: "bold",
      paddingVertical: 12,
    },
    inputUnit: {
      fontSize: 16,
      fontWeight: "600",
    },
    errorText: {
      color: "#F44336",
      fontSize: 14,
      marginTop: 8,
      marginLeft: 4,
    },
    periodContainer: {
      flexDirection: "row",
      gap: 8,
      marginTop: 12,
    },
    periodButton: {
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 8,
      borderWidth: 1,
      alignItems: "center",
    },
    periodText: {
      fontSize: 14,
      fontWeight: "600",
    },
    quickLabel: {
      fontSize: 14,
      marginTop: 14,
      marginBottom: 10,
    },
    quickAmounts: {
      flexDirection: "row",
      gap: 8,
    },
    quickButton: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 2,
      alignItems: "center",
    },
    quickButtonText: {
      fontSize: 15,
      fontWeight: "700",
    },
    lifestyleSection: {
      marginTop: 14,
    },
    lifestyleInput: {
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      fontSize: 14,
      minHeight: 80,
    },
    lifestyleHint: {
      fontSize: 12,
      marginTop: 12,
      marginBottom: 8,
    },
    suggestionsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    suggestionChip: {
      width: "48.5%",
      borderWidth: 1,
      borderRadius: 10,
      padding: 10,
      minHeight: 60,
    },
    suggestionText: {
      fontSize: 12,
      lineHeight: 16,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.7)",
      justifyContent: "center",
      alignItems: "center",
      padding: 20,
    },
    modalContent: {
      borderRadius: 16,
      padding: 32,
      alignItems: "center",
      width: "100%",
      maxWidth: 340,
    },
    modalIconCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 20,
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: "bold",
      marginBottom: 16,
    },
    modalStepContainer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 20,
    },
    modalStepText: {
      fontSize: 14,
      flex: 1,
    },
    modalProgressContainer: {
      width: "100%",
      gap: 8,
    },
    modalProgressBg: {
      height: 8,
      borderRadius: 4,
      overflow: "hidden",
    },
    modalProgressBar: {
      height: "100%",
      borderRadius: 4,
    },
    modalProgressText: {
      fontSize: 12,
      textAlign: "center",
    },
    footer: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      padding: 20,
    },
    primaryButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 16,
      borderRadius: 12,
      gap: 8,
    },
    primaryButtonText: {
      color: "#fff",
      fontSize: 16,
      fontWeight: "bold",
    },
  });
