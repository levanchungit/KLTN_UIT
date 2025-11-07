import { listAccounts } from "@/repos/accountRepo";
import { categoryBreakdown, totalInRange } from "@/repos/transactionRepo";
import {
  Ionicons,
  MaterialCommunityIcons,
  MaterialIcons,
} from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import CalendarPicker from "react-native-calendar-picker";
import { PieChart } from "react-native-gifted-charts";
import { Modal, Portal } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Tab = "Chi phí" | "Thu nhập";
type RangeKind = "Ngày" | "Tuần" | "Tháng" | "Năm" | "Khoảng thời gian";
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

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const fmtMoney = (n: number) =>
  (n || 0).toLocaleString("vi-VN", { maximumFractionDigits: 0 }) + "₫";

function getRange(kind: RangeKind, anchor: Date) {
  const d = new Date(anchor);
  d.setHours(0, 0, 0, 0);

  if (kind === "Ngày") {
    const start = d.getTime() / 1000;
    return {
      startSec: start,
      endSec: start + 86400,
      label: d.toLocaleDateString(),
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
      label: `${startDate.getDate()} thg ${startDate.getMonth() + 1} - ${endLabel.getDate()} thg ${endLabel.getMonth() + 1}`,
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
    label: d.toLocaleDateString(),
  };
}

function isCurrentPeriod(startSec: number, endSec: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t = today.getTime() / 1000;
  return t >= startSec && t < endSec;
}

const ICON_SIZE = 28;

function ExpenseDonutChart({
  data,
}: {
  data: { value: number; color: string; icon?: any; emoji?: string }[];
}) {
  const safe = Array.isArray(data) ? data : [];
  const total = safe.reduce((s, d) => s + (d?.value ?? 0), 0);
  const display = safe.length > 0 ? safe : [{ value: 1, color: "#E5E7EB" }];
  const R = 100,
    INNER = 40,
    SIZE = R * 2 + 10,
    midR = (R + INNER) / 2 + 4;
  const toRad = (deg: number) => (Math.PI / 180) * deg;
  const polarToXY = (deg: number, radius: number) => {
    const a = toRad(deg - 90);
    return { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
  };
  const totalVal = display.reduce((s, d) => s + (d.value || 0), 0) || 1;
  let acc = 0;
  const markers = display.map((s) => {
    const startDeg = (acc / totalVal) * 360;
    const sweepDeg = ((s.value || 0) / totalVal) * 360;
    const midDeg = startDeg + sweepDeg / 2;
    acc += s.value || 0;
    return { ...s, pos: polarToXY(midDeg, midR) };
  });

  return (
    <View style={{ alignItems: "center", marginHorizontal: 16 }}>
      <View
        style={{
          width: SIZE,
          height: SIZE,
          position: "relative",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <PieChart
          data={display.map((d) => ({ value: d.value, color: d.color }))}
          donut
          radius={R}
          innerRadius={INNER}
          strokeWidth={2}
          strokeColor="#fff"
          showText={false}
          isAnimated
          focusOnPress
        />
        {markers.map((m, i) => {
          const size = 28;
          const left = SIZE / 2 + m.pos.x - size / 2;
          const top = SIZE / 2 + m.pos.y - size / 2;
          return (
            <View
              key={i}
              style={{
                position: "absolute",
                left,
                top,
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: "#fff",
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: "rgba(0,0,0,0.06)",
                shadowColor: "#000",
                shadowOpacity: 0.1,
                shadowOffset: { width: 0, height: 1 },
                shadowRadius: 2,
                elevation: 1,
              }}
            >
              {m.icon ? (
                <Image
                  source={m.icon}
                  style={{ width: 18, height: 18 }}
                  resizeMode="contain"
                />
              ) : (
                <Text style={{ fontSize: 16 }}>{m.emoji ?? "💸"}</Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function CategoryRow({
  title,
  amount,
  percent,
  color,
  emoji = "🍔",
}: {
  title: string;
  amount: number;
  percent: string | number;
  color: string;
  emoji?: string;
}) {
  const pctNum =
    typeof percent === "number"
      ? Math.max(0, Math.min(100, percent))
      : Math.max(
          0,
          Math.min(100, parseFloat(String(percent).replace("%", "")) || 0)
        );
  const [barW, setBarW] = React.useState(0);
  const [pillW, setPillW] = React.useState(0);
  const onBarLayout = (e: any) => setBarW(e.nativeEvent.layout.width);
  const pillLeft = React.useMemo(() => {
    if (!barW) return 0;
    const x = (pctNum / 100) * barW;
    const half = pillW / 2;
    return Math.max(half, Math.min(barW - half, x));
  }, [pctNum, barW, pillW]);

  return (
    <View style={styles.catItem}>
      <View style={styles.catIcon}>
        <Text style={{ fontSize: 18 }}>{emoji}</Text>
      </View>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <View style={styles.catHeader}>
          <Text style={styles.catTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.catAmount}>
            {(amount || 0).toLocaleString("vi-VN")}đ
          </Text>
        </View>
        <View style={styles.barContainer} onLayout={onBarLayout}>
          <View style={styles.barTrack} />
          <View
            style={[
              styles.barFill,
              { width: `${pctNum}%`, backgroundColor: "#2ED3D9" },
            ]}
          />
          <View
            style={[styles.pill, { left: pillLeft }]}
            onLayout={(e) => setPillW(e.nativeEvent.layout.width)}
          >
            <Text style={styles.pillText}>{pctNum}%</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<Tab>("Chi phí");
  const [time, setTime] = useState<RangeKind>("Tuần");
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [rangeStart, setRangeStart] = useState<Date>(startOfDay(new Date()));
  const [rangeEnd, setRangeEnd] = useState<Date>(startOfDay(new Date()));
  const [tempStart, setTempStart] = useState<Date | null>(rangeStart);
  const [tempEnd, setTempEnd] = useState<Date | null>(rangeEnd);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [tempAnchor, setTempAnchor] = useState<Date | null>(anchor);
  const [tempYear, setTempYear] = useState<number>(new Date().getFullYear());
  const [tempMonth, setTempMonth] = useState<number>(new Date().getMonth());
  const [tempOnlyYear, setTempOnlyYear] = useState<number>(
    new Date().getFullYear()
  );
  const [cashTotal, setCashTotal] = useState<number>(0);
  const [periodExpense, setPeriodExpense] = useState<number>(0);
  const [periodIncome, setPeriodIncome] = useState<number>(0);
  const netChange = periodIncome - periodExpense;
  const [chartData, setChartData] = useState<
    { value: number; color: string; text?: string }[]
  >([]);
  const [listData, setListData] = useState<
    { category: string; percent: string; amount: number; color: string }[]
  >([]);

  const fmt = (d: Date) => `${d.getDate()} thg ${d.getMonth() + 1}`;
  const { startSec, endSec, label } = useMemo(() => {
    if (time !== "Khoảng thời gian") return getRange(time, anchor);
    const s = startOfDay(rangeStart);
    const e = startOfDay(rangeEnd);
    const eExclusive = new Date(e);
    eExclusive.setDate(eExclusive.getDate() + 1);
    return {
      startSec: s.getTime() / 1000,
      endSec: eExclusive.getTime() / 1000,
      label: `${s.getDate()} thg ${s.getMonth() + 1} - ${e.getDate()} thg ${e.getMonth() + 1}`,
    };
  }, [time, anchor, rangeStart, rangeEnd]);

  const atCurrentPeriod = isCurrentPeriod(startSec, endSec);
  const canGoNext = !atCurrentPeriod;

  const shiftAnchor = (dir: -1 | 1) => {
    if (dir === 1 && !canGoNext) return;
    const a = new Date(anchor);
    if (time === "Ngày" || time === "Khoảng thời gian")
      a.setDate(a.getDate() + dir);
    else if (time === "Tuần") a.setDate(a.getDate() + dir * 7);
    else if (time === "Tháng") a.setMonth(a.getMonth() + dir);
    else if (time === "Năm") a.setFullYear(a.getFullYear() + dir);
    setAnchor(a);
  };
  const goToCurrentPeriod = () => setAnchor(new Date());

  const loadData = useCallback(async () => {
    const accounts = (await listAccounts().catch(() => [])) ?? [];
    const cash = accounts
      .filter((a) => a.include_in_total === 1)
      .reduce((s, a) => s + (a.balance_cached ?? 0), 0);
    setCashTotal(cash);

    const [sumExpense, sumIncome] = await Promise.all([
      totalInRange(startSec, endSec, "expense"),
      totalInRange(startSec, endSec, "income"),
    ]);
    setPeriodExpense(sumExpense);
    setPeriodIncome(sumIncome);

    const type = activeTab === "Chi phí" ? "expense" : "income";
    const rawRows = await categoryBreakdown(startSec, endSec, type);
    const rows = Array.isArray(rawRows) ? rawRows : [];
    const grand = rows.reduce((s, r) => s + ((r.total as number) || 0), 0) || 1;
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

    setChartData(
      rows
        .filter((r) => (r.total || 0) > 0)
        .map((r, i) => ({
          value: r.total || 0,
          color: r.color ?? palette[i % palette.length],
          icon: r.icon ? { uri: r.icon } : undefined,
          emoji:
            !r.icon && /ăn|uống|food|drink/i.test(r.name ?? "")
              ? "🍔"
              : !r.icon && /mua sắm|shopping|quần áo|áo/i.test(r.name ?? "")
                ? "🛍️"
                : "💸",
        }))
    );

    setListData(
      rows
        .filter((r) => (r.total || 0) > 0)
        .map((r, i) => ({
          category: r.name ?? "Khác",
          percent: `${Math.round(((r.total || 0) / grand) * 100)}%`,
          amount: r.total || 0,
          color: r.color ?? palette[i % palette.length],
        }))
    );
  }, [activeTab, startSec, endSec]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // --- Date pickers ---
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

  function DayOrWeekPicker({ mode }: { mode: RangeKind }) {
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
            ? (tempStart ?? undefined)
            : (tempAnchor ?? undefined)
        }
        selectedEndDate={
          mode === "Khoảng thời gian"
            ? (tempEnd ?? undefined)
            : mode === "Tuần" && tempAnchor
              ? addDays(startOfWeekMon(tempAnchor), 6)
              : undefined
        }
        initialDate={
          mode === "Khoảng thời gian"
            ? (tempStart ?? new Date())
            : (tempAnchor ?? new Date())
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
            <MaterialIcons name="keyboard-arrow-left" size={28} />
          </TouchableOpacity>
          <Text style={{ fontSize: 16, fontWeight: "700" }}>
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
              color={canNextMonth ? "#000" : "#AAA"}
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
                  backgroundColor: isSelected ? "#10B981" : "#EEF2F6",
                  opacity: disabled ? 0.5 : 1,
                  borderWidth: isSelected ? 0 : 1,
                  borderColor: "#DCE3EE",
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    color: isSelected ? "#fff" : "#111827",
                    fontWeight: "700",
                    marginBottom: 4,
                  }}
                >
                  Tuần {idx + 1}
                </Text>
                <Text
                  style={{
                    color: isSelected ? "#fff" : "#4B5563",
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
            <Text style={{ fontSize: 18 }}>‹</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 16, fontWeight: "700" }}>{tempYear}</Text>
          <TouchableOpacity
            onPress={() =>
              setTempYear((y) => Math.min(y + 1, new Date().getFullYear()))
            }
          >
            <Text style={{ fontSize: 18 }}>›</Text>
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
                  backgroundColor: isCur ? "#10B981" : "#EEF2F6",
                  alignItems: "center",
                }}
              >
                <Text
                  style={{ color: isCur ? "#fff" : "#111", fontWeight: "600" }}
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
            <MaterialIcons name="keyboard-arrow-left" size={28} />
          </TouchableOpacity>
          <Text style={{ fontSize: 20, fontWeight: "700" }}>
            {tempOnlyYear}
          </Text>
          <TouchableOpacity
            disabled={!canNext}
            onPress={() => setTempOnlyYear((y) => y + 1)}
          >
            <MaterialIcons
              name="keyboard-arrow-right"
              size={28}
              color={canNext ? "#000" : "#AAA"}
            />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.shortcutRow}>
          <Image
            source={require("../../assets/images/logo64x64.png")}
            style={{ width: 40, height: 40 }}
          />
          <TouchableOpacity activeOpacity={0.85} style={styles.shadow}>
            <LinearGradient
              colors={["#2F80ED", "#56CCF2"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.milestoneBtn}
            >
              <Ionicons name="bar-chart-sharp" size={22} color="#fff" />
              <Text style={styles.text}>Phân tích thêm</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity>
            <Ionicons name="notifications-outline" size={24} color="black" />
            <Text
              style={{
                position: "absolute",
                top: -4,
                right: -4,
                backgroundColor: "red",
                color: "white",
                borderRadius: 8,
                paddingHorizontal: 4,
                fontSize: 12,
              }}
            >
              3
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      <ScrollView
        style={{ flex: 1, backgroundColor: "#fff" }}
        contentContainerStyle={{
          paddingBottom: insets.bottom + 80,
          rowGap: 12,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Tài sản / tiền mặt */}
        <View style={styles.assetOverview}>
          <View style={styles.cardsRow}>
            <TouchableOpacity
              style={[styles.cardShadow, styles.assetCard]}
              activeOpacity={0.9}
            >
              <View style={styles.editBtn}>
                <Ionicons name="pencil" size={14} color="#000" />
              </View>
              <Text style={styles.cardTitle}>Tiền mặt</Text>
              <Text style={styles.amount}>{fmtMoney(cashTotal)}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.cardShadow, styles.newWalletCard]}
              activeOpacity={0.85}
            >
              <Text style={styles.plus}>＋</Text>
              <Text style={styles.newWalletText}>Ví mới</Text>
            </TouchableOpacity>
          </View>
        </View>
        {/* Bộ lọc thời gian */}
        <View style={{ marginHorizontal: 16 }}>
          <View
            style={{ flexDirection: "row", justifyContent: "space-evenly" }}
          >
            {(
              [
                "Ngày",
                "Tuần",
                "Tháng",
                "Năm",
                "Khoảng thời gian",
              ] as RangeKind[]
            ).map((item) => {
              const isActive = item === time;
              return (
                <TouchableOpacity
                  key={item}
                  onPress={() => {
                    if (item === "Khoảng thời gian") {
                      const r = getRange(time, anchor);
                      const s = new Date(r.startSec * 1000);
                      const e = new Date(r.endSec * 1000);
                      e.setDate(e.getDate() - 1);
                      setRangeStart(s);
                      setRangeEnd(e);
                    }
                    setTime(item);
                  }}
                  style={{
                    paddingVertical: 4,
                    borderBottomWidth: isActive ? 2 : 0,
                    borderBottomColor: isActive ? "#3B82F6" : "transparent",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      color: isActive ? "#374151" : "#9CA3AF",
                      fontWeight: isActive ? "600" : "400",
                    }}
                  >
                    {item}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {/* Thanh chọn mốc / khoảng */}
          {time === "Khoảng thời gian" ? (
            <View
              style={{
                width: "100%",
                height: ICON_SIZE,
                justifyContent: "center",
                alignItems: "center",
                position: "relative",
              }}
            >
              <TouchableOpacity onPress={() => setPickerVisible(true)}>
                <Text
                  style={{ fontSize: 16, color: "#374151", fontWeight: "600" }}
                >
                  {fmt(rangeStart)} - {fmt(rangeEnd)}
                </Text>
              </TouchableOpacity>
              <View style={{ position: "absolute", right: 0 }}>
                <TouchableOpacity onPress={() => setPickerVisible(true)}>
                  <MaterialIcons
                    name="calendar-today"
                    size={ICON_SIZE - 4}
                    color="#4B5563"
                  />
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View
              style={{
                height: ICON_SIZE,
                justifyContent: "center",
                alignItems: "center",
                position: "relative",
              }}
            >
              <View style={{ position: "absolute", left: 0 }}>
                <TouchableOpacity onPress={() => shiftAnchor(-1)}>
                  <MaterialIcons
                    name="keyboard-arrow-left"
                    size={ICON_SIZE}
                    color="#4B5563"
                  />
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => setPickerVisible(true)}>
                <Text
                  style={{ fontSize: 16, color: "#374151", fontWeight: "600" }}
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
                {!atCurrentPeriod && (
                  <TouchableOpacity
                    onPress={goToCurrentPeriod}
                    style={{ marginRight: 10 }}
                  >
                    <MaterialCommunityIcons
                      name="fast-forward-outline"
                      size={ICON_SIZE - 2}
                      color="#4B5563"
                    />
                  </TouchableOpacity>
                )}
                {canGoNext ? (
                  <TouchableOpacity onPress={() => shiftAnchor(1)}>
                    <MaterialIcons
                      name="keyboard-arrow-right"
                      size={ICON_SIZE}
                      color="#4B5563"
                    />
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          )}
        </View>
        {/* Thay đổi ròng + tổng chi/thu trong kỳ */}
        <LinearGradient
          colors={["#2F80ED", "#56CCF2"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ marginHorizontal: 16, padding: 16, borderRadius: 20 }}
        >
          <View
            style={{ flexDirection: "row", justifyContent: "space-between" }}
          >
            <Text style={{ fontSize: 16, fontWeight: "600", color: "#fff" }}>
              Thay đổi ròng
            </Text>
            <Text style={{ fontWeight: "bold", fontSize: 16, color: "#fff" }}>
              {fmtMoney(netChange)}
            </Text>
          </View>
          <View style={{ flexDirection: "row", marginTop: 8, gap: 8 }}>
            <View style={styles.miniStat}>
              <Text style={{ color: "#e74c3c", fontWeight: "500" }}>
                Chi phí
              </Text>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <Ionicons name="arrow-down" size={16} color="#e74c3c" />
                <Text style={{ color: "#e74c3c", fontWeight: "600" }}>
                  {fmtMoney(periodExpense)}
                </Text>
              </View>
            </View>
            <View style={styles.miniStat}>
              <Text style={{ fontWeight: "500", color: "#27ae60" }}>
                Thu nhập
              </Text>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <Ionicons name="arrow-up" size={16} color="#27ae60" />
                <Text style={{ color: "#27ae60", fontWeight: "600" }}>
                  {fmtMoney(periodIncome)}
                </Text>
              </View>
            </View>
          </View>
        </LinearGradient>
        {/* Tabs Chi phí / Thu nhập */}
        <View
          style={{
            flexDirection: "row",
            justifyContent: "center",
            marginHorizontal: 16,
            gap: 16,
          }}
        >
          {(["Chi phí", "Thu nhập"] as Tab[]).map((item) => {
            const isActive = item === activeTab;
            return (
              <TouchableOpacity
                key={item}
                onPress={() => setActiveTab(item)}
                style={{ width: "30%" }}
              >
                {isActive ? (
                  <LinearGradient
                    colors={["#2F80ED", "#56CCF2"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{
                      borderRadius: 20,
                      alignItems: "center",
                      justifyContent: "center",
                      paddingVertical: 8,
                    }}
                  >
                    <Text
                      style={{ fontSize: 15, fontWeight: "600", color: "#fff" }}
                    >
                      {item}
                    </Text>
                  </LinearGradient>
                ) : (
                  <View
                    style={{
                      borderRadius: 20,
                      alignItems: "center",
                      justifyContent: "center",
                      paddingVertical: 8,
                      backgroundColor: "#E5E7EB",
                    }}
                  >
                    <Text style={{ fontSize: 15, color: "#374151" }}>
                      {item}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
        {/* Biểu đồ donut + danh mục */}
        <ExpenseDonutChart data={chartData} />
        {/* ---------- Danh mục đã xài ---------- */}
        <View style={{ marginHorizontal: 16, marginBottom: 24 }}>
          {listData.map((it, idx) => (
            <CategoryRow
              key={idx}
              title={it.category}
              amount={it.amount}
              percent={it.percent}
              color={it.color}
              emoji={
                /ăn|uống|food|drink/i.test(it.category)
                  ? "🍔"
                  : /mua sắm|shopping|quần áo|áo/i.test(it.category)
                    ? "👕"
                    : /du lịch|travel|vé|bay/i.test(it.category)
                      ? "🛫"
                      : "💸"
              }
            />
          ))}
        </View>
      </ScrollView>
      <Portal>
        <Modal
          visible={pickerVisible}
          onDismiss={() => setPickerVisible(false)}
          contentContainerStyle={{
            marginHorizontal: 24,
            borderRadius: 16,
            backgroundColor: "white",
            padding: 12,
            alignSelf: "center",
            width: 360,
            maxWidth: "95%",
          }}
        >
          {time === "Ngày" && <DayOrWeekPicker mode="Ngày" />}
          {time === "Tuần" && <WeekGridPicker />}
          {time === "Khoảng thời gian" && (
            <DayOrWeekPicker mode="Khoảng thời gian" />
          )}
          {time === "Tháng" && <MonthGridPicker />}
          {time === "Năm" && <YearPicker />}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "flex-end",
              marginTop: 8,
            }}
          >
            <TouchableOpacity
              onPress={() => setPickerVisible(false)}
              style={{ padding: 10 }}
            >
              <Text style={{ color: "#10B981", fontWeight: "600" }}>Huỷ</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                if (time === "Khoảng thời gian") {
                  if (!tempStart || !tempEnd) return setPickerVisible(false);
                  setRangeStart(startOfDay(tempStart));
                  setRangeEnd(startOfDay(tempEnd));
                } else if (time === "Ngày") {
                  if (tempAnchor) setAnchor(startOfDay(tempAnchor));
                } else if (time === "Tuần") {
                  if (tempAnchor) setAnchor(startOfWeekMon(tempAnchor));
                } else if (time === "Tháng") {
                  setAnchor(new Date(tempYear, tempMonth, 1));
                } else if (time === "Năm") {
                  setAnchor(new Date(tempOnlyYear, 0, 1));
                }
                setPickerVisible(false);
              }}
              style={{ padding: 10 }}
            >
              <Text style={{ color: "#10B981", fontWeight: "700" }}>Xong</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16 },
  shortcutRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  shadow: {
    borderRadius: 40,
    shadowColor: "#2F80ED",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  milestoneBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 40,
  },
  text: { color: "#fff", fontSize: 16, fontWeight: "600", letterSpacing: 0.3 },
  assetOverview: {
    paddingHorizontal: 16,
    flexDirection: "column",
    paddingTop: 8,
  },
  cardsRow: { flexDirection: "row", gap: 12 },
  cardShadow: {
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10,
    elevation: 3,
  },
  assetCard: {
    flex: 1,
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: "#2F80ED",
    position: "relative",
  },
  editBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 24,
    height: 24,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  cardTitle: {
    textAlign: "center",
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  amount: {
    textAlign: "center",
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 0.3,
    color: "#000",
  },
  newWalletCard: {
    flex: 1,
    backgroundColor: "#E7ECF1",
    padding: 16,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  plus: { fontSize: 28, lineHeight: 28, color: "#6B7280", marginBottom: 6 },
  newWalletText: { fontSize: 14, color: "#9CA3AF", fontWeight: "600" },
  miniStat: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.8)",
    paddingVertical: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  catItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  catIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#EAF6FF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#D6E6F7",
  },
  catHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  catTitle: { fontSize: 16, color: "#111827", fontWeight: "600" },
  catAmount: { fontSize: 14, color: "#374151", fontWeight: "600" },
  barContainer: {
    height: 14,
    justifyContent: "center",
  },
  barTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: "#ECEFF3",
    width: "100%",
  },
  barFill: {
    position: "absolute",
    left: 0,
    height: 6,
    borderRadius: 999,
  },
  pill: {
    position: "absolute",
    top: -5,
    transform: [{ translateX: -0.5 }],
    paddingHorizontal: 10,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#C7CFDA",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  pillText: { fontSize: 12, color: "#111827", fontWeight: "600" },
});
