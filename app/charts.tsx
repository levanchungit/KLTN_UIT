// app/charts.tsx
import { useTheme } from "@/app/providers/ThemeProvider";
import { categoryBreakdown, totalInRange } from "@/repos/transactionRepo";
import {
  Ionicons,
  MaterialCommunityIcons,
  MaterialIcons,
} from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import CalendarPicker from "react-native-calendar-picker";
import { BarChart } from "react-native-gifted-charts";
import { Modal, Portal } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";

type TimeRange = "Ngày" | "Tuần" | "Tháng" | "Năm" | "Khoảng thời gian";

const VI_MONTHS = [
  "Tháng 1",
  "Tháng 2",
  "Tháng 3",
  "Tháng 4",
  "Tháng 5",
  "Tháng 6",
  "Tháng 7",
  "Tháng 8",
  "Tháng 9",
  "Tháng 10",
  "Tháng 11",
  "Tháng 12",
];

const fmtMoney = (n: number) =>
  (n || 0).toLocaleString("vi-VN", { maximumFractionDigits: 0 }) + "₫";

// Format số tiền ngắn gọn cho biểu đồ
const fmtMoneyShort = (n: number) => {
  if (n >= 1000000000) return `${(n / 1000000000).toFixed(1)}tỷ`;
  if (n >= 1000000) return `${Math.round(n / 1000000)}tr`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return n.toString();
};

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

function getRange(kind: TimeRange, anchor: Date) {
  const d = new Date(anchor);
  d.setHours(0, 0, 0, 0);

  if (kind === "Ngày") {
    const start = d.getTime() / 1000;
    return {
      startSec: start,
      endSec: start + 86400,
      label: d.toLocaleDateString("vi-VN"),
    };
  }
  if (kind === "Tuần") {
    const wd = (d.getDay() + 6) % 7;
    const startDate = new Date(d);
    startDate.setDate(d.getDate() - wd);
    const endDateExclusive = new Date(startDate);
    endDateExclusive.setDate(startDate.getDate() + 7);
    const endLabel = new Date(endDateExclusive);
    endLabel.setDate(endLabel.getDate() - 1);
    return {
      startSec: startDate.getTime() / 1000,
      endSec: endDateExclusive.getTime() / 1000,
      label: `${startDate.getDate()} thg ${
        startDate.getMonth() + 1
      } - ${endLabel.getDate()} thg ${endLabel.getMonth() + 1}`,
    };
  }
  if (kind === "Tháng") {
    const startDate = new Date(d.getFullYear(), d.getMonth(), 1);
    const endDate = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return {
      startSec: startDate.getTime() / 1000,
      endSec: endDate.getTime() / 1000,
      label: `Tháng ${d.getMonth() + 1}, ${d.getFullYear()}`,
    };
  }
  if (kind === "Năm") {
    const startDate = new Date(d.getFullYear(), 0, 1);
    const endDate = new Date(d.getFullYear() + 1, 0, 1);
    return {
      startSec: startDate.getTime() / 1000,
      endSec: endDate.getTime() / 1000,
      label: `${d.getFullYear()}`,
    };
  }
  const start = d.getTime() / 1000;
  return {
    startSec: start,
    endSec: start + 86400,
    label: d.toLocaleDateString("vi-VN"),
  };
}

