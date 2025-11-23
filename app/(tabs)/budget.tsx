import { useTheme } from "@/app/providers/ThemeProvider";
import { useI18n } from "@/i18n/I18nProvider";
import {
  computeBudgetProgress,
  deleteBudget,
  getActiveBudget,
  listBudgets,
  type Budget,
} from "@/repos/budgetRepo";
import { fixIconName } from "@/utils/iconMapper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
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

type BudgetItem = {
  categoryId: string;
  categoryName: string;
  categoryIcon: string | null | undefined;
  categoryColor: string | null | undefined;
  groupType: "needs" | "wants" | "savings";
  allocated: number;
  spent: number;
  percent: number;
  exceeded: boolean;
};

export default function BudgetScreen() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);

  const [budget, setBudget] = useState<Budget | null>(null);
  const [allBudgets, setAllBudgets] = useState<Budget[]>([]);
  const [items, setItems] = useState<BudgetItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [totalAllocated, setTotalAllocated] = useState(0);
  const [totalSpent, setTotalSpent] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterPeriod, setFilterPeriod] = useState<
    "all" | "daily" | "weekly" | "monthly"
  >("all");

  const loadBudget = useCallback(async () => {
    try {
      // Load all budgets with progress
      const budgets = await listBudgets();

      // Compute progress for each budget
      const budgetsWithProgress = await Promise.all(
        budgets.map(async (b) => {
          try {
            const progress = await computeBudgetProgress(b.id);
            return {
              ...b,
              totalSpent: progress.totalSpent,
              totalAllocated: progress.totalAllocated,
            };
          } catch {
            return { ...b, totalSpent: 0, totalAllocated: 0 };
          }
        })
      );

      setAllBudgets(budgetsWithProgress);

      // Get active budget
      const active = await getActiveBudget();
      if (!active) {
        setBudget(null);
        setItems([]);
        return;
      }

      const progress = await computeBudgetProgress(active.id);
      setBudget(progress.budget);
      setTotalAllocated(progress.totalAllocated);
      setTotalSpent(progress.totalSpent);

      const mapped: BudgetItem[] = progress.allocations.map((a) => ({
        categoryId: a.category_id,
        categoryName: a.category_name ?? "Unknown",
        categoryIcon: a.category_icon,
        categoryColor: a.category_color,
        groupType: a.group_type,
        allocated: a.allocated_amount,
        spent: a.spent_amount,
        percent: a.percent,
        exceeded: a.exceeded,
      }));
      setItems(mapped);
    } catch (err) {
      console.error("loadBudget error:", err);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadBudget();
    }, [loadBudget])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadBudget();
    setRefreshing(false);
  }, [loadBudget]);

  const handleCreateBudget = () => {
    router.push("/budget/setup");
  };

  const handleDeleteBudget = useCallback(
    async (budgetId: string, budgetName: string) => {
      Alert.alert(
        t("deleteBudgetTitle"),
        t("confirmDeleteBudget", { name: budgetName }),
        [
          { text: t("cancel"), style: "cancel" },
          {
            text: t("delete"),
            style: "destructive",
            onPress: async () => {
              try {
                await deleteBudget(budgetId);
                await loadBudget(); // Reload after delete
              } catch (err) {
                console.error("Delete budget error:", err);
                Alert.alert(t("error"), t("cannotDeleteBudget"));
              }
            },
          },
        ]
      );
    },
    [loadBudget]
  );

  const handleViewBudget = useCallback(
    (budgetId: string) => {
      router.push({
        pathname: "/budget/detail",
        params: { id: budgetId },
      });
    },
    [router]
  );

  // Filter budgets based on search and period
  const filteredBudgets = React.useMemo(() => {
    return allBudgets.filter((b) => {
      const matchSearch =
        searchQuery === "" ||
        b.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchPeriod = filterPeriod === "all" || b.period === filterPeriod;
      return matchSearch && matchPeriod;
    });
  }, [allBudgets, searchQuery, filterPeriod]);

  // Calculate overall summary of all budgets
  const overallSummary = React.useMemo(() => {
    let totalBudget = 0;
    let totalSpentAll = 0;

    allBudgets.forEach((b) => {
      totalBudget += b.total_income;
      // Note: We'll need to calculate spent for each budget
      // For now, using the active budget's spent if it matches
      if (budget && b.id === budget.id) {
        totalSpentAll += totalSpent;
      }
    });

    const remaining = totalBudget - totalSpentAll;
    const percent =
      totalBudget > 0 ? Math.round((totalSpentAll / totalBudget) * 100) : 0;

    return { totalBudget, totalSpentAll, remaining, percent };
  }, [allBudgets, budget, totalSpent]);

  // Get warning color based on percentage
  const getWarningColor = (percent: number) => {
    if (percent >= 90) return "#E84A3C"; // Red
    if (percent >= 70) return "#F59E0B"; // Yellow
    return "#16A34A"; // Green
  };

  if (!budget) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t("budgetTab")}</Text>
          <View style={{ flex: 1 }} />
        </View>
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          <MaterialCommunityIcons
            name="piggy-bank-outline"
            size={80}
            color={colors.subText}
          />
          <Text style={styles.emptyTitle}>{t("noBudgets")}</Text>
          <Text style={styles.emptyDesc}>{t("noBudgetsDesc")}</Text>
        </ScrollView>

        {/* Floating Action Button (icon-only) */}
        <Pressable style={styles.fab} onPress={handleCreateBudget}>
          <MaterialCommunityIcons
            name="wallet-plus-outline"
            size={24}
            color="#fff"
          />
        </Pressable>
      </SafeAreaView>
    );
  }

  // Group items by type
  const needs = items.filter((i) => i.groupType === "needs");
  const wants = items.filter((i) => i.groupType === "wants");
  const savings = items.filter((i) => i.groupType === "savings");

  const overallPercent =
    totalAllocated > 0 ? Math.round((totalSpent / totalAllocated) * 100) : 0;

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t("budgetTab")}</Text>
        <View style={{ flex: 1 }} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(140, insets.bottom + 140) },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Overall Summary Card */}
        <View style={styles.overallSummaryCard}>
          <Text style={styles.overallSummaryTitle}>{t("budgetOverview")}</Text>
          <View style={styles.overallSummaryRow}>
            <View style={styles.overallSummaryItem}>
              <Text style={styles.overallSummaryLabel}>{t("totalBudget")}</Text>
              <Text style={styles.overallSummaryValue}>
                {overallSummary.totalBudget.toLocaleString("vi-VN")}đ
              </Text>
            </View>
            <View style={styles.overallSummaryItem}>
              <Text style={styles.overallSummaryLabel}>{t("spent")}</Text>
              <Text
                style={[
                  styles.overallSummaryValue,
                  { color: getWarningColor(overallSummary.percent) },
                ]}
              >
                {overallSummary.totalSpentAll.toLocaleString("vi-VN")}đ
              </Text>
            </View>
            <View style={styles.overallSummaryItem}>
              <Text style={styles.overallSummaryLabel}>{t("remaining")}</Text>
              <Text style={styles.overallSummaryValue}>
                {overallSummary.remaining.toLocaleString("vi-VN")}đ
              </Text>
            </View>
          </View>
          <View style={styles.progressContainer}>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressBar,
                  {
                    width: `${Math.min(overallSummary.percent, 100)}%`,
                    backgroundColor: getWarningColor(overallSummary.percent),
                  },
                ]}
              />
            </View>
            <View style={styles.percentPill}>
              <Text style={styles.percentPillText}>
                {overallSummary.percent}%
              </Text>
            </View>
          </View>
        </View>

        {/* Search and Filter */}
        <View style={styles.searchFilterContainer}>
          <View style={styles.searchBox}>
            <MaterialCommunityIcons
              name="magnify"
              size={20}
              color={colors.subText}
            />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t("searchBudgets")}
              placeholderTextColor={colors.subText}
              returnKeyType="search"
            />
          </View>
          <View style={styles.filterRow}>
            {(["all", "daily", "weekly", "monthly"] as const).map((p) => (
              <Pressable
                key={p}
                onPress={() => setFilterPeriod(p)}
                style={[
                  styles.filterChip,
                  filterPeriod === p && styles.filterChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    filterPeriod === p && styles.filterChipTextActive,
                  ]}
                >
                  {p === "all" && t("all")}
                  {p === "daily" && t("day")}
                  {p === "weekly" && t("week")}
                  {p === "monthly" && t("month")}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Smart Recommendations */}
        {overallSummary.percent >= 80 && (
          <View style={styles.recommendationCard}>
            <View style={styles.recommendationHeader}>
              <MaterialCommunityIcons
                name="lightbulb-on"
                size={20}
                color="#F59E0B"
              />
              <Text style={styles.recommendationTitle}>
                {t("smartRecommendations")}
              </Text>
            </View>
            <Text style={styles.recommendationText}>
              {overallSummary.percent >= 90
                ? t("recommendationHigh")
                : t("recommendationMedium", {
                    percent: overallSummary.percent.toFixed(0),
                  })}
            </Text>
          </View>
        )}

        {/* All Budgets List */}
        {filteredBudgets.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("budgetsList")}</Text>
            <Text style={styles.sectionSubtitle}>
              {t("showingPlans", {
                shown: filteredBudgets.length,
                total: allBudgets.length,
              })}
            </Text>
            {filteredBudgets.map((b) => (
              <BudgetListItem
                key={b.id}
                budget={b}
                isActive={b.id === budget?.id}
                colors={colors}
                onDelete={handleDeleteBudget}
                onView={handleViewBudget}
              />
            ))}
          </View>
        ) : (
          <View style={styles.emptyFilterContainer}>
            <MaterialCommunityIcons
              name="filter-off-outline"
              size={60}
              color={colors.subText}
            />
            <Text style={styles.emptyTitle}>{t("noBudgetsFound")}</Text>
            <Text style={styles.emptyDesc}>{t("tryAdjustFilter")}</Text>
          </View>
        )}
      </ScrollView>

      {/* Floating Action Button (icon-only) */}
      <Pressable
        style={[
          styles.fab,
          {
            bottom: insets.bottom + 86,
            zIndex: 1100,
            elevation: 30,
            shadowOpacity: 0.35,
          },
        ]}
        onPress={handleCreateBudget}
      >
        <MaterialCommunityIcons
          name="wallet-plus-outline"
          size={24}
          color="#fff"
        />
      </Pressable>
    </SafeAreaView>
  );
}

