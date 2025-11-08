import { useTheme } from "@/app/providers/ThemeProvider";
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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(
    () => makeStyles(colors, insets.bottom),
    [colors, insets.bottom]
  );

  const [activeTab, setActiveTab] = useState<"list" | "goals">("list");
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

  const handleEditBudget = useCallback(
    (budgetToEdit: Budget) => {
      router.push({
        pathname: "/budget/suggest",
        params: {
          budgetId: budgetToEdit.id,
          income: budgetToEdit.total_income.toString(),
          period: budgetToEdit.period,
          lifestyleDesc: budgetToEdit.lifestyle_desc || "",
        },
      });
    },
    [router]
  );

  const handleDeleteBudget = useCallback(
    async (budgetId: string, budgetName: string) => {
      Alert.alert("Xóa ngân sách", `Bạn có chắc muốn xóa "${budgetName}"?`, [
        { text: "Hủy", style: "cancel" },
        {
          text: "Xóa",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteBudget(budgetId);
              await loadBudget(); // Reload after delete
            } catch (err) {
              console.error("Delete budget error:", err);
              Alert.alert("Lỗi", "Không thể xóa ngân sách");
            }
          },
        },
      ]);
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
          <View style={{ flex: 1 }} />
        </View>
        <View style={styles.divider} />

        {/* Tabs */}
        <View style={styles.tabContainer}>
          <Pressable
            style={[styles.tab, activeTab === "list" && styles.tabActive]}
            onPress={() => setActiveTab("list")}
          >
            <MaterialCommunityIcons
              name="wallet-outline"
              size={20}
              color={activeTab === "list" ? "#16A34A" : colors.subText}
            />
            <Text
              style={[
                styles.tabText,
                activeTab === "list" && styles.tabTextActive,
              ]}
            >
              Ngân sách
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tab, activeTab === "goals" && styles.tabActive]}
            onPress={() => setActiveTab("goals")}
          >
            <MaterialCommunityIcons
              name="target"
              size={20}
              color={activeTab === "goals" ? "#16A34A" : colors.subText}
            />
            <Text
              style={[
                styles.tabText,
                activeTab === "goals" && styles.tabTextActive,
              ]}
            >
              Mục tiêu
            </Text>
          </Pressable>
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
          <Text style={styles.emptyTitle}>
            {activeTab === "list" ? "Chưa có ngân sách" : "Chưa có mục tiêu"}
          </Text>
          <Text style={styles.emptyDesc}>
            {activeTab === "list"
              ? "Tạo kế hoạch chi tiêu thông minh với quy tắc 50/30/20"
              : "Đặt mục tiêu tài chính và theo dõi tiến độ"}
          </Text>
        </ScrollView>

        {/* Floating Action Button */}
        <Pressable style={styles.fab} onPress={handleCreateBudget}>
          <MaterialCommunityIcons
            name={activeTab === "list" ? "wallet-plus-outline" : "target"}
            size={20}
            color="#fff"
          />
          <Text style={styles.fabText}>
            {activeTab === "list" ? "Tạo ngân sách" : "Tạo mục tiêu"}
          </Text>
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

  // Format date range
  const formatDateRange = () => {
    if (!budget) return "";
    const startDate = new Date(budget.start_date * 1000);
    const endDate = budget.end_date ? new Date(budget.end_date * 1000) : null;

    const formatDate = (date: Date) => {
      const day = date.getDate().toString().padStart(2, "0");
      const month = (date.getMonth() + 1).toString().padStart(2, "0");
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    };

    if (endDate) {
      return `Từ ${formatDate(startDate)} đến ${formatDate(endDate)}`;
    }
    return `Từ ${formatDate(startDate)}`;
  };

  const getPeriodLabel = (period: string) => {
    switch (period) {
      case "daily":
        return "Hàng ngày";
      case "weekly":
        return "Hàng tuần";
      case "monthly":
        return "Hàng tháng";
      default:
        return period;
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }} />
      </View>
      <View style={styles.divider} />

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <Pressable
          style={[styles.tab, activeTab === "list" && styles.tabActive]}
          onPress={() => setActiveTab("list")}
        >
          <MaterialCommunityIcons
            name="wallet-outline"
            size={20}
            color={activeTab === "list" ? "#16A34A" : colors.subText}
          />
          <Text
            style={[
              styles.tabText,
              activeTab === "list" && styles.tabTextActive,
            ]}
          >
            Ngân sách
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, activeTab === "goals" && styles.tabActive]}
          onPress={() => setActiveTab("goals")}
        >
          <MaterialCommunityIcons
            name="target"
            size={20}
            color={activeTab === "goals" ? "#16A34A" : colors.subText}
          />
          <Text
            style={[
              styles.tabText,
              activeTab === "goals" && styles.tabTextActive,
            ]}
          >
            Mục tiêu
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {activeTab === "list" ? (
          <>
            {/* Overall Summary Card */}
            <View style={styles.overallSummaryCard}>
              <Text style={styles.overallSummaryTitle}>
                Tổng quan ngân sách
              </Text>
              <View style={styles.overallSummaryRow}>
                <View style={styles.overallSummaryItem}>
                  <Text style={styles.overallSummaryLabel}>Tổng ngân sách</Text>
                  <Text style={styles.overallSummaryValue}>
                    {overallSummary.totalBudget.toLocaleString("vi-VN")}đ
                  </Text>
                </View>
                <View style={styles.overallSummaryItem}>
                  <Text style={styles.overallSummaryLabel}>Đã chi</Text>
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
                  <Text style={styles.overallSummaryLabel}>Còn lại</Text>
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
                        backgroundColor: getWarningColor(
                          overallSummary.percent
                        ),
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
                <Text
                  style={styles.searchInput}
                  onPress={() => {
                    // TODO: Open search modal or navigate to search screen
                  }}
                >
                  {searchQuery || "Tìm kiếm ngân sách..."}
                </Text>
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
                      {p === "all" && "Tất cả"}
                      {p === "daily" && "Ngày"}
                      {p === "weekly" && "Tuần"}
                      {p === "monthly" && "Tháng"}
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
                    Gợi ý thông minh
                  </Text>
                </View>
                <Text style={styles.recommendationText}>
                  {overallSummary.percent >= 90
                    ? "⚠️ Bạn đã chi gần hết ngân sách! Hãy cân nhắc giảm chi tiêu hoặc điều chỉnh kế hoạch."
                    : "📊 Bạn đã chi {overallSummary.percent.toFixed(0)}% ngân sách. Hãy theo dõi chặt chẽ các khoản chi tiêu."}
                </Text>
              </View>
            )}

            {/* All Budgets List */}
            {filteredBudgets.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Danh sách ngân sách</Text>
                <Text style={styles.sectionSubtitle}>
                  Hiển thị {filteredBudgets.length} / {allBudgets.length} kế
                  hoạch
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
                <Text style={styles.emptyTitle}>Không tìm thấy ngân sách</Text>
                <Text style={styles.emptyDesc}>
                  Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm
                </Text>
              </View>
            )}
          </>
        ) : (
          // Goals Tab
          <View style={styles.goalsContainer}>
            <MaterialCommunityIcons
              name="target"
              size={80}
              color={colors.subText}
            />
            <Text style={styles.emptyTitle}>Chức năng đang phát triển</Text>
            <Text style={styles.emptyDesc}>
              Tab Mục tiêu sẽ hiển thị danh sách mục tiêu tài chính của bạn
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Floating Action Button */}
      <Pressable style={styles.fab} onPress={handleCreateBudget}>
        <MaterialCommunityIcons
          name={activeTab === "list" ? "wallet-plus-outline" : "target"}
          size={20}
          color="#fff"
        />
        <Text style={styles.fabText}>
          {activeTab === "list" ? "Tạo ngân sách" : "Tạo mục tiêu"}
        </Text>
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
        return "Hàng ngày";
      case "weekly":
        return "Hàng tuần";
      case "monthly":
        return "Hàng tháng";
      default:
        return period;
    }
  };

  const dateRange = budget.end_date
    ? `Từ ${formatDate(budget.start_date)} đến ${formatDate(budget.end_date)}`
    : `Từ ${formatDate(budget.start_date)}`;

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
          {isActive && (
            <View
              style={{
                backgroundColor: "#DCFCE7",
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderRadius: 10,
              }}
            >
              <Text
                style={{ fontSize: 11, fontWeight: "600", color: "#16A34A" }}
              >
                Đang dùng
              </Text>
            </View>
          )}
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