export default function ChartsScreen() {
  const { colors } = useTheme();
  const [timeRange, setTimeRange] = useState<TimeRange>("Tháng");
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [rangeStart, setRangeStart] = useState<Date>(new Date());
  const [rangeEnd, setRangeEnd] = useState<Date>(new Date());
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [tempStart, setTempStart] = useState<Date | null>(null);
  const [tempEnd, setTempEnd] = useState<Date | null>(null);
  const [chartData, setChartData] = useState<
    {
      value: number;
      label: string;
      frontColor: string;
      topLabelComponent?: () => React.ReactElement;
    }[]
  >([]);
  const [totalExpense, setTotalExpense] = useState(0);
  const [loading, setLoading] = useState(false);

  const { startSec, endSec, label } = React.useMemo(() => {
    if (timeRange === "Khoảng thời gian") {
      const start = startOfDay(rangeStart).getTime() / 1000;
      const end = startOfDay(rangeEnd).getTime() / 1000 + 86400;
      return {
        startSec: start,
        endSec: end,
        label: `${rangeStart.getDate()}/${
          rangeStart.getMonth() + 1
        } - ${rangeEnd.getDate()}/${rangeEnd.getMonth() + 1}`,
      };
    }
    return getRange(timeRange, anchor);
  }, [timeRange, anchor, rangeStart, rangeEnd]);

  const loadChartData = useCallback(async () => {
    setLoading(true);
    try {
      // Get total expense
      const total = await totalInRange(startSec, endSec, "expense");
      setTotalExpense(total);

      const rawRows = await categoryBreakdown(startSec, endSec, "expense");
      const rows = Array.isArray(rawRows) ? rawRows : [];

      const palette = [
        "#60a5fa",
        "#34d399",
        "#f59e0b",
        "#ef4444",
        "#a78bfa",
        "#fb7185",
        "#22d3ee",
        "#84cc16",
      ];

      const data = rows
        .filter((r) => (r.total || 0) > 0)
        .slice(0, 10) // Top 10 categories
        .map((r, i) => ({
          value: r.total || 0,
          label: (r.name ?? "Khác").slice(0, 8), // Shorten label
          frontColor: r.color ?? palette[i % palette.length],
          topLabelComponent: () => (
            <Text
              style={{ fontSize: 11, color: colors.text, fontWeight: "700" }}
            >
              {fmtMoneyShort(r.total || 0)}
            </Text>
          ),
        }));

      setChartData(data);
    } catch (error) {
      console.error("Error loading chart data:", error);
    } finally {
      setLoading(false);
    }
  }, [startSec, endSec, colors.text]);

  useEffect(() => {
    loadChartData();
  }, [loadChartData]);

  // Auto-refresh when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadChartData();
    }, [loadChartData])
  );

  const shiftAnchor = (dir: -1 | 1) => {
    const a = new Date(anchor);
    if (timeRange === "Ngày") a.setDate(a.getDate() + dir);
    else if (timeRange === "Tuần") a.setDate(a.getDate() + dir * 7);
    else if (timeRange === "Tháng") a.setMonth(a.getMonth() + dir);
    else if (timeRange === "Năm") a.setFullYear(a.getFullYear() + dir);
    setAnchor(a);
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    backButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.divider,
    },
    headerTitle: {
      fontSize: 20,
      fontWeight: "700",
      color: colors.text,
      flex: 1,
      textAlign: "center",
      marginRight: 40, // Balance the back button
    },
    timeFilterContainer: {
      padding: 16,
    },
    timeFilterScroll: {
      flexDirection: "row",
      gap: 8,
      marginBottom: 16,
    },
    timeFilterBtn: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    timeFilterBtnActive: {
      backgroundColor: "#667eea",
      borderColor: "#667eea",
    },
    timeFilterText: {
      fontSize: 13,
      color: colors.subText,
      fontWeight: "500",
    },
    timeFilterTextActive: {
      color: "#fff",
      fontWeight: "700",
    },
    timeNavigation: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 16,
    },
    navButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.divider,
    },
    periodLabel: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.text,
    },
    chartContainer: {
      backgroundColor: colors.card,
      marginHorizontal: 16,
      padding: 16,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.divider,
      marginBottom: 16,
    },
    chartTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 16,
    },
    emptyState: {
      alignItems: "center",
      paddingVertical: 48,
    },
    emptyText: {
      fontSize: 14,
      color: colors.subText,
      marginTop: 16,
    },
  });

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color={colors.icon} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Biểu đồ so sánh</Text>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {/* Time Range Filter */}
        <View style={styles.timeFilterContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.timeFilterScroll}
          >
            {(
              [
                "Ngày",
                "Tuần",
                "Tháng",
                "Năm",
                "Khoảng thời gian",
              ] as TimeRange[]
            ).map((item) => {
              const isActive = item === timeRange;
              return (
                <TouchableOpacity
                  key={item}
                  onPress={() => {
                    if (item === "Khoảng thời gian") {
                      setShowCalendarModal(true);
                    }
                    setTimeRange(item);
                  }}
                  style={[
                    styles.timeFilterBtn,
                    isActive && styles.timeFilterBtnActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.timeFilterText,
                      isActive && styles.timeFilterTextActive,
                    ]}
                  >
                    {item}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Time Navigation or Custom Range Display */}
          {timeRange === "Khoảng thời gian" ? (
            <TouchableOpacity
              onPress={() => setShowCalendarModal(true)}
              style={styles.timeNavigation}
            >
              <Text style={styles.periodLabel}>{label}</Text>
              <MaterialIcons
                name="calendar-today"
                size={20}
                color={colors.icon}
              />
            </TouchableOpacity>
          ) : (
            <View style={styles.timeNavigation}>
              <TouchableOpacity
                style={styles.navButton}
                onPress={() => shiftAnchor(-1)}
                activeOpacity={0.7}
              >
                <Ionicons name="chevron-back" size={20} color={colors.icon} />
              </TouchableOpacity>

              <Text style={styles.periodLabel}>{label}</Text>

              <TouchableOpacity
                style={styles.navButton}
                onPress={() => shiftAnchor(1)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={colors.icon}
                />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Total Expense Card */}
        <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <View
            style={{
              backgroundColor: "#EF4444",
              padding: 16,
              borderRadius: 12,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <View>
              <Text style={{ color: "#fff", fontSize: 13, opacity: 0.9 }}>
                Tổng chi tiêu
              </Text>
              <Text
                style={{
                  color: "#fff",
                  fontSize: 24,
                  fontWeight: "700",
                  marginTop: 4,
                }}
              >
                {fmtMoney(totalExpense)}
              </Text>
            </View>
            <Ionicons
              name="trending-down"
              size={32}
              color="#fff"
              style={{ opacity: 0.7 }}
            />
          </View>
        </View>

        {/* Chart */}
        <View style={styles.chartContainer}>
          <Text style={styles.chartTitle}>Top danh mục chi tiêu</Text>
          {loading ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Đang tải...</Text>
            </View>
          ) : chartData.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingRight: 20 }}
            >
              <BarChart
                data={chartData}
                barWidth={35}
                spacing={20}
                roundedTop
                roundedBottom
                xAxisThickness={1}
                yAxisThickness={1}
                xAxisColor={colors.divider}
                yAxisColor={colors.divider}
                yAxisTextStyle={{ color: colors.subText, fontSize: 10 }}
                xAxisLabelTextStyle={{
                  color: colors.subText,
                  fontSize: 11,
                  fontWeight: "600",
                }}
                noOfSections={4}
                maxValue={Math.max(...chartData.map((d) => d.value)) * 1.2}
                isAnimated
                animationDuration={800}
                showGradient
                gradientColor="rgba(102, 126, 234, 0.3)"
                frontColor="rgba(102, 126, 234, 0.8)"
                scrollToEnd={false}
                initialSpacing={10}
                endSpacing={10}
              />
            </ScrollView>
          ) : (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons
                name="chart-bar"
                size={64}
                color={colors.divider}
              />
              <Text style={styles.emptyText}>Chưa có dữ liệu</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Calendar Modal for Custom Range */}
      <Portal>
        <Modal
          visible={showCalendarModal}
          onDismiss={() => setShowCalendarModal(false)}
          contentContainerStyle={{
            marginHorizontal: 24,
            borderRadius: 16,
            backgroundColor: colors.card,
            padding: 12,
            alignSelf: "center",
            width: 360,
            maxWidth: "95%",
          }}
        >
          <CalendarPicker
            allowRangeSelection={true}
            selectedStartDate={tempStart ?? undefined}
            selectedEndDate={tempEnd ?? undefined}
            initialDate={tempStart ?? new Date()}
            minDate={new Date(1970, 0, 1)}
            maxDate={new Date()}
            weekdays={["T2", "T3", "T4", "T5", "T6", "T7", "CN"]}
            months={VI_MONTHS}
            previousTitle="‹"
            nextTitle="›"
            todayBackgroundColor="#E6F7FF"
            selectedDayColor="#10B981"
            selectedDayTextColor="#fff"
            selectedRangeStartStyle={{ backgroundColor: "#10B981" }}
            selectedRangeEndStyle={{ backgroundColor: "#10B981" }}
            selectedRangeStyle={{ backgroundColor: "#A7F3D0" }}
            textStyle={{ color: colors.text }}
            onDateChange={(date, type) => {
              if (type === "START_DATE") {
                setTempStart(date);
                if (tempEnd && date > tempEnd) setTempEnd(null);
              } else {
                setTempEnd(date);
              }
            }}
          />

          <View
            style={{
              flexDirection: "row",
              justifyContent: "flex-end",
              marginTop: 8,
            }}
          >
            <TouchableOpacity
              onPress={() => setShowCalendarModal(false)}
              style={{ padding: 10 }}
            >
              <Text style={{ color: "#10B981", fontWeight: "600" }}>Huỷ</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                if (tempStart && tempEnd) {
                  setRangeStart(startOfDay(tempStart));
                  setRangeEnd(startOfDay(tempEnd));
                  setShowCalendarModal(false);
                } else {
                  setShowCalendarModal(false);
                }
              }}
              style={{ padding: 10 }}
            >
              <Text style={{ color: "#10B981", fontWeight: "700" }}>Xong</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      </Portal>
    </SafeAreaView>
  );
}