function BudgetListItem({
  budget,
  isActive,
  colors,
  onDelete,
  onView,
}: {
  budget: Budget & { totalSpent?: number; totalAllocated?: number };
  isActive: boolean;
  colors: any;
  onDelete: (budgetId: string, budgetName: string) => Promise<void>;
  onView: (budgetId: string) => void;
}) {
  const { t } = useI18n();
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const day = date.getDate().toString().padStart(2, "0");
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const getPeriodLabel = (period: string) => {
    switch (period) {
      case "daily":
        return t("daily");
      case "weekly":
        return t("weekly");
      case "monthly":
        return t("monthly");
      default:
        return period;
    }
  };

  const dateRange = budget.end_date
    ? t("fromTo", {
        start: formatDate(budget.start_date),
        end: formatDate(budget.end_date),
      })
    : t("from", { start: formatDate(budget.start_date) });

  // Determine border color based on budget status
  const isExceeded =
    budget.totalSpent !== undefined &&
    budget.totalAllocated !== undefined &&
    budget.totalSpent > budget.totalAllocated;
  const borderColor = isExceeded ? "#E84A3C" : "#16A34A";

  return (
    <Pressable
      onPress={() => onView(budget.id)}
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: 12,
          padding: 14,
          marginBottom: 8,
          borderLeftWidth: 4,
          borderLeftColor: borderColor,
        },
      ]}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 16,
              fontWeight: "600",
              color: colors.text,
              marginBottom: 4,
            }}
          >
            {budget.name}
          </Text>
          <Text
            style={{ fontSize: 13, color: colors.subText, marginBottom: 2 }}
          >
            <MaterialCommunityIcons
              name="calendar"
              size={13}
              color={colors.subText}
            />{" "}
            {getPeriodLabel(budget.period)}
          </Text>
          <Text style={{ fontSize: 13, color: colors.subText }}>
            <MaterialCommunityIcons
              name="calendar-range"
              size={13}
              color={colors.subText}
            />{" "}
            {dateRange}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {/* Active badge removed as requested */}
          <Pressable
            onPress={() => onDelete(budget.id, budget.name)}
            style={{
              padding: 4,
            }}
          >
            <MaterialCommunityIcons
              name="delete-outline"
              size={20}
              color="#E84A3C"
            />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

