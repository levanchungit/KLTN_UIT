import { useTheme } from "@/app/providers/ThemeProvider";
import { useUser } from "@/context/userContext";
import { useI18n } from "@/i18n/I18nProvider";
import { createBudget } from "@/repos/budgetRepo";
import {
  generateBudgetSuggestion,
  type CategoryAllocation,
} from "@/repos/budgetSuggestion";
import { suggestFullBudget } from "@/utils/budgetAi";
import { fixIconName } from "@/utils/iconMapper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
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

  // AI suggestion tổng quan (ratio + giải thích + fixedExpenses)
  const aiSuggestion = useMemo(() => {
    if (!income) return null;
    const nIncome = Number(String(income).replace(/[^0-9]/g, ""));
    if (!nIncome) return null;

    return suggestFullBudget({
      incomeAfterTax: nIncome,
      lifestyleDesc: lifestyleDesc || "",
    });
  }, [income, lifestyleDesc]);

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

      // === CASE EDIT: dùng allocations đã lưu ===
      if (isEditMode && budgetId) {
        const { getBudgetById, listBudgetAllocations } = await import(
          "@/repos/budgetRepo"
        );
        const budget = await getBudgetById(budgetId);
        const allocations = await listBudgetAllocations(budgetId);

        if (budget && allocations) {
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

      // === CASE TẠO MỚI: dùng generateBudgetSuggestion + AI ratio ===

      // 1. Gợi ý theo lịch sử giao dịch / logic cũ → để lấy category list
      const suggestion = await generateBudgetSuggestion({
        totalIncome: incomeNum,
        period: (period as any) || "monthly",
        lifestyleDesc: lifestyleDesc || "",
      });

      // 2. Lấy target theo AI (đã xét lối sống, fixedExpenses, flags)
      const ai = suggestFullBudget({
        incomeAfterTax: incomeNum,
        lifestyleDesc: lifestyleDesc || "",
      });

      const targetNeedsTotal = ai.groupSummary.needs.target;
      const targetWantsTotal = ai.groupSummary.wants.target;
      const targetSavingsTotal = ai.groupSummary.savings.target;

      // 3. Scale 1 group cho khớp target AI
      const scaleGroup = (
        items: CategoryAllocation[],
        targetTotal: number
      ): { items: CategoryAllocation[]; total: number } => {
        if (items.length === 0) return { items: [], total: 0 };

        const currentTotal = items.reduce((s, a) => s + a.allocatedAmount, 0);

        // Nếu hiện tại đều 0 → chia đều
        if (currentTotal === 0) {
          const base = Math.floor(targetTotal / items.length);
          let remain = targetTotal - base * items.length;
          const newItems = items.map((item, idx) => {
            const extra = idx < remain ? 1 : 0;
            return {
              ...item,
              allocatedAmount: base + extra,
            };
          });
          return { items: newItems, total: targetTotal };
        }

        const factor = targetTotal / currentTotal;

        let newItems = items.map((item) => ({
          ...item,
          allocatedAmount: Math.round(item.allocatedAmount * factor),
        }));

        // Fix sai số do round
        let newTotal = newItems.reduce((s, a) => s + a.allocatedAmount, 0);
        let diff = targetTotal - newTotal;

        if (diff !== 0) {
          let idxMax = 0;
          let maxVal = newItems[0].allocatedAmount;
          newItems.forEach((it, idx) => {
            if (it.allocatedAmount > maxVal) {
              maxVal = it.allocatedAmount;
              idxMax = idx;
            }
          });
          newItems[idxMax] = {
            ...newItems[idxMax],
            allocatedAmount: newItems[idxMax].allocatedAmount + diff,
          };
          newTotal = newItems.reduce((s, a) => s + a.allocatedAmount, 0);
        }

        return { items: newItems, total: newTotal };
      };

      const scaledNeeds = scaleGroup(suggestion.needs, targetNeedsTotal);
      const scaledWants = scaleGroup(suggestion.wants, targetWantsTotal);
      const scaledSavings = scaleGroup(suggestion.savings, targetSavingsTotal);

      // 4. Đặt tên ngân sách như cũ
      const periodType = (period as any) || "monthly";
      const now = new Date();
      let defaultName = "";

      if (customBudgetName && customBudgetName.trim()) {
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

      // 5. Gán vào state (đã enrich icon/color + scale theo AI)
      setNeeds({
        title: "Nhu cầu",
        total: scaledNeeds.total,
        items: enrichItems(scaledNeeds.items),
      });
      setWants({
        title: "Mong muốn",
        total: scaledWants.total,
        items: enrichItems(scaledWants.items),
      });
      setSavings({
        title: "Tiết kiệm",
        total: scaledSavings.total,
        items: enrichItems(scaledSavings.items),
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
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(
          startDate.getFullYear(),
          startDate.getMonth() + 1,
          0,
          23,
          59,
          59
        );
      } else if (periodType === "weekly") {
        const dayOfWeek = startDate.getDay();
        const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        startDate.setDate(startDate.getDate() - daysFromMonday);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
        endDate.setHours(23, 59, 59, 999);
      } else if (periodType === "daily") {
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setHours(23, 59, 59, 999);
      }

      if (isEditMode && budgetId) {
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
          {/* AI Info Card */}
          <View style={styles.infoCard}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <MaterialCommunityIcons
                name="robot-happy-outline"
                size={20}
                color="#16A34A"
              />
              <Text
                style={[
                  styles.infoText,
                  { marginLeft: 8, marginBottom: 0, fontWeight: "600" },
                ]}
              >
                {aiSuggestion
                  ? "Kế hoạch ngân sách do AI gợi ý"
                  : "Kế hoạch ngân sách thông minh"}
              </Text>
            </View>

            {aiSuggestion ? (
              <>
                <Text style={styles.infoText}>
                  Thu nhập:{" "}
                  {aiSuggestion.incomeAfterTax.toLocaleString("vi-VN")}đ/
                  {period === "monthly"
                    ? "tháng"
                    : period === "weekly"
                    ? "tuần"
                    : "ngày"}
                </Text>
                <Text style={styles.infoText}>
                  Gợi ý phân bổ: {(aiSuggestion.ratio.needs * 100).toFixed(0)}%
                  nhu cầu · {(aiSuggestion.ratio.wants * 100).toFixed(0)}% mong
                  muốn · {(aiSuggestion.ratio.savings * 100).toFixed(0)}% tiết
                  kiệm
                </Text>
                <Text style={[styles.infoText, { marginTop: 6 }]}>
                  {aiSuggestion.explanation}
                </Text>

                {aiSuggestion.fixedExpenses.length > 0 && (
                  <View style={{ marginTop: 8 }}>
                    <Text
                      style={[
                        styles.infoText,
                        { fontWeight: "600", marginBottom: 4 },
                      ]}
                    >
                      Một số khoản chi cố định đã phát hiện:
                    </Text>
                    {aiSuggestion.fixedExpenses.slice(0, 3).map((e, idx) => (
                      <Text key={idx} style={styles.infoText}>
                        • {e.rawText} ({e.amount.toLocaleString("vi-VN")}đ ·{" "}
                        {e.groupType === "needs"
                          ? "Nhu cầu"
                          : e.groupType === "wants"
                          ? "Mong muốn"
                          : "Tiết kiệm"}
                        )
                      </Text>
                    ))}
                    {aiSuggestion.fixedExpenses.length > 3 && (
                      <Text style={styles.infoText}>• ...</Text>
                    )}
                  </View>
                )}
              </>
            ) : (
              <Text style={styles.infoText}>
                Phân bổ {totalIncome.toLocaleString("vi-VN")}đ/
                {period === "monthly"
                  ? "tháng"
                  : period === "weekly"
                  ? "tuần"
                  : "ngày"}{" "}
                thành 50% nhu cầu, 30% mong muốn, 20% tiết kiệm. Bạn có thể
                chỉnh sửa trực tiếp.
              </Text>
            )}
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

  // Additional validation: ensure icon exists in MaterialCommunityIcons
  const getValidIconName = (icon: string) => {
    // List of known valid MaterialCommunityIcons (common ones)
    const validIcons = [
      "food", "home-outline", "cart-outline", "piggy-bank", "car", "bus", "airplane",
      "credit-card-outline", "cash", "phone", "wifi", "lightbulb-outline", "gas-station",
      "medical-bag", "school", "account-cash", "gift-outline", "movie-outline", "gamepad-variant",
      "help-circle-outline", "dots-horizontal"
    ];

    if (validIcons.includes(icon)) {
      return icon;
    }

    // Fallback mapping for common invalid icons
    const fallbackMap: Record<string, string> = {
      "food-variant": "food",
      "home": "home-outline",
      "shopping": "cart-outline",
      "shop": "store-outline",
      "transport": "bus",
      "transport-car": "car",
      "flight": "airplane",
      "card": "credit-card-outline",
      "money": "cash",
      "savings": "piggy-bank",
      "noodles": "food",
      "directions-car": "car",
      "flight-takeoff": "airplane-takeoff",
      "piggy-bank-outline": "piggy-bank",
      "assignment": "file-document-outline",
    };

    return fallbackMap[icon] || "help-circle-outline";
  };

  const finalIconName = getValidIconName(iconName);

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
        <MaterialCommunityIcons name={finalIconName} size={20} color="#fff" />
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
