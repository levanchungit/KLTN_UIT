import { useTheme } from "@/app/providers/ThemeProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { createBudget } from "@/repos/budgetRepo";
import type { BudgetAdviceResult } from "@/services/aiBudgetAdvisor";
import { learnFromUserFeedback } from "@/services/aiBudgetAdvisor";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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

export default function ConfirmScreen() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(
    () => makeStyles(colors, insets.bottom),
    [colors, insets.bottom]
  );

  const { income, period, lifestyleDesc, resultJson } = useLocalSearchParams<{
    income: string;
    period: "daily" | "weekly" | "monthly";
    lifestyleDesc: string;
    resultJson: string;
  }>();

  const result: BudgetAdviceResult = React.useMemo(() => {
    try {
      return JSON.parse(resultJson || "{}");
    } catch {
      return null as any;
    }
  }, [resultJson]);

  const [budgetName, setBudgetName] = useState(
    `Ngân sách AI - ${new Date().toLocaleDateString("vi-VN", {
      month: "long",
      year: "numeric",
    })}`
  );
  const [startDate, setStartDate] = useState(new Date());
  const [duration, setDuration] = useState<1 | 3 | 6 | 12>(1); // months
  const [saving, setSaving] = useState(false);
  const [adjustedNeeds, setAdjustedNeeds] = useState(result?.needsAmount || 0);
  const [adjustedWants, setAdjustedWants] = useState(result?.wantsAmount || 0);
  const [adjustedSavings, setAdjustedSavings] = useState(
    result?.savingsAmount || 0
  );
  const [hasAdjusted, setHasAdjusted] = useState(false);

  if (!result) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={[styles.errorText, { color: colors.text }]}>
          Không có dữ liệu
        </Text>
      </SafeAreaView>
    );
  }

  const totalIncome = parseInt(income || "0");
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + duration);

  const handleAdjust = (type: "needs" | "wants" | "savings", delta: number) => {
    setHasAdjusted(true);

    if (type === "needs") {
      const newValue = Math.max(
        0,
        Math.min(totalIncome, adjustedNeeds + delta)
      );
      const diff = newValue - adjustedNeeds;
      setAdjustedNeeds(newValue);
      // Adjust others proportionally
      if (diff > 0) {
        setAdjustedWants(Math.max(0, adjustedWants - diff * 0.6));
        setAdjustedSavings(Math.max(0, adjustedSavings - diff * 0.4));
      } else {
        setAdjustedWants(adjustedWants - diff * 0.6);
        setAdjustedSavings(adjustedSavings - diff * 0.4);
      }
    } else if (type === "wants") {
      const newValue = Math.max(
        0,
        Math.min(totalIncome, adjustedWants + delta)
      );
      const diff = newValue - adjustedWants;
      setAdjustedWants(newValue);
      if (diff > 0) {
        setAdjustedNeeds(Math.max(0, adjustedNeeds - diff * 0.5));
        setAdjustedSavings(Math.max(0, adjustedSavings - diff * 0.5));
      } else {
        setAdjustedNeeds(adjustedNeeds - diff * 0.5);
        setAdjustedSavings(adjustedSavings - diff * 0.5);
      }
    } else {
      const newValue = Math.max(
        0,
        Math.min(totalIncome, adjustedSavings + delta)
      );
      const diff = newValue - adjustedSavings;
      setAdjustedSavings(newValue);
      if (diff > 0) {
        setAdjustedNeeds(Math.max(0, adjustedNeeds - diff * 0.5));
        setAdjustedWants(Math.max(0, adjustedWants - diff * 0.5));
      } else {
        setAdjustedNeeds(adjustedNeeds - diff * 0.5);
        setAdjustedWants(adjustedWants - diff * 0.5);
      }
    }
  };

  const handleSave = async () => {
    if (!budgetName.trim()) {
      Alert.alert("Lỗi", "Vui lòng nhập tên ngân sách");
      return;
    }

    setSaving(true);

    try {
      // Recalculate allocations if adjusted
      const finalNeeds = hasAdjusted ? adjustedNeeds : result.needsAmount;
      const finalWants = hasAdjusted ? adjustedWants : result.wantsAmount;
      const finalSavings = hasAdjusted ? adjustedSavings : result.savingsAmount;

      // Recalculate category allocations proportionally
      const needsRatio = finalNeeds / result.needsAmount;
      const wantsRatio = finalWants / result.wantsAmount;
      const savingsRatio = finalSavings / result.savingsAmount;

      const allocations = result.categories.map((cat) => {
        let amount = cat.allocatedAmount;
        if (cat.groupType === "needs") amount *= needsRatio;
        else if (cat.groupType === "wants") amount *= wantsRatio;
        else amount *= savingsRatio;

        return {
          categoryId: cat.categoryId,
          groupType: cat.groupType,
          allocatedAmount: Math.round(amount),
        };
      });

      // Save to database
      const budgetId = await createBudget({
        name: budgetName.trim(),
        totalIncome,
        period: period || "monthly",
        lifestyleDesc: lifestyleDesc || "",
        startDate,
        endDate,
        allocations,
      });

      // Learn from user adjustments (if any)
      if (hasAdjusted) {
        await learnFromUserFeedback(totalIncome, lifestyleDesc || "", {
          needs: finalNeeds / totalIncome,
          wants: finalWants / totalIncome,
          savings: finalSavings / totalIncome,
        });
      }

      Alert.alert("Thành công", "Ngân sách đã được tạo!", [
        {
          text: "OK",
          onPress: () => {
            // Navigate to budget detail
            router.replace(`/budget/detail?id=${budgetId}`);
          },
        },
      ]);
    } catch (error) {
      console.error("[ConfirmScreen] Save error:", error);
      Alert.alert("Lỗi", "Không thể lưu ngân sách. Vui lòng thử lại.");
    } finally {
      setSaving(false);
    }
  };

  const needsPct = ((adjustedNeeds / totalIncome) * 100).toFixed(0);
  const wantsPct = ((adjustedWants / totalIncome) * 100).toFixed(0);
  const savingsPct = ((adjustedSavings / totalIncome) * 100).toFixed(0);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
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
              Xác nhận ngân sách
            </Text>
            <View style={{ width: 24 }} />
          </View>

          {/* Budget Name */}
          <View style={styles.section}>
            <Text style={[styles.label, { color: colors.text }]}>
              Tên ngân sách
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.card,
                  color: colors.text,
                  borderColor: colors.divider,
                },
              ]}
              value={budgetName}
              onChangeText={setBudgetName}
              placeholder="Nhập tên ngân sách"
              placeholderTextColor={colors.subText}
            />
          </View>

          {/* Duration */}
          <View style={styles.section}>
            <Text style={[styles.label, { color: colors.text }]}>
              Ngân sách này nên được thiết lập lại bao lâu một lần?
            </Text>
            <View style={styles.durationContainer}>
              {([1, 3, 6, 12] as const).map((months) => (
                <Pressable
                  key={months}
                  style={[
                    styles.durationButton,
                    {
                      backgroundColor:
                        duration === months ? colors.icon : colors.card,
                      borderColor:
                        duration === months ? colors.icon : colors.divider,
                    },
                  ]}
                  onPress={() => setDuration(months)}
                >
                  <Text
                    style={[
                      styles.durationText,
                      { color: duration === months ? "#fff" : colors.text },
                    ]}
                  >
                    {months === 1 ? "Hàng tháng" : `${months} tháng`}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Adjust Ratios */}
          <View style={styles.section}>
            <Text style={[styles.label, { color: colors.text }]}>
              Điều chỉnh phân bổ (tùy chọn)
            </Text>
            <Text style={[styles.sublabel, { color: colors.subText }]}>
              AI sẽ học từ điều chỉnh của bạn để cải thiện lần sau
            </Text>

            {/* Needs */}
            <AdjustableCategory
              title="Nhu cầu"
              amount={adjustedNeeds}
              percentage={needsPct}
              color="#FF6B6B"
              onDecrease={() => handleAdjust("needs", -500000)}
              onIncrease={() => handleAdjust("needs", 500000)}
              colors={colors}
            />

            {/* Wants */}
            <AdjustableCategory
              title="Mong muốn"
              amount={adjustedWants}
              percentage={wantsPct}
              color="#4ECDC4"
              onDecrease={() => handleAdjust("wants", -500000)}
              onIncrease={() => handleAdjust("wants", 500000)}
              colors={colors}
            />

            {/* Savings */}
            <AdjustableCategory
              title="Tiết kiệm"
              amount={adjustedSavings}
              percentage={savingsPct}
              color="#95E1D3"
              onDecrease={() => handleAdjust("savings", -500000)}
              onIncrease={() => handleAdjust("savings", 500000)}
              colors={colors}
            />
          </View>

          {/* Period Info */}
          <View style={[styles.infoBox, { backgroundColor: colors.card }]}>
            <MaterialCommunityIcons
              name="calendar-range"
              size={20}
              color={colors.icon}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.infoTitle, { color: colors.text }]}>
                Thời gian áp dụng
              </Text>
              <Text style={[styles.infoText, { color: colors.subText }]}>
                {startDate.toLocaleDateString("vi-VN")} -{" "}
                {endDate.toLocaleDateString("vi-VN")}
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* Save Button */}
        <View style={[styles.footer, { backgroundColor: colors.background }]}>
          <Pressable
            style={[
              styles.saveButton,
              {
                backgroundColor:
                  budgetName.trim() && !saving ? colors.icon : colors.divider,
              },
            ]}
            onPress={handleSave}
            disabled={!budgetName.trim() || saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <MaterialCommunityIcons name="check" size={20} color="#fff" />
                <Text style={styles.saveButtonText}>
                  {hasAdjusted
                    ? "Lưu & Học từ điều chỉnh"
                    : "Tạo ngân sách của tôi"}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Adjustable Category Component
function AdjustableCategory({
  title,
  amount,
  percentage,
  color,
  onDecrease,
  onIncrease,
  colors,
}: any) {
  const adjustCategoryStyle = {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  };

  const adjustCategoryHeaderStyle = {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    marginBottom: 12,
  };

  const adjustCategoryLeftStyle = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  };

  const adjustCategoryDotStyle = {
    width: 12,
    height: 12,
    borderRadius: 6,
  };

  const adjustCategoryTitleStyle = {
    fontSize: 15,
    fontWeight: "600" as const,
  };

  const adjustCategoryPctStyle = {
    fontSize: 14,
    fontWeight: "600" as const,
  };

  const adjustCategoryControlsStyle = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  };

  const adjustButtonStyle = {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };

  const adjustCategoryAmountStyle = {
    fontSize: 18,
    fontWeight: "bold" as const,
  };

  return (
    <View style={[adjustCategoryStyle, { backgroundColor: colors.card }]}>
      <View style={adjustCategoryHeaderStyle}>
        <View style={adjustCategoryLeftStyle}>
          <View style={[adjustCategoryDotStyle, { backgroundColor: color }]} />
          <Text style={[adjustCategoryTitleStyle, { color: colors.text }]}>
            {title}
          </Text>
        </View>
        <Text style={[adjustCategoryPctStyle, { color: colors.text }]}>
          {percentage}%
        </Text>
      </View>
      <View style={adjustCategoryControlsStyle}>
        <Pressable
          style={[adjustButtonStyle, { borderColor: colors.divider }]}
          onPress={onDecrease}
        >
          <MaterialCommunityIcons name="minus" size={20} color={colors.text} />
        </Pressable>
        <Text style={[adjustCategoryAmountStyle, { color: colors.text }]}>
          {amount.toLocaleString("vi-VN")}đ
        </Text>
        <Pressable
          style={[adjustButtonStyle, { borderColor: colors.divider }]}
          onPress={onIncrease}
        >
          <MaterialCommunityIcons name="plus" size={20} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (colors: any, bottomInset: number) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      padding: 20,
      paddingBottom: 120,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 24,
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
    errorText: {
      fontSize: 16,
      textAlign: "center",
      marginTop: 20,
    },
    section: {
      marginBottom: 24,
    },
    label: {
      fontSize: 16,
      fontWeight: "600",
      marginBottom: 12,
    },
    sublabel: {
      fontSize: 14,
      marginBottom: 12,
      lineHeight: 20,
    },
    input: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderRadius: 12,
      borderWidth: 1,
      fontSize: 16,
    },
    durationContainer: {
      flexDirection: "row",
      gap: 8,
    },
    durationButton: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      borderWidth: 1,
      alignItems: "center",
    },
    durationText: {
      fontSize: 14,
      fontWeight: "600",
    },
    adjustCategory: {
      padding: 16,
      borderRadius: 12,
      marginBottom: 12,
    },
    adjustCategoryHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    adjustCategoryLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    adjustCategoryDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
    },
    adjustCategoryTitle: {
      fontSize: 15,
      fontWeight: "600",
    },
    adjustCategoryPct: {
      fontSize: 15,
      fontWeight: "600",
    },
    adjustCategoryControls: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    adjustButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    adjustCategoryAmount: {
      fontSize: 16,
      fontWeight: "bold",
    },
    infoBox: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 16,
      borderRadius: 12,
    },
    infoTitle: {
      fontSize: 15,
      fontWeight: "600",
      marginBottom: 4,
    },
    infoText: {
      fontSize: 14,
    },
    footer: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      padding: 20,
      paddingBottom: bottomInset || 20,
    },
    saveButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 16,
      borderRadius: 12,
    },
    saveButtonText: {
      color: "#fff",
      fontSize: 16,
      fontWeight: "bold",
    },
  });
