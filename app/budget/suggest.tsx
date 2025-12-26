import { useTheme } from "@/app/providers/ThemeProvider";
import { useUser } from "@/context/userContext";
import { useI18n } from "@/i18n/I18nProvider";
import { createBudget } from "@/repos/budgetRepo";
import type { CategoryAllocation } from "@/repos/budgetSuggestion";
import { generateSmartBudget, type LifestyleInput } from "@/services/budgetAi";
import { fixIconName } from "@/utils/iconMapper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
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
  const [aiInsights, setAiInsights] = useState<string[]>([]);
  const [aiMetadata, setAiMetadata] = useState<any>(null);
  const [mlModelUsed, setMlModelUsed] = useState(false);
  const [modelConfidence, setModelConfidence] = useState(0);
  const [modelVersion, setModelVersion] = useState("none");
  const [showHistoricalModal, setShowHistoricalModal] = useState(false);
  const [showVolatilityDetail, setShowVolatilityDetail] = useState(false);

  // Derived insights to keep the summary aligned with actual allocations + user description
  const derivedInsights = React.useMemo(() => {
    if (!needs || !wants || !savings) return [] as string[];

    const topNeeds = needs.items
      .slice()
      .sort((a, b) => b.allocatedAmount - a.allocatedAmount)[0];
    const topWants = wants.items
      .slice()
      .sort((a, b) => b.allocatedAmount - a.allocatedAmount)[0];

    const insights: string[] = [];

    if (topNeeds) {
      insights.push(
        `Ưu tiên nhu cầu: ${
          topNeeds.categoryName
        } (~${topNeeds.allocatedAmount.toLocaleString("vi-VN")}đ)`
      );
    }

    if (topWants) {
      insights.push(
        `Ưu tiên mong muốn: ${
          topWants.categoryName
        } (~${topWants.allocatedAmount.toLocaleString("vi-VN")}đ)`
      );
    }

    return insights;
  }, [needs, wants, savings, lifestyleDesc, aiMetadata?.riskScore]);

  const combinedInsights = React.useMemo(() => {
    const combined = [...derivedInsights, ...aiInsights];
    const seen = new Set<string>();
    return combined.filter((line) => {
      const key = line.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [derivedInsights, aiInsights]);

  // Keep insights concise: drop risk/ratio lines (đã có badge và header) and limit count
  const displayInsights = React.useMemo(() => {
    const filtered = combinedInsights.filter((line) => {
      const lower = line.toLowerCase();
      if (lower.includes("rủi ro")) return false; // risk is shown via badge
      if (lower.includes("50/30/20")) return false; // ratio already in header
      if (lifestyleDesc && lower.includes(lifestyleDesc.toLowerCase()))
        return false; // avoid repeating the same description line
      if (lower.includes("gợi ý được tạo bởi ai")) return false;
      if (lower.includes("gợi ý dựa trên mô tả lối sống")) return false;
      if (lower.includes("50% nhu cầu") || lower.includes("30% mong muốn"))
        return false; // drop explicit ratio sentence
      return true;
    });

    return filtered.slice(0, 6); // allow more diverse tips
  }, [combinedInsights, lifestyleDesc]);

  // AI suggestion không cần thiết nữa vì generateSmartBudget() đã xử lý
  const aiSuggestion = null;

  const historicalSummary = aiMetadata?.historicalSummary;

  const volatilityLabel = React.useMemo(() => {
    if (!historicalSummary) return "-";
    const v = historicalSummary.volatility ?? 0;
    if (v >= 0.6) return "Cao (dao động mạnh)";
    if (v >= 0.3) return "Trung bình";
    return "Thấp (ổn định)";
  }, [historicalSummary]);

  const savingsRateLabel = React.useMemo(() => {
    if (!historicalSummary || historicalSummary.savingsRate == null) return "-";
    const pct = Math.round(historicalSummary.savingsRate * 100);
    if (pct >= 20) return `${pct}% (tốt)`;
    if (pct >= 10) return `${pct}% (ổn)`;
    return `${pct}% (thấp)`;
  }, [historicalSummary]);

  const analyzedMonthsLabel = React.useMemo(() => {
    if (!historicalSummary || !historicalSummary.monthsAnalyzed) return "-";
    const count = historicalSummary.monthsAnalyzed;
    const labels: string[] = [];
    const now = new Date();
    for (let i = 0; i < count; i++) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - i);
      labels.push(`T${d.getMonth() + 1}`);
    }
    return `${count} (${labels.reverse().join(",")})`;
  }, [historicalSummary]);

  const volatilityDetail = React.useMemo(() => {
    if (!historicalSummary) return "";
    const v = Math.round((historicalSummary.volatility ?? 0) * 100);
    if (v >= 60)
      return `Chi tiêu các tháng gần đây dao động mạnh (±${v}% quanh mức trung bình). Hãy kiểm soát những tháng chi cao bất thường.`;
    if (v >= 30)
      return `Chi tiêu biến động vừa (±${v}% quanh mức trung bình). Nên theo dõi các khoản lớn để tránh vượt trần.`;
    return `Chi tiêu khá ổn định (dao động khoảng ±${v}% mỗi tháng).`;
  }, [historicalSummary]);

  const volatileMonthSummaries = React.useMemo(() => {
    const months = historicalSummary?.monthlyTotals;
    if (!months || months.length === 0) return [] as Array<{ label: string; delta: number; total: number }>;
    const avg = months.reduce((s, m) => s + m.total, 0) / months.length;
    return months
      .map((m) => {
        const delta = avg > 0 ? Math.round(((m.total - avg) / avg) * 100) : 0;
        const [year, month] = m.month.split("-");
        const label = `T${parseInt(month, 10)}/${year}`;
        return { label, delta, total: Math.round(m.total) };
      })
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 3);
  }, [historicalSummary]);

  const volatileCategorySummaries = React.useMemo(() => {
    const cats = historicalSummary?.categoryVolatility;
    if (!cats || cats.length === 0) return [] as Array<{ name: string; cv: number; delta: number; avg: number }>;
    return [...cats]
      .sort((a, b) => b.cv - a.cv)
      .slice(0, 3)
      .map((c) => ({
        name: c.categoryName,
        cv: Math.round(c.cv * 100),
        delta: c.avg > 0 ? Math.round(((c.lastAmount - c.avg) / c.avg) * 100) : 0,
        avg: Math.round(c.avg),
      }));
  }, [historicalSummary]);

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
        const safeBudgetId = String(budgetId);
        const budget = await getBudgetById(safeBudgetId);
        const allocations = await listBudgetAllocations(safeBudgetId);

        if (budget && allocations) {
          setBudgetName(budget?.name || "");

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

      // 1. Gọi generateSmartBudget với userId để parse lối sống + lịch sử
      const lifestyleInput: LifestyleInput & { userId?: string } = {
        income: incomeNum,
        description: lifestyleDesc || "",
        period: (period as any) || "monthly",
        userId: user?.id, // Truyền userId để analyze historical data
      };

      const smartBudgetResult = await generateSmartBudget(lifestyleInput);

      // Store AI insights, metadata, and ML model info
      setAiInsights(smartBudgetResult.insights || []);
      setAiMetadata(smartBudgetResult.metadata || null);
      setMlModelUsed(smartBudgetResult.mlModelUsed || false);
      setModelConfidence(smartBudgetResult.modelConfidence || 0);
      setModelVersion(smartBudgetResult.modelVersion || "none");

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

      const customNameSafe = customBudgetName || "";
      if (customNameSafe.trim()) {
        defaultName = customNameSafe.trim();
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
                name={
                  aiMetadata?.source === "tflite-model"
                    ? "cpu-64-bit"
                    : aiMetadata?.source === "ml-hybrid"
                    ? "robot-happy-outline"
                    : aiMetadata?.source === "historical"
                    ? "chart-line"
                    : "lightbulb-outline"
                }
                size={20}
                color={
                  aiMetadata?.source === "tflite-model"
                    ? "#10B981"
                    : aiMetadata?.source === "ml-hybrid"
                    ? "#16A34A"
                    : aiMetadata?.source === "historical"
                    ? "#3B82F6"
                    : "#F59E0B"
                }
              />
              <Text
                style={[
                  styles.infoText,
                  { marginLeft: 8, marginBottom: 0, fontWeight: "600" },
                ]}
              >
                Kế hoạch ngân sách thông minh
              </Text>
              {aiMetadata?.source && (
                <View
                  style={{
                    marginLeft: "auto",
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 12,
                    backgroundColor:
                      aiMetadata.source === "tflite-model"
                        ? "#D1FAE5"
                        : aiMetadata.source === "ml-hybrid"
                        ? "#DCFCE7"
                        : aiMetadata.source === "historical"
                        ? "#DBEAFE"
                        : "#FEF3C7",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: "600",
                      color:
                        aiMetadata.source === "tflite-model"
                          ? "#10B981"
                          : aiMetadata.source === "ml-hybrid"
                          ? "#16A34A"
                          : aiMetadata.source === "historical"
                          ? "#3B82F6"
                          : "#F59E0B",
                    }}
                  >
                    {aiMetadata.source === "tflite-model"
                      ? "TFLite"
                      : aiMetadata.source === "ml-hybrid"
                      ? "AI"
                      : aiMetadata.source === "historical"
                      ? "Lịch sử"
                      : "Chuẩn"}
                  </Text>
                </View>
              )}
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
              Thu nhập:{" "}
              <Text style={{ fontWeight: "600" }}>
                {Number(income || 100000000).toLocaleString("vi-VN")}đ
              </Text>
              /
              {period === "monthly"
                ? "tháng"
                : period === "weekly"
                ? "tuần"
                : "ngày"}
            </Text>

            {lifestyleDesc && lifestyleDesc.trim().length > 0 && (
              <Text
                style={[
                  styles.infoText,
                  {
                    fontSize: 13,
                    lineHeight: 20,
                    color: colors.text,
                    marginTop: 4,
                  },
                ]}
              >
                Mô tả lối sống: "{lifestyleDesc.trim()}"
              </Text>
            )}

            {/* Historical summary (tap to open modal) */}
            {historicalSummary && (
              <>
                <Pressable
                  onPress={() => setShowHistoricalModal(true)}
                  style={{
                    marginTop: 12,
                    padding: 10,
                    borderRadius: 10,
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.divider,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <MaterialCommunityIcons
                      name="history"
                      size={18}
                      color={colors.text}
                    />
                    <View>
                      <Text style={[styles.infoText, { fontWeight: "600" }]}>
                        Tóm tắt lịch sử
                      </Text>
                      <Text
                        style={[
                          styles.infoText,
                          { color: colors.subText, fontSize: 12 },
                        ]}
                      >
                        Nhấn để xem chi tiết phân tích
                      </Text>
                    </View>
                  </View>
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={20}
                    color={colors.subText}
                  />
                </Pressable>

                <Modal
                  visible={showHistoricalModal}
                  transparent
                  animationType="slide"
                  onRequestClose={() => setShowHistoricalModal(false)}
                >
                  <View
                    style={{
                      flex: 1,
                      backgroundColor: "rgba(0,0,0,0.35)",
                      justifyContent: "flex-end",
                    }}
                  >
                    <Pressable
                      style={{ flex: 1 }}
                      onPress={() => setShowHistoricalModal(false)}
                    />
                    <View
                      style={{
                        backgroundColor: colors.background,
                        borderTopLeftRadius: 16,
                        borderTopRightRadius: 16,
                        padding: 16,
                        paddingBottom: 16 + (insets.bottom || 0),
                        gap: 8,
                        borderWidth: 1,
                        borderColor: colors.divider,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <Text
                          style={{
                            fontWeight: "700",
                            fontSize: 16,
                            color: colors.text,
                          }}
                        >
                          Tóm tắt lịch sử
                        </Text>
                        <Pressable
                          onPress={() => setShowHistoricalModal(false)}
                        >
                          <MaterialCommunityIcons
                            name="close"
                            size={20}
                            color={colors.text}
                          />
                        </Pressable>
                      </View>

                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <MaterialCommunityIcons
                          name="cash"
                          size={18}
                          color={colors.text}
                        />
                        <Text style={styles.infoText}>
                          Thu nhập TB:{" "}
                          {historicalSummary.avgIncome.toLocaleString("vi-VN")}đ
                        </Text>
                      </View>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <MaterialCommunityIcons
                          name="wallet"
                          size={18}
                          color={colors.text}
                        />
                        <Text style={styles.infoText}>
                          Chi tiêu TB:{" "}
                          {historicalSummary.totalSpending.toLocaleString(
                            "vi-VN"
                          )}
                          đ
                        </Text>
                      </View>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <MaterialCommunityIcons
                          name="piggy-bank"
                          size={18}
                          color={colors.text}
                        />
                        <Text style={styles.infoText}>
                          Tỷ lệ tiết kiệm: {savingsRateLabel}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => setShowVolatilityDetail((p) => !p)}
                        style={{
                          flexDirection: "column",
                          gap: 4,
                        }}
                      >
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <MaterialCommunityIcons
                            name="chart-areaspline"
                            size={18}
                            color={colors.text}
                          />
                          <Text style={styles.infoText}>
                            Độ biến động: {volatilityLabel}
                          </Text>
                          <MaterialCommunityIcons
                            name={showVolatilityDetail ? "chevron-up" : "chevron-down"}
                            size={16}
                            color={colors.subText}
                          />
                        </View>
                        {showVolatilityDetail && (
                          <Text
                            style={[
                              styles.infoText,
                              {
                                color: colors.subText,
                                fontSize: 12,
                                lineHeight: 18,
                                paddingLeft: 26,
                              },
                            ]}
                          >
                            {volatilityDetail || "Dữ liệu biến động chưa sẵn sàng."}
                          </Text>
                        )}
                        {showVolatilityDetail && volatileMonthSummaries.length > 0 && (
                          <View style={{ gap: 2, paddingLeft: 26, marginTop: 4 }}>
                            {volatileMonthSummaries.map((m, idx) => (
                              <Text
                                key={`vm-${idx}`}
                                style={{
                                  fontSize: 12,
                                  color: colors.subText,
                                  lineHeight: 18,
                                }}
                              >
                                • {m.label}: {m.delta >= 0 ? "+" : ""}
                                {m.delta}% so với TB ({m.total.toLocaleString("vi-VN")}đ)
                              </Text>
                            ))}
                          </View>
                        )}
                        {showVolatilityDetail && volatileCategorySummaries.length > 0 && (
                          <View style={{ gap: 2, paddingLeft: 26, marginTop: 4 }}>
                            {volatileCategorySummaries.map((c, idx) => (
                              <Text
                                key={`vc-${idx}`}
                                style={{
                                  fontSize: 12,
                                  color: colors.subText,
                                  lineHeight: 18,
                                }}
                              >
                                • {c.name}: CV ~{c.cv}% | tháng gần nhất {c.delta >= 0 ? "+" : ""}
                                {c.delta}% vs TB ({c.avg.toLocaleString("vi-VN")}đ)
                              </Text>
                            ))}
                          </View>
                        )}
                      </Pressable>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <MaterialCommunityIcons
                          name="calendar-range"
                          size={18}
                          color={colors.text}
                        />
                        <Text style={styles.infoText}>
                          Tháng phân tích: {analyzedMonthsLabel}
                        </Text>
                      </View>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <MaterialCommunityIcons
                          name="format-list-bulleted"
                          size={18}
                          color={colors.text}
                        />
                        <Text style={styles.infoText}>
                          Số danh mục: {historicalSummary.categoryCount}
                        </Text>
                      </View>
                    </View>
                  </View>
                </Modal>
              </>
            )}

            {/* AI + Derived Insights (deduped & trimmed) */}
            {displayInsights.length > 0 && (
              <View
                style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTopWidth: 1,
                  borderTopColor: colors.divider,
                }}
              >
                {displayInsights.map((insight, idx) => (
                  <Text
                    key={idx}
                    style={[
                      styles.infoText,
                      {
                        fontSize: 12,
                        lineHeight: 18,
                        color: colors.subText,
                        marginTop: idx > 0 ? 6 : 0,
                      },
                    ]}
                  >
                    {insight}
                  </Text>
                ))}
              </View>
            )}

            {/* Metadata indicators */}
            {aiMetadata && (
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 8,
                  marginTop: 12,
                }}
              >
                {/* ML Model Confidence Badge */}
                {mlModelUsed && modelConfidence > 0 && (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 8,
                      backgroundColor: "#E0E7FF",
                    }}
                  >
                    <MaterialCommunityIcons
                      name="brain"
                      size={14}
                      color="#4F46E5"
                    />
                    <Text
                      style={{
                        fontSize: 11,
                        marginLeft: 4,
                        color: "#4F46E5",
                        fontWeight: "600",
                      }}
                    >
                      ML: {(modelConfidence * 100).toFixed(0)}%
                    </Text>
                  </View>
                )}

                {aiMetadata.riskScore !== undefined && (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 8,
                      backgroundColor:
                        aiMetadata.riskScore > 0.7
                          ? "#FEE2E2"
                          : aiMetadata.riskScore > 0.4
                          ? "#FEF3C7"
                          : "#DCFCE7",
                    }}
                  >
                    <MaterialCommunityIcons
                      name={
                        aiMetadata.riskScore > 0.7
                          ? "alert-circle"
                          : aiMetadata.riskScore > 0.4
                          ? "information"
                          : "check-circle"
                      }
                      size={14}
                      color={
                        aiMetadata.riskScore > 0.7
                          ? "#DC2626"
                          : aiMetadata.riskScore > 0.4
                          ? "#F59E0B"
                          : "#16A34A"
                      }
                    />
                    <Text
                      style={{
                        fontSize: 11,
                        marginLeft: 4,
                        color:
                          aiMetadata.riskScore > 0.7
                            ? "#DC2626"
                            : aiMetadata.riskScore > 0.4
                            ? "#F59E0B"
                            : "#16A34A",
                        fontWeight: "600",
                      }}
                    >
                      Rủi ro:{" "}
                      {aiMetadata.riskScore > 0.7
                        ? "Cao"
                        : aiMetadata.riskScore > 0.4
                        ? "Trung bình"
                        : "Thấp"}
                    </Text>
                  </View>
                )}

                {aiMetadata.deviation !== undefined &&
                  aiMetadata.deviation > 0.2 && (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        borderRadius: 8,
                        backgroundColor: "#FEF3C7",
                      }}
                    >
                      <MaterialCommunityIcons
                        name="chart-timeline-variant"
                        size={14}
                        color="#F59E0B"
                      />
                      <Text
                        style={{
                          fontSize: 11,
                          marginLeft: 4,
                          color: "#F59E0B",
                          fontWeight: "600",
                        }}
                      >
                        Khác {Math.round(aiMetadata.deviation * 100)}% so với
                        trước
                      </Text>
                    </View>
                  )}
              </View>
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
