import { useTheme } from "@/app/providers/ThemeProvider";
import { useUser } from "@/context/userContext";
import { useI18n } from "@/i18n/I18nProvider";
import { createBudget } from "@/repos/budgetRepo";
import {
  generateBudgetSuggestion,
  type CategoryAllocation,
} from "@/repos/budgetSuggestion";
import { fixIconName } from "@/utils/iconMapper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
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

type GroupData = {
  title: string;
  total: number;
  items: (CategoryAllocation & { icon?: string; color?: string })[];
};

export default function BudgetSuggestScreen() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { user } = useUser();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(
    () => makeStyles(colors, insets.bottom),
    [colors, insets.bottom]
  );

  const { income, period, lifestyleDesc, budgetId, customBudgetName } =
    useLocalSearchParams<{
      income?: string;
      period?: "daily" | "weekly" | "monthly";
      lifestyleDesc?: string;
      budgetId?: string;
      customBudgetName?: string;
    }>();

  const isEditMode = !!budgetId;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [budgetName, setBudgetName] = useState("");
  const [needs, setNeeds] = useState<GroupData | null>(null);
  const [wants, setWants] = useState<GroupData | null>(null);
  const [savings, setSavings] = useState<GroupData | null>(null);

  useEffect(() => {
    loadSuggestion();
  }, []);

  const loadSuggestion = async () => {
    try {
      const incomeNum = Number(income || 100000000);

      // Fetch categories to get icons
      const { listCategories } = await import("@/repos/categoryRepo");
      const categories = await listCategories({ type: "expense" });
      const categoryMap = new Map(
        categories.map((c) => [c.id, { icon: c.icon, color: c.color }])
      );

      const enrichItems = (items: any[]) =>
        items.map((item) => ({
          ...item,
          icon:
            categoryMap.get(item.categoryId)?.icon || "mc:help-circle-outline",
          color: categoryMap.get(item.categoryId)?.color || "#7EC5E8",
        }));

      // If edit mode, load existing budget data
      if (isEditMode && budgetId) {
        const { getBudgetById, listBudgetAllocations } = await import(
          "@/repos/budgetRepo"
        );
        const budget = await getBudgetById(budgetId);
        const allocations = await listBudgetAllocations(budgetId);

        if (budget && allocations) {
          // Set budget name from existing budget
          setBudgetName(budget.name);

          const needsItems = allocations.filter(
            (a) => a.group_type === "needs"
          );
          const wantsItems = allocations.filter(
            (a) => a.group_type === "wants"
          );
          const savingsItems = allocations.filter(
            (a) => a.group_type === "savings"
          );

          setNeeds({
            title: "Nhu cầu",
            total: needsItems.reduce((s, a) => s + a.allocated_amount, 0),
            items: enrichItems(
              needsItems.map((a) => ({
                categoryId: a.category_id,
                categoryName: a.category_name || "Unknown",
                groupType: a.group_type,
                allocatedAmount: a.allocated_amount,
              }))
            ),
          });
          setWants({
            title: "Mong muốn",
            total: wantsItems.reduce((s, a) => s + a.allocated_amount, 0),
            items: enrichItems(
              wantsItems.map((a) => ({
                categoryId: a.category_id,
                categoryName: a.category_name || "Unknown",
                groupType: a.group_type,
                allocatedAmount: a.allocated_amount,
              }))
            ),
          });
          setSavings({
            title: "Tiết kiệm",
            total: savingsItems.reduce((s, a) => s + a.allocated_amount, 0),
            items: enrichItems(
              savingsItems.map((a) => ({
                categoryId: a.category_id,
                categoryName: a.category_name || "Unknown",
                groupType: a.group_type,
                allocatedAmount: a.allocated_amount,
              }))
            ),
          });
          return;
        }
      }

      // Otherwise, generate new suggestion
      const suggestion = await generateBudgetSuggestion({
        totalIncome: incomeNum,
        period: (period as any) || "monthly",
        lifestyleDesc: lifestyleDesc || "",
      });

      // Generate default budget name based on period (if custom name not provided)
      const periodType = (period as any) || "monthly";
      const now = new Date();
      let defaultName = "";

      if (customBudgetName && customBudgetName.trim()) {
        // Use custom name from setup if provided
        defaultName = customBudgetName.trim();
      } else if (periodType === "monthly") {
        const monthName = now.toLocaleDateString("vi-VN", {
          month: "long",
          year: "numeric",
        });
        defaultName = `Ngân sách ${monthName}`;
      } else if (periodType === "weekly") {
        const dayOfWeek = now.getDay();
        const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const monday = new Date(now);
        monday.setDate(now.getDate() - daysFromMonday);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        const startDay = monday.getDate();
        const endDay = sunday.getDate();
        const month = monday.getMonth() + 1;
        defaultName = `Ngân sách tuần ${startDay}/${month} - ${endDay}/${month}`;
      } else {
        defaultName = `Ngân sách ${now.toLocaleDateString("vi-VN")}`;
      }

      setBudgetName(defaultName);

      setNeeds({
        title: "Nhu cầu",
        total: suggestion.needs.reduce((s, a) => s + a.allocatedAmount, 0),
        items: enrichItems(suggestion.needs),
      });
      setWants({
        title: "Mong muốn",
        total: suggestion.wants.reduce((s, a) => s + a.allocatedAmount, 0),
        items: enrichItems(suggestion.wants),
      });
      setSavings({
        title: "Tiết kiệm",
        total: suggestion.savings.reduce((s, a) => s + a.allocatedAmount, 0),
        items: enrichItems(suggestion.savings),
      });
    } catch (err) {
      console.error("loadSuggestion error:", err);
    } finally {
      setLoading(false);
      setRegenerating(false);
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    await loadSuggestion();
  };

  const updateCategoryAmount = (
    groupType: "needs" | "wants" | "savings",
    categoryId: string,
    newAmount: number
  ) => {
    const updateGroup = (group: GroupData | null): GroupData | null => {
      if (!group) return null;
      const updatedItems = group.items.map((item) =>
        item.categoryId === categoryId
          ? { ...item, allocatedAmount: newAmount }
          : item
      );
      const newTotal = updatedItems.reduce((s, a) => s + a.allocatedAmount, 0);
      return { ...group, items: updatedItems, total: newTotal };
    };

    if (groupType === "needs") setNeeds(updateGroup(needs));
    else if (groupType === "wants") setWants(updateGroup(wants));
    else setSavings(updateGroup(savings));
  };

  const handleConfirm = async () => {
    if (!needs || !wants || !savings) return;

    // Validate budget name
    if (!budgetName.trim()) {
      alert("Vui lòng nhập tên ngân sách");
      return;
    }

    setSaving(true);
    try {
      const incomeNum = Number(income || 100000000);
      const periodType = (period as any) || "monthly";

      const allAllocations = [
        ...needs.items.map((a) => ({
          categoryId: a.categoryId,
          groupType: a.groupType,
          allocatedAmount: a.allocatedAmount,
        })),
        ...wants.items.map((a) => ({
          categoryId: a.categoryId,
          groupType: a.groupType,
          allocatedAmount: a.allocatedAmount,
        })),
        ...savings.items.map((a) => ({
          categoryId: a.categoryId,
          groupType: a.groupType,
          allocatedAmount: a.allocatedAmount,
        })),
      ];

      // Calculate start and end dates based on period
      const startDate = new Date();
      let endDate: Date | undefined;

      if (periodType === "monthly") {
        // Start from first day of current month
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);

        // End of current month
        endDate = new Date(
          startDate.getFullYear(),
          startDate.getMonth() + 1,
          0,
          23,
          59,
          59
        );
      } else if (periodType === "weekly") {
        // Start from Monday of current week
        const dayOfWeek = startDate.getDay();
        const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Sunday is 0, Monday is 1
        startDate.setDate(startDate.getDate() - daysFromMonday);
        startDate.setHours(0, 0, 0, 0);

        // End on Sunday of current week
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
        endDate.setHours(23, 59, 59, 999);
      } else if (periodType === "daily") {
        // Start from beginning of today
        startDate.setHours(0, 0, 0, 0);

        // End of today
        endDate = new Date(startDate);
        endDate.setHours(23, 59, 59, 999);
      }

      if (isEditMode && budgetId) {
        // Update existing budget
        const { updateBudget } = await import("@/repos/budgetRepo");
        await updateBudget({
          id: budgetId,
          name: budgetName,
          totalIncome: incomeNum,
          period: periodType,
          lifestyleDesc: lifestyleDesc || undefined,
          startDate,
          endDate,
          allocations: allAllocations,
        });
      } else {
        // Create new budget
        await createBudget({
          name: budgetName,
          totalIncome: incomeNum,
          period: periodType,
          lifestyleDesc: lifestyleDesc || undefined,
          startDate,
          endDate,
          allocations: allAllocations,
        });
      }

      // Navigate back to budget list
      router.replace("/(tabs)/budget");
    } catch (err) {
      console.error("handleConfirm error:", err);
      alert("Có lỗi xảy ra khi lưu ngân sách");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#16A34A" />
          <Text style={styles.loadingText}>
            {t("analyzingTransactionHistory")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const totalIncome = Number(income || 100000000);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <MaterialCommunityIcons
            name="arrow-left"
            size={24}
            color={colors.text}
          />
        </Pressable>
        <Text style={styles.headerTitle}>
          {isEditMode ? "Chỉnh sửa ngân sách" : "Gợi ý ngân sách"}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.infoCard}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <MaterialCommunityIcons
                name="lightbulb-on-outline"
                size={20}
                color="#F59E0B"
              />
              <Text
                style={[
                  styles.infoText,
                  { marginLeft: 8, marginBottom: 0, fontWeight: "600" },
                ]}
              >
                Kế hoạch thông minh 50/30/20
              </Text>
            </View>
            <Text style={styles.infoText}>
              Phân bổ {totalIncome.toLocaleString("vi-VN")}đ/
              {period === "monthly"
                ? "tháng"
                : period === "weekly"
                ? "tuần"
                : "ngày"}{" "}
              thành 50% nhu cầu, 30% mong muốn, 20% tiết kiệm dựa trên lịch sử
              giao dịch. Bạn có thể chỉnh sửa trực tiếp.
            </Text>
          </View>

          {/* Budget Name Input */}
          <View style={styles.section}>
            <Text style={styles.label}>Tên ngân sách</Text>
            <TextInput
              style={styles.nameInput}
              value={budgetName}
              onChangeText={setBudgetName}
              placeholder="Nhập tên ngân sách..."
              placeholderTextColor={colors.subText}
            />
          </View>

          {/* Needs */}
          {needs && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{needs.title}</Text>
                <Text style={styles.sectionTotal}>
                  {needs.total.toLocaleString("vi-VN")}đ
                </Text>
              </View>
              {needs.items.map((item, idx) => (
                <EditableCategoryRow
                  key={idx}
                  item={item}
                  colors={colors}
                  onAmountChange={(newAmount) =>
                    updateCategoryAmount("needs", item.categoryId, newAmount)
                  }
                />
              ))}
            </View>
          )}

          {/* Wants */}
          {wants && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{wants.title}</Text>
                <Text style={styles.sectionTotal}>
                  {wants.total.toLocaleString("vi-VN")}đ
                </Text>
              </View>
              {wants.items.map((item, idx) => (
                <EditableCategoryRow
                  key={idx}
                  item={item}
                  colors={colors}
                  onAmountChange={(newAmount) =>
                    updateCategoryAmount("wants", item.categoryId, newAmount)
                  }
                />
              ))}
            </View>
          )}

          {/* Savings */}
          {savings && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{savings.title}</Text>
                <Text style={styles.sectionTotal}>
                  {savings.total.toLocaleString("vi-VN")}đ
                </Text>
              </View>
              {savings.items.map((item, idx) => (
                <EditableCategoryRow
                  key={idx}
                  item={item}
                  colors={colors}
                  onAmountChange={(newAmount) =>
                    updateCategoryAmount("savings", item.categoryId, newAmount)
                  }
                />
              ))}
            </View>
          )}

          <Pressable
            style={[
              styles.confirmButton,
              saving && styles.confirmButtonDisabled,
            ]}
            onPress={handleConfirm}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <MaterialCommunityIcons name="check" size={20} color="#fff" />
                <Text style={styles.confirmButtonText}>
                  {isEditMode ? "Cập nhật" : "Xác nhận"}
                </Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function EditableCategoryRow({
  item,
  colors,
  onAmountChange,
}: {
  item: CategoryAllocation & { icon?: string; color?: string };
  colors: any;
  onAmountChange: (amount: number) => void;
}) {
  const [localValue, setLocalValue] = React.useState(
    item.allocatedAmount.toLocaleString("vi-VN")
  );

  React.useEffect(() => {
    setLocalValue(item.allocatedAmount.toLocaleString("vi-VN"));
  }, [item.allocatedAmount]);

  const handleChange = (text: string) => {
    setLocalValue(text);
    const num = parseFloat(text.replace(/[^0-9]/g, ""));
    if (!isNaN(num) && num >= 0) {
      onAmountChange(num);
    } else if (text === "" || text === "0") {
      onAmountChange(0);
    }
  };

  const handleBlur = () => {
    // Re-format on blur
    const num = parseFloat(localValue.replace(/[^0-9]/g, ""));
    if (!isNaN(num)) {
      setLocalValue(num.toLocaleString("vi-VN"));
    } else {
      setLocalValue("0");
      onAmountChange(0);
    }
  };

  const iconName = fixIconName(
    (item.icon ?? "help-circle-outline").replace(/^mi:/, "mc:")
  ) as any;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: colors.card,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.divider,
        paddingLeft: 10,
        paddingRight: 8,
        paddingVertical: 10,
        marginBottom: 8,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: item.color || colors.divider,
          alignItems: "center",
          justifyContent: "center",
          marginRight: 10,
        }}
      >
        <MaterialCommunityIcons name={iconName} size={20} color="#fff" />
      </View>
      <Text
        style={{ fontSize: 15, color: colors.text, flex: 1, fontWeight: "500" }}
      >
        {item.categoryName}
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          borderWidth: 1,
          borderColor: colors.divider,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 6,
          backgroundColor: colors.background,
        }}
      >
        <TextInput
          value={localValue}
          onChangeText={handleChange}
          onBlur={handleBlur}
          keyboardType="numeric"
          style={{
            fontSize: 14,
            color: colors.text,
            fontWeight: "600",
            minWidth: 80,
            textAlign: "right",
            padding: 0,
          }}
        />
        <Text style={{ fontSize: 14, color: colors.text, marginLeft: 2 }}>
          đ
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (
  c: {
    background: string;
    card: string;
    text: string;
    subText: string;
    divider: string;
  },
  bottomInset: number
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: c.card,
      borderBottomWidth: 1,
      borderBottomColor: c.divider,
    },
    headerTitle: { fontSize: 18, fontWeight: "700", color: c.text },
    content: {
      padding: 16,
      paddingBottom: Math.max(bottomInset, 16),
    },
    loadingContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    loadingText: {
      fontSize: 14,
      color: c.subText,
      marginTop: 12,
    },
    infoCard: {
      backgroundColor: c.card,
      padding: 12,
      borderRadius: 12,
      marginBottom: 16,
    },
    infoText: {
      fontSize: 13,
      lineHeight: 20,
      color: c.text,
    },
    section: {
      marginBottom: 16,
    },
    label: {
      fontSize: 14,
      fontWeight: "600",
      color: c.text,
      marginBottom: 8,
    },
    nameInput: {
      backgroundColor: c.card,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontSize: 15,
      color: c.text,
      borderWidth: 1,
      borderColor: c.divider,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: c.text,
    },
    sectionTotal: {
      fontSize: 16,
      fontWeight: "700",
      color: c.text,
    },
    fabContainer: {
      flexDirection: "row",
    },
    retryFab: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: c.card,
      borderWidth: 1.5,
      borderColor: c.divider,
      alignItems: "center",
      justifyContent: "center",
      elevation: 8,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
    },
    retryFabDisabled: {
      opacity: 0.5,
    },
    confirmButton: {
      height: 48,
      borderRadius: 24,
      backgroundColor: "#16A34A",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      marginTop: 16,
    },
    confirmButtonDisabled: {
      opacity: 0.5,
    },
    confirmButtonText: {
      color: "#fff",
      fontSize: 16,
      fontWeight: "600",
    },
    confirmFab: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: "#16A34A",
      alignItems: "center",
      justifyContent: "center",
      elevation: 8,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
    },
    confirmFabDisabled: {
      opacity: 0.5,
    },
    retryButton: {
      flex: 1,
      height: 48,
      borderRadius: 24,
      backgroundColor: c.card,
      borderWidth: 1.5,
      borderColor: c.divider,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    retryButtonDisabled: {
      opacity: 0.5,
    },
    retryButtonText: {
      color: c.text,
      fontSize: 15,
      fontWeight: "600",
    },
  });
