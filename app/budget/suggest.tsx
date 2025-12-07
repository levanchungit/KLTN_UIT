import { useTheme } from "@/app/providers/ThemeProvider";
import { useUser } from "@/context/userContext";
import { useI18n } from "@/i18n/I18nProvider";
import { generateSmartBudget, type LifestyleInput } from "@/lib/budgetAi";
import { createBudget } from "@/repos/budgetRepo";
import type { CategoryAllocation } from "@/repos/budgetSuggestion";
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

  // AI suggestion không cần thiết nữa vì generateSmartBudget() đã xử lý
  const aiSuggestion = null;

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
          // Use icon/color từ SmartBudget nếu có, nếu không thì fallback sang categoryMap
          icon:
            item.icon ||
            categoryMap.get(item.categoryId)?.icon ||
            "mc:help-circle-outline",
          color:
            item.color || categoryMap.get(item.categoryId)?.color || "#7EC5E8",
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

      // === CASE TẠO MỚI: dùng Smart Budget AI ===

      // 1. Gọi generateSmartBudget để parse lối sống + tạo category template
      const lifestyleInput: LifestyleInput = {
        income: incomeNum,
        description: lifestyleDesc || "",
        period: (period as any) || "monthly",
      };

      const smartBudgetResult = await generateSmartBudget(lifestyleInput);

      // 2. Convert categories từ SmartBudgetResult sang CategoryAllocation format
      // Keep icon and color from SmartBudgetResult
      const suggestion = {
        needs: smartBudgetResult.categories
          .filter((c) => c.groupType === "needs")
          .map((c) => ({
            categoryId: c.categoryId,
            categoryName: c.categoryName,
            groupType: c.groupType,
            allocatedAmount: c.allocatedAmount,
            icon: c.categoryIcon,
            color: c.categoryColor,
          })),
        wants: smartBudgetResult.categories
          .filter((c) => c.groupType === "wants")
          .map((c) => ({
            categoryId: c.categoryId,
            categoryName: c.categoryName,
            groupType: c.groupType,
            allocatedAmount: c.allocatedAmount,
            icon: c.categoryIcon,
            color: c.categoryColor,
          })),
        savings: smartBudgetResult.categories
          .filter((c) => c.groupType === "savings")
          .map((c) => ({
            categoryId: c.categoryId,
            categoryName: c.categoryName,
            groupType: c.groupType,
            allocatedAmount: c.allocatedAmount,
            icon: c.categoryIcon,
            color: c.categoryColor,
          })),
      };

      // 3. Không cần scale vì Smart Budget đã phân bổ đúng theo 50/30/20
      const scaledNeeds = {
        items: suggestion.needs,
        total: suggestion.needs.reduce((s, a) => s + a.allocatedAmount, 0),
      };
      const scaledWants = {
        items: suggestion.wants,
        total: suggestion.wants.reduce((s, a) => s + a.allocatedAmount, 0),
      };
      const scaledSavings = {
        items: suggestion.savings,
        total: suggestion.savings.reduce((s, a) => s + a.allocatedAmount, 0),
      };

      // 4. Đặt tên ngân sách
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
                marginBottom: 12,
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
                Kế hoạch ngân sách thông minh
              </Text>
            </View>

            <Text
              style={[
                styles.infoText,
                {
                  fontSize: 13,
                  lineHeight: 20,
                  color: colors.text,
                },
              ]}
            >
              Áp dụng quy tắc 50/30/20 cho thu nhập{" "}
              <Text style={{ fontWeight: "600" }}>
                {Number(income || 100000000).toLocaleString("vi-VN")}đ
              </Text>
              /
              {period === "monthly"
                ? "tháng"
                : period === "weekly"
                ? "tuần"
                : "ngày"}
              :{"\n"}• Nhu cầu (50%):{" "}
              <Text style={{ fontWeight: "600" }}>
                {Math.round(Number(income || 100000000) * 0.5).toLocaleString(
                  "vi-VN"
                )}
                đ
              </Text>
              {"\n"}• Mong muốn (30%):{" "}
              <Text style={{ fontWeight: "600" }}>
                {Math.round(Number(income || 100000000) * 0.3).toLocaleString(
                  "vi-VN"
                )}
                đ
              </Text>
              {"\n"}• Tiết kiệm (20%):{" "}
              <Text style={{ fontWeight: "600" }}>
                {Math.round(Number(income || 100000000) * 0.2).toLocaleString(
                  "vi-VN"
                )}
                đ
              </Text>
            </Text>

            {lifestyleDesc && lifestyleDesc.trim() && (
              <Text
                style={[
                  styles.infoText,
                  {
                    fontSize: 12,
                    fontStyle: "italic",
                    color: colors.subText,
                    lineHeight: 18,
                    marginTop: 12,
                  },
                ]}
              >
                💡 Tôi đã phân tích chi tiết bạn cung cấp ({lifestyleDesc}) và
                phân bổ phần còn lại sao cho đạt đủ tỉ lệ 50/30/20.
              </Text>
            )}

            <Text
              style={[
                styles.infoText,
                {
                  fontSize: 12,
                  fontStyle: "italic",
                  color: colors.subText,
                  lineHeight: 18,
                  marginTop: 8,
                },
              ]}
            >
              💡 Gợi ý: Các chi phí thiết yếu như điện nước, xăng, bảo hiểm nên
              để trong "Chi phí thiết yếu khác". Du lịch nên đặt trong Mong muốn
              để bảo toàn quỹ tiết kiệm.
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

          <View style={{ gap: 12 }}>
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

            {!isEditMode && (
              <Pressable
                style={[
                  styles.retryButton,
                  loading && styles.confirmButtonDisabled,
                ]}
                onPress={() => router.back()}
                disabled={loading}
              >
                <MaterialCommunityIcons name="refresh" size={20} color="#666" />
                <Text style={styles.retryButtonText}>
                  Không hài lòng? Hãy thử lại
                </Text>
              </Pressable>
            )}
          </View>
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
      "food",
      "home-outline",
      "cart-outline",
      "piggy-bank",
      "car",
      "bus",
      "airplane",
      "credit-card-outline",
      "cash",
      "phone",
      "wifi",
      "lightbulb-outline",
      "gas-station",
      "medical-bag",
      "school",
      "account-cash",
      "gift-outline",
      "movie-outline",
      "gamepad-variant",
      "help-circle-outline",
      "dots-horizontal",
    ];

    if (validIcons.includes(icon)) {
      return icon;
    }

    // Fallback mapping for common invalid icons
    const fallbackMap: Record<string, string> = {
      "food-variant": "food",
      home: "home-outline",
      shopping: "cart-outline",
      shop: "store-outline",
      transport: "bus",
      "transport-car": "car",
      flight: "airplane",
      card: "credit-card-outline",
      money: "cash",
      savings: "piggy-bank",
      noodles: "food",
      "directions-car": "car",
      "flight-takeoff": "airplane-takeoff",
      "piggy-bank-outline": "piggy-bank",
      assignment: "file-document-outline",
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
        <MaterialCommunityIcons
          name={finalIconName as any}
          size={20}
          color="#fff"
        />
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
