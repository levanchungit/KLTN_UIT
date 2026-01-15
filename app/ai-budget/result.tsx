import { useTheme } from "@/app/providers/ThemeProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { createBudget } from "@/repos/budgetRepo";
import { createCategory, listCategories } from "@/repos/categoryRepo";
import type { BudgetAdviceResult } from "@/services/aiBudgetAdvisor";
import { fixIconName } from "@/utils/iconMapper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

export default function ResultScreen() {
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

  const [saving, setSaving] = useState(false);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  useEffect(() => {
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

  if (!result) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={[styles.errorText, { color: colors.text }]}>
          Không có dữ liệu
        </Text>
      </SafeAreaView>
    );
  }

  const needsCategories = result.categories.filter(
    (c) => c.groupType === "needs"
  );
  const wantsCategories = result.categories.filter(
    (c) => c.groupType === "wants"
  );
  const savingsCategories = result.categories.filter(
    (c) => c.groupType === "savings"
  );

  const needsPct = ((result.needsAmount / result.totalIncome) * 100).toFixed(0);
  const wantsPct = ((result.wantsAmount / result.totalIncome) * 100).toFixed(0);
  const savingsPct = (
    (result.savingsAmount / result.totalIncome) *
    100
  ).toFixed(0);

  const handleSave = async () => {
    setSaving(true);

    try {
      const totalIncome = parseInt(income || "0");
      const startDate = new Date();
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + 1); // 1 month budget

      // 🔍 Step 1: Check if all categories exist in DB, create if missing
      const existingCategories = await listCategories({});
      const existingIds = new Set(existingCategories.map((c) => c.id));

      // Map to store new IDs for created categories
      const categoryIdMap = new Map<string, string>();

      for (const cat of result.categories) {
        if (!existingIds.has(cat.categoryId)) {
          console.log(
            `[ResultScreen] Creating missing category: ${cat.categoryId} - ${cat.categoryName}`
          );

          // Create the category with proper icon normalization
          let icon = cat.categoryIcon;
          if (icon && !icon.includes(":")) {
            icon = `mi:${icon}`;
          }

          const newCategoryId = await createCategory({
            name: cat.categoryName,
            type: "expense", // All budget categories are expense type
            icon: icon || "mi:category",
            color: cat.categoryColor || "#757575",
            parent_id: null,
          });

          // Map old ID to new ID
          categoryIdMap.set(cat.categoryId, newCategoryId);
          console.log(
            `[ResultScreen] Created category ${newCategoryId} for ${cat.categoryId}`
          );
        }
      }

      // 💰 Step 2: Prepare allocations with updated categoryIds
      const allocations = result.categories.map((cat) => ({
        categoryId: categoryIdMap.get(cat.categoryId) || cat.categoryId,
        groupType: cat.groupType,
        allocatedAmount: cat.allocatedAmount,
      }));

      // 🎯 Step 3: Ensure total allocated equals totalIncome
      const totalAllocated = allocations.reduce(
        (sum, a) => sum + a.allocatedAmount,
        0
      );
      const difference = totalIncome - totalAllocated;

      if (difference !== 0 && allocations.length > 0) {
        // Adjust the first savings category, or last category if no savings
        const savingsIndex = allocations.findIndex(
          (a) => a.groupType === "savings"
        );
        const targetIndex =
          savingsIndex >= 0 ? savingsIndex : allocations.length - 1;
        allocations[targetIndex].allocatedAmount += difference;
        allocations[targetIndex].allocatedAmount = Math.max(
          0,
          allocations[targetIndex].allocatedAmount
        );
      }

      console.log(
        `[ResultScreen] Saving budget with ${
          allocations.length
        } allocations, total: ${allocations.reduce(
          (s, a) => s + a.allocatedAmount,
          0
        )}`
      );

      // 💾 Step 4: Save to database
      const budgetId = await createBudget({
        name: `Ngân sách AI - ${new Date().toLocaleDateString("vi-VN", {
          month: "long",
          year: "numeric",
        })}`,
        totalIncome,
        period: period || "monthly",
        lifestyleDesc: lifestyleDesc || "",
        startDate,
        endDate,
        allocations,
      });

      // Navigate to budget detail
      router.replace(`/budget/detail?id=${budgetId}`);
    } catch (error) {
      console.error("[ResultScreen] Save error:", error);
      Alert.alert("Lỗi", "Không thể lưu ngân sách. Vui lòng thử lại.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={styles.backButton}
            hitSlop={8}
          >
            <MaterialCommunityIcons
              name="close"
              size={24}
              color={colors.text}
            />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Gợi ý ngân sách
          </Text>
          <View style={{ width: 40 }} />
        </View>

        <Animated.View
          style={{
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          }}
        >
          {/* Explanation Text */}
          {result.explanationText && (
            <View
              style={[
                styles.explanationBox,
                { backgroundColor: colors.card, borderColor: colors.divider },
              ]}
            >
              <Text style={[styles.explanationText, { color: colors.subText }]}>
                {result.explanationText}
              </Text>
            </View>
          )}

          {/* Needs Section */}
          <CategoryGroup
            title="Nhu cầu"
            subtitle={`${result.needsAmount.toLocaleString("vi-VN")}đ`}
            percentage={needsPct}
            icon="food"
            color="#FF6B6B"
            categories={needsCategories}
            totalIncome={result.totalIncome}
            colors={colors}
          />

          {/* Wants Section */}
          <CategoryGroup
            title="Mong muốn"
            subtitle={`${result.wantsAmount.toLocaleString("vi-VN")}đ`}
            percentage={wantsPct}
            icon="cart"
            color="#4ECDC4"
            categories={wantsCategories}
            totalIncome={result.totalIncome}
            colors={colors}
          />

          {/* Savings Section */}
          <CategoryGroup
            title="Tiết kiệm"
            subtitle={`${result.savingsAmount.toLocaleString("vi-VN")}đ`}
            percentage={savingsPct}
            icon="piggy-bank"
            color="#95E1D3"
            categories={savingsCategories}
            totalIncome={result.totalIncome}
            colors={colors}
          />
        </Animated.View>
      </ScrollView>

      {/* Actions */}
      <View style={[styles.actions, { backgroundColor: colors.background }]}>
        <Pressable
          style={[styles.primaryButton, { backgroundColor: colors.icon }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Text style={styles.primaryButtonText}>Tạo ngân sách</Text>
              <MaterialCommunityIcons name="check" size={20} color="#fff" />
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// Category Group Component
function CategoryGroup({
  title,
  subtitle,
  percentage,
  icon,
  color,
  categories,
  totalIncome,
  colors,
}: any) {
  const [expanded, setExpanded] = useState(true);

  const groupContainerStyle = {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  };

  const groupHeaderStyle = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  };

  const groupHeaderLeftStyle = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
  };

  const groupIconStyle = {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };

  const groupTitleStyle = {
    fontSize: 16,
    fontWeight: "600" as const,
  };

  const groupSubtitleStyle = {
    fontSize: 13,
    marginTop: 2,
  };

  const categoriesListStyle = {
    marginTop: 12,
    gap: 8,
  };

  const categoryItemStyle = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 12,
  };

  const categoryLeftStyle = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
  };

  const categoryIconStyle = {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };

  const categoryNameStyle = {
    fontSize: 15,
  };

  const categoryAmountStyle = {
    fontSize: 15,
    fontWeight: "600" as const,
  };

  return (
    <View style={[groupContainerStyle, { backgroundColor: colors.card }]}>
      <Pressable
        style={groupHeaderStyle}
        onPress={() => setExpanded(!expanded)}
      >
        <View style={groupHeaderLeftStyle}>
          <View style={[groupIconStyle, { backgroundColor: color + "20" }]}>
            <MaterialCommunityIcons name={icon} size={20} color={color} />
          </View>
          <View>
            <Text style={[groupTitleStyle, { color: colors.text }]}>
              {title} ({percentage}%)
            </Text>
            <Text style={[groupSubtitleStyle, { color: colors.subText }]}>
              {subtitle}
            </Text>
          </View>
        </View>
        <MaterialCommunityIcons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={24}
          color={colors.subText}
        />
      </Pressable>

      {expanded && (
        <View style={categoriesListStyle}>
          {categories.map((cat: any) => (
            <View key={cat.categoryId} style={categoryItemStyle}>
              <View style={categoryLeftStyle}>
                <View
                  style={[
                    categoryIconStyle,
                    { backgroundColor: cat.categoryColor + "20" },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={fixIconName(cat.categoryIcon) as any}
                    size={20}
                    color={cat.categoryColor}
                  />
                </View>
                <Text style={[categoryNameStyle, { color: colors.text }]}>
                  {cat.categoryName}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[categoryAmountStyle, { color: colors.text }]}>
                  {cat.allocatedAmount.toLocaleString("vi-VN")}đ
                </Text>
                <Text
                  style={[
                    { fontSize: 12, color: colors.subText, marginTop: 2 },
                  ]}
                >
                  {totalIncome > 0
                    ? ((cat.allocatedAmount / totalIncome) * 100).toFixed(1)
                    : 0}
                  %
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
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
      padding: 16,
      paddingBottom: 60,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 20,
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
    explanationBox: {
      padding: 16,
      borderRadius: 12,
      marginBottom: 16,
      borderWidth: 1,
    },
    explanationText: {
      fontSize: 14,
      lineHeight: 22,
      marginBottom: 8,
    },
    learnMoreLink: {
      marginTop: 4,
    },
    learnMoreText: {
      fontSize: 13,
      textDecorationLine: "underline",
    },
    groupContainer: {
      borderRadius: 12,
      marginBottom: 12,
      overflow: "hidden",
    },
    groupHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: 16,
    },
    groupHeaderLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    groupIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
    },
    groupTitle: {
      fontSize: 16,
      fontWeight: "600",
    },
    groupSubtitle: {
      fontSize: 14,
      marginTop: 2,
    },
    categoriesList: {
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    categoryItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    categoryLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      flex: 1,
    },
    categoryIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    categoryName: {
      fontSize: 15,
    },
    categoryAmount: {
      fontSize: 15,
      fontWeight: "600",
    },
    actions: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      padding: 16,
      paddingBottom: bottomInset || 16,
    },
    primaryButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 16,
      borderRadius: 12,
    },
    primaryButtonText: {
      color: "#fff",
      fontSize: 16,
      fontWeight: "600",
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    modalBackdrop: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    modalContent: {
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 24,
      maxHeight: "80%",
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: "bold",
      marginBottom: 16,
    },
    modalText: {
      fontSize: 15,
      lineHeight: 24,
      marginBottom: 24,
    },
    modalButton: {
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: "center",
      marginTop: 16,
    },
    modalButtonText: {
      color: "#fff",
      fontSize: 16,
      fontWeight: "600",
    },
    categoryModal: {
      margin: 20,
      borderRadius: 16,
      padding: 20,
    },
    categoryModalHeader: {
      alignItems: "center",
      marginBottom: 20,
    },
    categoryModalIcon: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
    },
    categoryModalTitle: {
      fontSize: 18,
      fontWeight: "bold",
    },
    categoryModalBody: {
      marginBottom: 20,
    },
    categoryModalRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    categoryModalLabel: {
      fontSize: 15,
    },
    categoryModalValue: {
      fontSize: 15,
      fontWeight: "600",
    },
    categoryModalReason: {
      marginTop: 12,
      padding: 12,
      borderRadius: 8,
    },
    categoryModalReasonText: {
      fontSize: 14,
      lineHeight: 20,
    },
  });