const makeStyles = (c: {
  background: string;
  card: string;
  text: string;
  subText: string;
  divider: string;
}) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: c.divider,
      backgroundColor: c.card,
    },
    headerTitle: {
      fontSize: 20,
      fontWeight: "700",
      color: c.text,
    },
    content: { padding: 16, paddingBottom: 80 },
    overallSummaryCard: {
      backgroundColor: c.card,
      borderRadius: 16,
      padding: 16,
      marginBottom: 12,
    },
    overallSummaryTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: c.text,
      marginBottom: 12,
    },
    overallSummaryRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    overallSummaryItem: {
      flex: 1,
      alignItems: "center",
      paddingHorizontal: 4,
    },
    overallSummaryLabel: {
      fontSize: 11,
      color: c.subText,
      marginBottom: 4,
      textAlign: "center",
    },
    overallSummaryValue: {
      fontSize: 15,
      fontWeight: "700",
      color: c.text,
      textAlign: "center",
    },
    searchFilterContainer: {
      marginBottom: 12,
    },
    searchBox: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.card,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: c.divider,
    },
    searchInput: {
      flex: 1,
      fontSize: 15,
      color: c.subText,
      marginLeft: 8,
    },
    filterRow: {
      flexDirection: "row",
      gap: 8,
    },
    filterChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.divider,
    },
    filterChipActive: {
      backgroundColor: "#DCFCE7",
      borderColor: "#16A34A",
    },
    filterChipText: {
      fontSize: 13,
      color: c.subText,
      fontWeight: "500",
    },
    filterChipTextActive: {
      color: "#16A34A",
      fontWeight: "600",
    },
    recommendationCard: {
      backgroundColor: "#FEF3C7",
      borderRadius: 12,
      padding: 12,
      marginBottom: 12,
      borderLeftWidth: 4,
      borderLeftColor: "#F59E0B",
    },
    recommendationHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 8,
    },
    recommendationTitle: {
      fontSize: 14,
      fontWeight: "600",
      color: "#92400E",
    },
    recommendationText: {
      fontSize: 13,
      color: "#78350F",
      lineHeight: 20,
    },
    emptyContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 32,
    },
    emptyFilterContainer: {
      alignItems: "center",
      justifyContent: "center",
      padding: 40,
      marginTop: 20,
    },
    emptyTitle: {
      fontSize: 20,
      fontWeight: "700",
      color: c.text,
      marginTop: 16,
    },
    emptyDesc: {
      fontSize: 14,
      color: c.subText,
      textAlign: "center",
      marginTop: 8,
    },
    progressContainer: {
      position: "relative",
      marginTop: 8,
      height: 20,
      justifyContent: "center",
    },
    progressTrack: {
      height: 8,
      backgroundColor: c.divider,
      borderRadius: 4,
      overflow: "hidden",
    },
    progressBar: { height: 8, borderRadius: 4 },
    percentPill: {
      position: "absolute",
      alignSelf: "center",
      paddingHorizontal: 10,
      height: 20,
      borderRadius: 10,
      backgroundColor: c.card,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: c.divider,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 1,
    },
    percentPillText: {
      fontSize: 11,
      fontWeight: "600",
      color: c.text,
    },
    section: { marginBottom: 16 },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: c.text,
      marginBottom: 8,
    },
    sectionSubtitle: {
      fontSize: 13,
      color: c.subText,
      marginBottom: 12,
      marginTop: -4,
    },
    fab: {
      position: "absolute",
      right: 16,
      bottom: 120,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: "#16A34A",
      alignItems: "center",
      justifyContent: "center",
      elevation: 20,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.3,
      shadowRadius: 12,
    },
  });