function CategoryCard({ item, colors }: { item: BudgetItem; colors: any }) {
  const iconName = fixIconName(
    (item.categoryIcon ?? "help-circle-outline").replace(/^mi:/, "mc:")
  ) as any;
  const borderColor = item.exceeded ? "#E84A3C" : colors.divider;
  const barColor = item.exceeded ? "#E84A3C" : "#16A34A";
  const percentRounded = Math.round(item.percent);

  return (
    <View
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: 12,
          padding: 12,
          marginBottom: 8,
          borderWidth: 2,
          borderColor,
        },
      ]}
    >
      <View
        style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: item.categoryColor ?? colors.divider,
            alignItems: "center",
            justifyContent: "center",
            marginRight: 8,
          }}
        >
          <MaterialCommunityIcons name={iconName} size={18} color="#fff" />
        </View>
        <Text
          style={{
            fontSize: 15,
            fontWeight: "600",
            color: colors.text,
            flex: 1,
          }}
        >
          {item.categoryName}
        </Text>
        <Text style={{ fontSize: 13, color: colors.subText }}>
          {item.spent.toLocaleString("vi-VN")} /{" "}
          {item.allocated.toLocaleString("vi-VN")}đ
        </Text>
      </View>

      {/* Progress bar */}
      <View
        style={{
          height: 6,
          backgroundColor: colors.divider,
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            height: 6,
            width: `${Math.min(item.percent, 100)}%`,
            backgroundColor: barColor,
          }}
        />
      </View>

      {item.exceeded && (
        <Text
          style={{
            fontSize: 12,
            color: "#E84A3C",
            marginTop: 4,
          }}
        >
          ⚠️ Vượt quá {percentRounded}% ngân sách
        </Text>
      )}
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
      marginBottom: 12,
      paddingHorizontal: 20,
      justifyContent: "space-between",
    },
    divider: {
      height: 1,
      backgroundColor: c.divider,
      marginHorizontal: 20,
      marginVertical: 8,
    },
    tabContainer: {
      flexDirection: "row",
      paddingHorizontal: 16,
      paddingVertical: 4,
      paddingBottom: 8,
      gap: 8,
      backgroundColor: c.background,
    },
    tab: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
      backgroundColor: c.card,
      borderWidth: 1.5,
      borderColor: c.divider,
    },
    tabActive: {
      backgroundColor: "#DCFCE7",
      borderColor: "#16A34A",
      borderWidth: 1.5,
    },
    tabText: {
      fontSize: 15,
      fontWeight: "500",
      color: c.subText,
    },
    tabTextActive: {
      color: "#16A34A",
      fontWeight: "700",
    },
    title: { fontSize: 24, fontWeight: "700", color: c.text },
    content: { padding: 16, paddingBottom: Math.max(bottomInset, 16) + 80 },
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
    budgetInfoCard: {
      backgroundColor: c.card,
      borderRadius: 16,
      padding: 16,
      marginBottom: 12,
      borderLeftWidth: 4,
      borderLeftColor: "#16A34A",
    },
    budgetInfoTopRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    budgetInfoTitleGroup: {
      flex: 1,
      paddingRight: 8,
    },
    budgetInfoHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    budgetInfoLeft: {
      flex: 1,
    },
    budgetName: {
      fontSize: 18,
      fontWeight: "700",
      color: c.text,
      lineHeight: 24,
    },
    budgetPeriod: {
      fontSize: 13,
      color: c.subText,
      flexDirection: "row",
      alignItems: "center",
    },
    budgetActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    budgetInfoBadge: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "#DCFCE7",
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 10,
      gap: 3,
      alignSelf: "flex-start",
      marginBottom: 12,
    },
    budgetInfoBadgeText: {
      fontSize: 11,
      fontWeight: "600",
      color: "#16A34A",
    },
    budgetInfoDivider: {
      height: 1,
      backgroundColor: c.divider,
      marginBottom: 12,
    },
    budgetDetailsRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    budgetDetailItem: {
      flex: 1,
      alignItems: "center",
      gap: 6,
    },
    budgetDetailDivider: {
      width: 1,
      height: 40,
      backgroundColor: c.divider,
      marginHorizontal: 12,
    },
    budgetDetailLabel: {
      fontSize: 12,
      color: c.subText,
      textAlign: "center",
    },
    budgetDetailValue: {
      fontSize: 13,
      fontWeight: "600",
      color: c.text,
      textAlign: "center",
    },
    budgetDateRange: {
      fontSize: 13,
      color: c.subText,
      flexDirection: "row",
      alignItems: "center",
    },
    actionButton: {
      padding: 6,
      borderRadius: 8,
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
    goalsContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 32,
      minHeight: 400,
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
    createButton: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "#16A34A",
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 24,
      marginTop: 24,
    },
    createButtonText: {
      color: "#fff",
      fontSize: 16,
      fontWeight: "600",
      marginLeft: 8,
    },
    summaryCard: {
      backgroundColor: c.card,
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
    },
    summaryLabel: { fontSize: 14, color: c.subText },
    summaryAmount: {
      fontSize: 28,
      fontWeight: "700",
      color: c.text,
      marginTop: 4,
    },
    summaryRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 8,
    },
    summarySpent: { fontSize: 13, color: c.subText },
    summaryPercent: { fontSize: 13, fontWeight: "600", color: c.text },
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
      bottom: bottomInset + 60,
      paddingHorizontal: 20,
      height: 56,
      borderRadius: 28,
      backgroundColor: "#16A34A",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      elevation: 8,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
    },
    fabText: {
      color: "#fff",
      fontSize: 16,
      fontWeight: "600",
    },
  });
