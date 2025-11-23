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
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

type TimeRange = "Ngày" | "Tuần" | "Tháng" | "Năm" | "Khoảng thời gian";

const VI_MONTHS = [
  "tháng 1",
  "tháng 2",
  "tháng 3",
  "tháng 4",
  "tháng 5",
  "tháng 6",
  "tháng 7",
  "tháng 8",
  "tháng 9",
  "tháng 10",
  "tháng 11",
  "tháng 12",
];
const VI_WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

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
  const insets = useSafeAreaInsets();
  const [timeRange, setTimeRange] = useState<TimeRange>("Tháng");
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [rangeStart, setRangeStart] = useState<Date>(new Date());
  const [rangeEnd, setRangeEnd] = useState<Date>(new Date());
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [tempStart, setTempStart] = useState<Date | null>(null);
  const [tempEnd, setTempEnd] = useState<Date | null>(null);
  const [tempAnchor, setTempAnchor] = useState<Date | null>(anchor);
  const [tempYear, setTempYear] = useState<number>(new Date().getFullYear());
  const [tempMonth, setTempMonth] = useState<number>(new Date().getMonth());
  const [tempOnlyYear, setTempOnlyYear] = useState<number>(
    new Date().getFullYear()
  );
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

  // Synchronized with dashboard logic for perfect match
  const { startSec, endSec, label } = React.useMemo(() => {
    if (timeRange !== "Khoảng thời gian") return getRange(timeRange, anchor);
    const s = startOfDay(rangeStart);
    const e = startOfDay(rangeEnd);
    const eExclusive = new Date(e);
    eExclusive.setDate(eExclusive.getDate() + 1);
    return {
      startSec: s.getTime() / 1000,
      endSec: eExclusive.getTime() / 1000,
      label: `${s.getDate()} thg ${s.getMonth() + 1} - ${e.getDate()} thg ${
        e.getMonth() + 1
      }`,
    };
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (timeRange === "Ngày") {
      a.setDate(a.getDate() + dir);
      if (dir > 0 && a > today) return; // Không cho chọn tương lai
    } else if (timeRange === "Tuần") {
      a.setDate(a.getDate() + dir * 7);
      if (dir > 0 && a > today) return;
    } else if (timeRange === "Tháng") {
      a.setMonth(a.getMonth() + dir);
      const endOfMonth = new Date(a.getFullYear(), a.getMonth() + 1, 0);
      if (dir > 0 && endOfMonth > today) return;
    } else if (timeRange === "Năm") {
      a.setFullYear(a.getFullYear() + dir);
      if (dir > 0 && a.getFullYear() > today.getFullYear()) return;
    }
    setAnchor(a);
  };

  const addDays = (d: Date, n: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    x.setHours(0, 0, 0, 0);
    return x;
  };

  const startOfWeekMon = (d: Date) => {
    const x = startOfDay(d);
    const wd = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - wd);
    return x;
  };

  const getWeeksOfMonth = (year: number, month: number) => {
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    first.setHours(0, 0, 0, 0);
    last.setHours(0, 0, 0, 0);
    const start = new Date(first);
    const wd = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - wd);
    const end = new Date(last);
    const wd2 = (end.getDay() + 6) % 7;
    end.setDate(end.getDate() + (6 - wd2));
    const out: { start: Date; end: Date; label: string }[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) {
      const s = new Date(d);
      const e = new Date(d);
      e.setDate(e.getDate() + 6);
      const sameMonth = s.getMonth() === month || e.getMonth() === month;
      if (sameMonth) {
        const fmt = (x: Date) => `${x.getDate()} thg ${x.getMonth() + 1}`;
        out.push({ start: s, end: e, label: `${fmt(s)} – ${fmt(e)}` });
      }
    }
    return out;
  };

  function DayOrWeekPicker({ mode }: { mode: TimeRange }) {
    const customDatesStyles =
      mode !== "Tuần" || !tempAnchor
        ? []
        : Array.from({ length: 7 }).map((_, i) => {
            const d = addDays(startOfWeekMon(tempAnchor!), i);
            return {
              date: d,
              style: { backgroundColor: "#C7F9E5" },
              textStyle: { color: "#111" },
            };
          });

    return (
      <CalendarPicker
        allowRangeSelection={mode === "Khoảng thời gian"}
        selectedStartDate={
          mode === "Khoảng thời gian"
            ? tempStart ?? undefined
            : tempAnchor ?? undefined
        }
        selectedEndDate={
          mode === "Khoảng thời gian"
            ? tempEnd ?? undefined
            : mode === "Tuần" && tempAnchor
            ? addDays(startOfWeekMon(tempAnchor), 6)
            : undefined
        }
        initialDate={
          mode === "Khoảng thời gian"
            ? tempStart ?? new Date()
            : tempAnchor ?? new Date()
        }
        minDate={new Date(1970, 0, 1)}
        maxDate={new Date()}
        weekdays={VI_WEEKDAYS}
        months={VI_MONTHS}
        previousTitle="‹"
        nextTitle="›"
        todayBackgroundColor="#E6F7FF"
        selectedDayColor="#10B981"
        selectedDayTextColor="#fff"
        selectedRangeStartStyle={{ backgroundColor: "#10B981" }}
        selectedRangeEndStyle={{ backgroundColor: "#10B981" }}
        selectedRangeStyle={{ backgroundColor: "#A7F3D0" }}
        customDatesStyles={customDatesStyles}
        textStyle={{ color: colors.text }}
        onDateChange={(date: Date, type?: "START_DATE" | "END_DATE") => {
          if (mode === "Khoảng thời gian") {
            if (type === "START_DATE") {
              setTempStart(date);
              if (tempEnd && date > tempEnd) setTempEnd(null);
            } else {
              setTempEnd(date);
            }
          } else {
            setTempAnchor(date);
          }
        }}
      />
    );
  }

  function WeekGridPicker() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const weeks = React.useMemo(
      () => getWeeksOfMonth(tempYear, tempMonth),
      [tempYear, tempMonth]
    );
    const sel = React.useMemo(() => {
      if (!tempAnchor) return null;
      const s = startOfWeekMon(tempAnchor);
      const e = new Date(s);
      e.setDate(e.getDate() + 6);
      return { s, e };
    }, [tempAnchor]);
    const canNextMonth =
      tempYear < now.getFullYear() ||
      (tempYear === now.getFullYear() && tempMonth < now.getMonth());

    return (
      <View style={{ padding: 8 }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <TouchableOpacity
            onPress={() => {
              const m = tempMonth - 1;
              if (m < 0) {
                setTempYear((y) => y - 1);
                setTempMonth(11);
              } else setTempMonth(m);
            }}
          >
            <MaterialIcons
              name="keyboard-arrow-left"
              size={28}
              color={colors.icon}
            />
          </TouchableOpacity>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>
            {VI_MONTHS[tempMonth]} {tempYear}
          </Text>
          <TouchableOpacity
            disabled={!canNextMonth}
            onPress={() => {
              if (!canNextMonth) return;
              const m = tempMonth + 1;
              if (m > 11) {
                setTempYear((y) => y + 1);
                setTempMonth(0);
              } else setTempMonth(m);
            }}
          >
            <MaterialIcons
              name="keyboard-arrow-right"
              size={28}
              color={canNextMonth ? colors.icon : colors.divider}
            />
          </TouchableOpacity>
        </View>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "space-between",
            rowGap: 10,
          }}
        >
          {weeks.map((w, idx) => {
            const isSelected =
              sel && sel.s.getTime() === startOfWeekMon(w.start).getTime();
            const disabled = w.start.getTime() > now.getTime();
            return (
              <TouchableOpacity
                key={idx}
                onPress={() => {
                  if (!disabled) setTempAnchor(new Date(w.start));
                }}
                activeOpacity={0.8}
                style={{
                  width: "48%",
                  paddingVertical: 12,
                  borderRadius: 12,
                  backgroundColor: isSelected ? "#10B981" : colors.card,
                  opacity: disabled ? 0.5 : 1,
                  borderWidth: isSelected ? 0 : 1,
                  borderColor: colors.divider,
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    color: isSelected ? "#fff" : colors.text,
                    fontWeight: "700",
                    marginBottom: 4,
                  }}
                >
                  Tuần {idx + 1}
                </Text>
                <Text
                  style={{
                    color: isSelected ? "#fff" : colors.subText,
                    fontSize: 12,
                    fontWeight: "600",
                  }}
                >
                  {w.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  }

  function MonthGridPicker() {
    const months = VI_MONTHS.map((m, idx) => ({
      label: m.replace("tháng ", "Thg "),
      idx,
    }));
    return (
      <View style={{ padding: 8 }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <TouchableOpacity onPress={() => setTempYear((y) => y - 1)}>
            <Text style={{ fontSize: 18, color: colors.icon }}>‹</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>
            {tempYear}
          </Text>
          <TouchableOpacity
            onPress={() =>
              setTempYear((y) => Math.min(y + 1, new Date().getFullYear()))
            }
          >
            <Text style={{ fontSize: 18, color: colors.icon }}>›</Text>
          </TouchableOpacity>
        </View>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 8,
            justifyContent: "space-between",
          }}
        >
          {months.map(({ label, idx }) => {
            const isCur = tempMonth === idx;
            return (
              <TouchableOpacity
                key={idx}
                onPress={() => setTempMonth(idx)}
                style={{
                  width: "31%",
                  paddingVertical: 12,
                  borderRadius: 10,
                  backgroundColor: isCur ? "#10B981" : colors.card,
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    color: isCur ? "#fff" : colors.text,
                    fontWeight: "600",
                  }}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  }

  function YearPicker() {
    const canNext = tempOnlyYear < new Date().getFullYear();
    return (
      <View style={{ alignItems: "center", paddingVertical: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 24 }}>
          <TouchableOpacity onPress={() => setTempOnlyYear((y) => y - 1)}>
            <MaterialIcons
              name="keyboard-arrow-left"
              size={28}
              color={colors.icon}
            />
          </TouchableOpacity>
          <Text style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>
            {tempOnlyYear}
          </Text>
          <TouchableOpacity
            disabled={!canNext}
            onPress={() => setTempOnlyYear((y) => y + 1)}
          >
            <MaterialIcons
              name="keyboard-arrow-right"
              size={28}
              color={canNext ? colors.icon : colors.divider}
            />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

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
      marginHorizontal: 16,
      marginVertical: 4,
      marginBottom: 20, // tăng khoảng cách với phần dưới
    },
    timeFilterScroll: {
      flexDirection: "row",
      gap: 8,
      paddingVertical: 4,
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
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.divider,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 4,
      elevation: 1,
    },
    periodLabel: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.text,
      textAlign: "center",
      letterSpacing: 0.2,
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
                      const r = getRange(timeRange, anchor);
                      const s = new Date(r.startSec * 1000);
                      const e = new Date(r.endSec * 1000);
                      e.setDate(e.getDate() - 1);
                      setRangeStart(s);
                      setRangeEnd(e);
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

          {/* Time Navigation or Custom Range Display - match dashboard */}
          {timeRange === "Khoảng thời gian" ? (
            <View
              style={{
                width: "100%",
                height: 28,
                justifyContent: "center",
                alignItems: "center",
                position: "relative",
              }}
            >
              <TouchableOpacity onPress={() => setShowCalendarModal(true)}>
                <Text
                  style={{
                    fontSize: 16,
                    color: colors.text,
                    fontWeight: "600",
                  }}
                >
                  {`${rangeStart.getDate()} thg ${
                    rangeStart.getMonth() + 1
                  } - ${rangeEnd.getDate()} thg ${rangeEnd.getMonth() + 1}`}
                </Text>
              </TouchableOpacity>
              <View style={{ position: "absolute", right: 0 }}>
                <TouchableOpacity onPress={() => setShowCalendarModal(true)}>
                  <MaterialIcons
                    name="calendar-today"
                    size={24}
                    color={colors.icon}
                  />
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View
              style={{
                height: 28,
                justifyContent: "center",
                alignItems: "center",
                position: "relative",
              }}
            >
              <View style={{ position: "absolute", left: 0 }}>
                <TouchableOpacity onPress={() => shiftAnchor(-1)}>
                  <MaterialIcons
                    name="keyboard-arrow-left"
                    size={28}
                    color={colors.icon}
                  />
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => setShowCalendarModal(true)}>
                <Text
                  style={{
                    fontSize: 16,
                    color: colors.text,
                    fontWeight: "600",
                  }}
                >
                  {label}
                </Text>
              </TouchableOpacity>
              <View
                style={{
                  position: "absolute",
                  right: 0,
                  flexDirection: "row",
                  alignItems: "center",
                }}
              >
                {/* Fast forward to current period */}
                {/* Logic giống dashboard, nhưng nếu muốn thêm thì mở comment dưới */}
                {/*
                {!atCurrentPeriod && (
                  <TouchableOpacity
                    onPress={goToCurrentPeriod}
                    style={{ marginRight: 10 }}
                  >
                    <MaterialCommunityIcons
                      name="fast-forward-outline"
                      size={26}
                      color={colors.icon}
                    />
                  </TouchableOpacity>
                )}
                */}
                {/* Next button */}
                {(() => {
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  let canNext = false;
                  if (timeRange === "Ngày") {
                    const nextDay = new Date(anchor);
                    nextDay.setDate(nextDay.getDate() + 1);
                    canNext = nextDay <= today;
                  } else if (timeRange === "Tuần") {
                    const nextWeek = new Date(anchor);
                    nextWeek.setDate(nextWeek.getDate() + 7);
                    canNext = nextWeek <= today;
                  } else if (timeRange === "Tháng") {
                    const nextMonth = new Date(anchor);
                    nextMonth.setMonth(nextMonth.getMonth() + 1);
                    const endOfNextMonth = new Date(
                      nextMonth.getFullYear(),
                      nextMonth.getMonth() + 1,
                      0
                    );
                    canNext = endOfNextMonth <= today;
                  } else if (timeRange === "Năm") {
                    const nextYear = new Date(anchor);
                    nextYear.setFullYear(nextYear.getFullYear() + 1);
                    canNext = nextYear.getFullYear() <= today.getFullYear();
                  }
                  return canNext ? (
                    <TouchableOpacity onPress={() => shiftAnchor(1)}>
                      <MaterialIcons
                        name="keyboard-arrow-right"
                        size={28}
                        color={colors.icon}
                      />
                    </TouchableOpacity>
                  ) : null;
                })()}
              </View>
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

      {/* Calendar Modal */}
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
          {timeRange === "Ngày" && <DayOrWeekPicker mode="Ngày" />}
          {timeRange === "Tuần" && <WeekGridPicker />}
          {timeRange === "Khoảng thời gian" && (
            <DayOrWeekPicker mode="Khoảng thời gian" />
          )}
          {timeRange === "Tháng" && <MonthGridPicker />}
          {timeRange === "Năm" && <YearPicker />}

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
                if (timeRange === "Khoảng thời gian") {
                  if (!tempStart || !tempEnd)
                    return setShowCalendarModal(false);
                  setRangeStart(startOfDay(tempStart));
                  setRangeEnd(startOfDay(tempEnd));
                } else if (timeRange === "Ngày") {
                  if (tempAnchor) setAnchor(startOfDay(tempAnchor));
                } else if (timeRange === "Tuần") {
                  if (tempAnchor) setAnchor(startOfWeekMon(tempAnchor));
                } else if (timeRange === "Tháng") {
                  setAnchor(new Date(tempYear, tempMonth, 1));
                } else if (timeRange === "Năm") {
                  setAnchor(new Date(tempOnlyYear, 0, 1));
                }
                setShowCalendarModal(false);
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
