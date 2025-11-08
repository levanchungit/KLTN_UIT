import { useTheme } from "@/app/providers/ThemeProvider";
import {
  Budget,
  BudgetAllocation,
  computeBudgetProgress,
} from "@/repos/budgetRepo";
import { Category, listCategories } from "@/repos/categoryRepo";
import { fixIconName } from "@/utils/iconMapper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function BudgetDetailScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams();
  const budgetId = params.id as string;

  const [budget, setBudget] = useState<Budget | null>(null);
  const [allocations, setAllocations] = useState<
    Array<
      BudgetAllocation & {
        spent_amount: number;
        percent: number;
        exceeded: boolean;
      }
    >
  >([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [totalAllocated, setTotalAllocated] = useState(0);
  const [totalSpent, setTotalSpent] = useState(0);

  const loadBudgetDetail = useCallback(async () => {
    try {
      if (!budgetId) return;

      const progressData = await computeBudgetProgress(budgetId);
      setBudget(progressData.budget);
      setAllocations(progressData.allocations);
      setTotalAllocated(progressData.totalAllocated);
      setTotalSpent(progressData.totalSpent);

      const allCategories = await listCategories();
      setCategories(allCategories);
    } catch (error) {
      console.error("Error loading budget detail:", error);
    }
  }, [budgetId]);

  useFocusEffect(
    useCallback(() => {
      loadBudgetDetail();
    }, [loadBudgetDetail])
  );

  const overallPercent = useMemo(() => {
    if (totalAllocated === 0) return 0;
    return Math.round((totalSpent / totalAllocated) * 100);
  }, [totalSpent, totalAllocated]);

  const needs = useMemo(() => {
    return allocations.filter((alloc) => alloc.group_type === "needs");
  }, [allocations]);

  const wants = useMemo(() => {
    return allocations.filter((alloc) => alloc.group_type === "wants");
  }, [allocations]);

  const savings = useMemo(() => {
    return allocations.filter((alloc) => alloc.group_type === "savings");
  }, [allocations]);

  const getCategoryName = (categoryId: string): string => {
    const category = categories.find((c) => c.id === categoryId);
    return category?.name || "Unknown";
  };

  const getCategoryIcon = (categoryId: string): string => {
    const category = categories.find((c) => c.id === categoryId);
    const iconName = category?.icon || "help-circle";
    return fixIconName(iconName.replace(/^mi:/, "mc:"));
  };

  const formatDateRange = (): string => {
    if (!budget) return "";
    const start = new Date(budget.start_date * 1000);
    const end = budget.end_date ? new Date(budget.end_date * 1000) : null;
    if (!end) return `${start.getDate()}/${start.getMonth() + 1}`;
    return `${start.getDate()}/${start.getMonth() + 1} - ${end.getDate()}/${
      end.getMonth() + 1
    }`;
  };

  const getPeriodLabel = (period: string): string => {
    switch (period) {
      case "daily":
        return "Ngày";
      case "weekly":
        return "Tuần";
      case "monthly":
        return "Tháng";
      default:
        return period;
    }
  };

  const handleEdit = () => {
    if (budget) {
      router.push({
        pathname: "/budget/suggest",
        params: {
          budgetId: budget.id,
          budgetName: budget.name,
          period: budget.period,
          startDate: budget.start_date.toString(),
          endDate: budget.end_date?.toString() || "",
        },
      });
    }
  };

  const CategoryCard = ({
    item,
  }: {
    item: BudgetAllocation & {
      spent_amount: number;
      percent: number;
      exceeded: boolean;
    };
  }) => {
    const percent = item.percent;
    const percentRounded = Math.round(percent);
    const progressColor =
      percent > 100 ? "#E84A3C" : percent > 70 ? "#F59E0B" : "#16A34A";

    return (
      <View style={styles.categoryItem}>
        <View
          style={[
            styles.categoryIcon,
            { backgroundColor: colors.card, borderColor: colors.divider },
          ]}
        >
          <MaterialCommunityIcons
            name={getCategoryIcon(item.category_id) as any}
            size={18}
            color={progressColor}
          />
        </View>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <View style={styles.categoryHeader}>
            <Text
              style={[styles.categoryTitle, { color: colors.text }]}
              numberOfLines={1}
            >
              {getCategoryName(item.category_id)}
            </Text>
            <Text style={[styles.categoryAmount, { color: colors.text }]}>
              {item.spent_amount.toLocaleString("vi-VN")}/
              {item.allocated_amount.toLocaleString("vi-VN")}đ
            </Text>
          </View>
          <View style={styles.progressContainer}>
            <View
              style={[
                styles.progressTrack,
                { backgroundColor: colors.divider },
              ]}
            >
              <View
                style={[
                  styles.progressBar,
                  {
                    width: `${Math.min(percent, 100)}%`,
                    backgroundColor: progressColor,
                  },
                ]}
              />
            </View>
            <View
              style={[
                styles.percentPill,
                { backgroundColor: colors.card, borderColor: colors.divider },
              ]}
            >
              <Text style={[styles.percentPillText, { color: colors.text }]}>
                {percentRounded}%
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  };

  if (!budget) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            {
              paddingTop: insets.top,
              backgroundColor: colors.background,
              borderBottomColor: colors.divider,
            },
          ]}
        >
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <MaterialCommunityIcons
              name="arrow-left"
              size={24}
              color={colors.text}
            />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Chi tiết ngân sách
          </Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, { color: colors.subText }]}>
            Đang tải...
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top,
            backgroundColor: colors.background,
            borderBottomColor: colors.divider,
          },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons
            name="arrow-left"
            size={24}
            color={colors.text}
          />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Chi tiết ngân sách
        </Text>
        <Pressable onPress={handleEdit} style={styles.editButton}>
          <MaterialCommunityIcons
            name="pencil-outline"
            size={24}
            color="#16A34A"
          />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 16 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Budget Info Card */}
        <View style={[styles.budgetInfoCard, { backgroundColor: colors.card }]}>
          <View style={styles.budgetInfoTopRow}>
            <View style={styles.budgetInfoTitleGroup}>
              <Text style={[styles.budgetName, { color: colors.text }]}>
                {budget.name}
              </Text>
            </View>
          </View>

          {/* Badge below title */}
          <View style={styles.budgetInfoBadge}>
            <MaterialCommunityIcons
              name="clock-outline"
              size={11}
              color="#16A34A"
            />
            <Text style={styles.budgetInfoBadgeText}>Đang áp dụng</Text>
          </View>

          {/* Divider */}
          <View
            style={[
              styles.budgetInfoDivider,
              { backgroundColor: colors.divider },
            ]}
          />

          {/* Budget details in 2 columns */}
          <View style={styles.budgetDetailsRow}>
            <View style={styles.budgetDetailItem}>
              <MaterialCommunityIcons
                name="calendar"
                size={16}
                color={colors.icon}
              />
              <Text
                style={[styles.budgetDetailLabel, { color: colors.subText }]}
              >
                Chu kỳ
              </Text>
              <Text style={[styles.budgetDetailValue, { color: colors.text }]}>
                {getPeriodLabel(budget.period)}
              </Text>
            </View>
            <View
              style={[
                styles.budgetDetailDivider,
                { backgroundColor: colors.divider },
              ]}
            />
            <View style={styles.budgetDetailItem}>
              <MaterialCommunityIcons
                name="calendar-range"
                size={16}
                color={colors.icon}
              />
              <Text
                style={[styles.budgetDetailLabel, { color: colors.subText }]}
              >
                Thời gian
              </Text>
              <Text style={[styles.budgetDetailValue, { color: colors.text }]}>
                {formatDateRange()}
              </Text>
            </View>
          </View>
        </View>

        {/* Overall summary */}
        <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.summaryLabel, { color: colors.subText }]}>
            Tổng ngân sách
          </Text>
          <Text style={[styles.summaryAmount, { color: colors.text }]}>
            {totalAllocated.toLocaleString("vi-VN")}đ
          </Text>
          <View style={styles.summaryRow}>
            <Text style={[styles.summarySpent, { color: colors.subText }]}>
              Đã chi: {totalSpent.toLocaleString("vi-VN")}đ
            </Text>
            <Text style={[styles.summaryPercent, { color: colors.text }]}>
              {overallPercent}%
            </Text>
          </View>
          <View style={styles.progressContainer}>
            <View
              style={[
                styles.progressTrack,
                { backgroundColor: colors.divider },
              ]}
            >
              <View
                style={[
                  styles.progressBar,
                  {
                    width: `${Math.min(overallPercent, 100)}%`,
                    backgroundColor:
                      overallPercent > 100 ? "#E84A3C" : "#16A34A",
                  },
                ]}
              />
            </View>
            <View
              style={[
                styles.percentPill,
                { backgroundColor: colors.card, borderColor: colors.divider },
              ]}
            >
              <Text style={[styles.percentPillText, { color: colors.text }]}>
                {overallPercent}%
              </Text>
            </View>
          </View>
        </View>

        {/* Needs */}
        {needs.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Nhu cầu (50%)
            </Text>
            {needs.map((item) => (
              <CategoryCard key={item.category_id} item={item} />
            ))}
          </View>
        )}

        {/* Wants */}
        {wants.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Mong muốn (30%)
            </Text>
            {wants.map((item) => (
              <CategoryCard key={item.category_id} item={item} />
            ))}
          </View>
        )}

        {/* Savings */}
        {savings.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Tiết kiệm (20%)
            </Text>
            {savings.map((item) => (
              <CategoryCard key={item.category_id} item={item} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 4,
    width: 40,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
  },
  headerRight: {
    width: 40,
  },
  editButton: {
    padding: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    fontSize: 16,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  budgetInfoCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  budgetInfoTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  budgetInfoTitleGroup: {
    flex: 1,
  },
  budgetName: {
    fontSize: 18,
    fontWeight: "600",
  },
  budgetInfoBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 8,
  },
  budgetInfoBadgeText: {
    fontSize: 11,
    color: "#16A34A",
    fontWeight: "500",
  },
  budgetInfoDivider: {
    height: 1,
    marginVertical: 12,
  },
  budgetDetailsRow: {
    flexDirection: "row",
    gap: 12,
  },
  budgetDetailItem: {
    flex: 1,
    gap: 4,
  },
  budgetDetailDivider: {
    width: 1,
  },
  budgetDetailLabel: {
    fontSize: 12,
  },
  budgetDetailValue: {
    fontSize: 14,
    fontWeight: "500",
  },
  summaryCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  summaryLabel: {
    fontSize: 14,
    marginBottom: 4,
  },
  summaryAmount: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  summarySpent: {
    fontSize: 14,
  },
  summaryPercent: {
    fontSize: 14,
    fontWeight: "600",
  },
  progressContainer: {
    position: "relative",
    height: 20,
    justifyContent: "center",
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    borderRadius: 4,
  },
  percentPill: {
    position: "absolute",
    alignSelf: "center",
    paddingHorizontal: 10,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  percentPillText: {
    fontSize: 11,
    fontWeight: "600",
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
  },
  categoryItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  categoryIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  categoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
    marginRight: 8,
  },
  categoryAmount: {
    fontSize: 14,
    fontWeight: "600",
  },
});
