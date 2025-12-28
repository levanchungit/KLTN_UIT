import { useTheme } from "@/app/providers/ThemeProvider";
import { useUser } from "@/context/userContext";
import { useI18n } from "@/i18n/I18nProvider";
import { listAccounts } from "@/repos/accountRepo";
import {
  categoryBreakdown,
  totalAssetsFromTransactions,
  totalInRange,
} from "@/repos/transactionRepo";
import {
  getUnreadCount,
  subscribeToNotifications,
} from "@/services/notificationService";
import {
  Ionicons,
  MaterialCommunityIcons,
  MaterialIcons,
} from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { SafeAreaView } from "react-native-safe-area-context";

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
  colors,
}: {
  data: {
    value: number;
    color: string;
    iconName?: string;
    categoryName?: string;
  }[];
  colors: any;
}) {
  const safe = Array.isArray(data) ? data : [];
  const total = safe.reduce((s, d) => s + (d?.value ?? 0), 0);
  const display = safe.length > 0 ? safe : [{ value: 1, color: "#E5E7EB" }];
  const R = 100,
    INNER = 40,
    SIZE = R * 2 + 10,
    iconRadius = R;
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
    return { ...s, pos: polarToXY(midDeg, iconRadius) };
  });

  return (
    <View style={{ alignItems: "center", marginHorizontal: 16 }}>
      <View
        style={{
          width: SIZE + 60, // expand container to accommodate outer icons
          height: SIZE + 60,
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
          strokeColor={colors.card}
          showText={false}
          isAnimated
          focusOnPress
        />
        {markers.map((m, i) => {
          const size = 28;
          const left = (SIZE + 60) / 2 + m.pos.x - size / 2;
          const top = (SIZE + 60) / 2 + m.pos.y - size / 2;
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
                backgroundColor: colors.card,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: colors.divider,
                shadowColor: "#000",
                shadowOpacity: 0.1,
                shadowOffset: { width: 0, height: 1 },
                shadowRadius: 2,
                elevation: 1,
              }}
            >
              {(() => {
                if (!m.iconName) {
                  return (
                    <MaterialCommunityIcons
                      name="cash"
                      size={18}
                      color={m.color}
                    />
                  );
                }

                // Handle "mc:" prefix for MaterialCommunityIcons
                if (m.iconName.startsWith("mc:")) {
                  const iconName = m.iconName.replace("mc:", "");
                  return (
                    <MaterialCommunityIcons
                      name={iconName as any}
                      size={18}
                      color={m.color}
                    />
                  );
                }

                // Handle "mi:" prefix - map to MaterialCommunityIcons equivalents
                if (m.iconName.startsWith("mi:")) {
                  const iconMap: Record<string, string> = {
                    "directions-car": "car",
                    "flight-takeoff": "airplane-takeoff",
                    assignment: "file-document-outline",
                    pets: "paw",
                    "credit-card": "credit-card-outline",
                  };
                  const miName = m.iconName.replace("mi:", "");
                  const mcName = iconMap[miName] || "help-circle-outline";
                  return (
                    <MaterialCommunityIcons
                      name={mcName as any}
                      size={18}
                      color={m.color}
                    />
                  );
                }

                // No prefix - assume MaterialCommunityIcons
                return (
                  <MaterialCommunityIcons
                    name={m.iconName as any}
                    size={18}
                    color={m.color}
                  />
                );
              })()}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function CategoryRow({
  categoryId,
  title,
  amount,
  percent,
  color,
  iconName,
  colors,
  onPress,
}: {
  categoryId: string | null;
  title: string;
  amount: number;
  percent: string | number;
  color: string;
  iconName?: string;
  colors: any;
  onPress?: () => void;
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
  const TRACK_H = 6; // must match barTrack.height
  const PILL_H = 24; // must match pill.height
  const topOffset = -((PILL_H - TRACK_H) / 2); // vertical centering relative to track
  const pillLeft = React.useMemo(() => {
    if (!barW) return 0;
    // Center the pill in the middle of the bar (independent of percentage)
    return Math.max(0, (barW - pillW) / 2);
  }, [barW, pillW]);

  const localStyles = StyleSheet.create({
    catItem: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 10,
    },
    catIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.divider,
    },
    catHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 6,
    },
    catTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
    catAmount: { fontSize: 14, fontWeight: "600", color: colors.text },
    barContainer: {
      height: 14,
      justifyContent: "center",
    },
    barTrack: {
      height: 6,
      borderRadius: 999,
      backgroundColor: colors.divider,
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
      paddingHorizontal: 10,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.divider,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 1,
    },
    pillText: { fontSize: 12, fontWeight: "600", color: colors.text },
  });

  return (
    <TouchableOpacity
      style={localStyles.catItem}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={!onPress}
    >
      <View style={localStyles.catIcon}>
        {(() => {
          if (!iconName) {
            return (
              <MaterialCommunityIcons name="cash" size={18} color={color} />
            );
          }

          // Handle "mc:" prefix for MaterialCommunityIcons
          if (iconName.startsWith("mc:")) {
            const icon = iconName.replace("mc:", "");
            return (
              <MaterialCommunityIcons
                name={icon as any}
                size={18}
                color={color}
              />
            );
          }

          // Handle "mi:" prefix - map to MaterialCommunityIcons equivalents
          if (iconName.startsWith("mi:")) {
            const iconMap: Record<string, string> = {
              "directions-car": "car",
              "flight-takeoff": "airplane-takeoff",
              assignment: "file-document-outline",
              pets: "paw",
              "credit-card": "credit-card-outline",
            };
            const miName = iconName.replace("mi:", "");
            const mcName = iconMap[miName] || "help-circle-outline";
            return (
              <MaterialCommunityIcons
                name={mcName as any}
                size={18}
                color={color}
              />
            );
          }

          // No prefix - assume MaterialCommunityIcons
          return (
            <MaterialCommunityIcons
              name={iconName as any}
              size={18}
              color={color}
            />
          );
        })()}
      </View>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <View style={localStyles.catHeader}>
          <Text style={localStyles.catTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={localStyles.catAmount}>
            {(amount || 0).toLocaleString("vi-VN")}đ
          </Text>
        </View>
        <View style={localStyles.barContainer} onLayout={onBarLayout}>
          <View style={localStyles.barTrack} />
          <View
            style={[
              localStyles.barFill,
              { width: `${pctNum}%`, backgroundColor: "#2ED3D9" },
            ]}
          />
          <View
            style={[localStyles.pill, { left: pillLeft, top: topOffset }]}
            onLayout={(e) => setPillW(e.nativeEvent.layout.width)}
          >
            <Text style={localStyles.pillText}>{pctNum}%</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function DashboardScreen() {
  const { colors, mode } = useTheme();
  const { user } = useUser();
  const { t } = useI18n();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);

  // Helper function to translate time range labels for UI display
  const translateTimeRange = (range: RangeKind): string => {
    const map: Record<RangeKind, string> = {
      Ngày: t("day"),
      Tuần: t("week"),
      Tháng: t("month"),
      Năm: t("year"),
      "Khoảng thời gian": t("dateRange"),
    };
    return map[range] || range;
  };

  // Helper function to translate tab labels for UI display
  const translateTab = (tab: Tab): string => {
    return tab === "Chi phí" ? t("expense") : t("income");
  };

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
    {
      categoryId: string | null;
      category: string;
      percent: string;
      amount: number;
      color: string;
      iconName?: string;
    }[]
  >([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [syncStatus, setSyncStatus] = useState<string>("idle");
  const prevSyncRef = React.useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        const ss = await import("@/services/syncState");
        unsub = ss.subscribe((s: any) => {
          if (!mounted) return;
          setSyncStatus(s.status ?? "idle");
        });
      } catch (e) {
        // ignore
      }
    })();
    return () => {
      mounted = false;
      if (unsub) unsub();
    };
  }, []);

  // Request notification permission on dashboard mount and install listener if granted
  useEffect(() => {
    let unsubNotif: (() => void) | undefined;
    let mounted = true;
    (async () => {
      try {
        const notif = await import("@/services/notificationService");
        const granted = await notif.requestNotificationPermissions();
        if (!mounted) return;
        if (granted) {
          try {
            unsubNotif = notif.setupNotificationListener();
          } catch (e) {
            console.warn("Failed to setup notification listener:", e);
          }
        }
      } catch (e) {
        console.warn("Notification permission check failed:", e);
      }
    })();

    return () => {
      mounted = false;
      try {
        if (unsubNotif) unsubNotif();
      } catch {}
    };
  }, []);

  // When a background sync finishes (syncStatus transitions away from 'syncing'),
  // refresh dashboard data so totals and lists reflect server state.
  useEffect(() => {
    const prev = prevSyncRef.current;
    if (prev === "syncing" && syncStatus !== "syncing") {
      // Sync just finished — refresh data. Do not await here to avoid blocking UI.
      loadData().catch((e) => console.warn("Failed to refresh after sync:", e));
    }
    prevSyncRef.current = syncStatus;
  }, [syncStatus, loadData]);

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
      label: `${s.getDate()} thg ${s.getMonth() + 1} - ${e.getDate()} thg ${
        e.getMonth() + 1
      }`,
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
    // Prefer authoritative total derived from transactions
    let cash = 0;
    try {
      cash = await totalAssetsFromTransactions();
    } catch (e) {
      // Fallback to cached account balances if computation fails
      const accounts = (await listAccounts().catch(() => [])) ?? [];
      cash = accounts
        .filter((a) => Number(a.include_in_total) === 1)
        .reduce((s, a) => s + (Number(a.balance_cached) || 0), 0);
    }
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
          iconName: r.icon || "cash", // Store icon name from database
          categoryName: r.name ?? "Khác",
        }))
    );

    setListData(
      rows
        .filter((r) => (r.total || 0) > 0)
        .map((r, i) => ({
          categoryId: r.category_id,
          category: r.name ?? "Khác",
          percent: `${Math.round(((r.total || 0) / grand) * 100)}%`,
          amount: r.total || 0,
          color: r.color ?? palette[i % palette.length],
          iconName: r.icon || "cash",
        }))
    );
  }, [activeTab, startSec, endSec]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-refresh when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadData();
      (async () => {
        try {
          const c = await getUnreadCount();
          setUnreadCount(c);
        } catch {}
      })();
      const unsub = subscribeToNotifications(async () => {
        try {
          const c = await getUnreadCount();
          setUnreadCount(c);
        } catch {}
      });
      return () => unsub();
    }, [loadData])
  );

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

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top", "bottom"]}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.shortcutRow}>
          <View style={styles.logoContainer}>
            <Image
              source={require("../../assets/images/logo64x64_black.png")}
              style={styles.logo}
            />
            <View>
              <Text style={styles.greeting}>Xin chào 👋</Text>
              <Text
                style={styles.username}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {(() => {
                  const displayName = user
                    ? user.name ?? user.username
                    : "Người dùng (demo)";
                  return displayName.length > 12
                    ? displayName.substring(0, 12) + "..."
                    : displayName;
                })()}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <TouchableOpacity
              style={[
                styles.iconButton,
                { backgroundColor: "#F59E0B", borderColor: "transparent" },
              ]}
              activeOpacity={0.85}
              onPress={async () => {
                try {
                  const trig = await import("@/services/syncTrigger");
                  if (trig && typeof trig.triggerImmediate === "function") {
                    trig
                      .triggerImmediate(user?.id)
                      .catch((e: any) =>
                        console.warn("Manual sync failed:", e)
                      );
                  }
                } catch (e) {
                  console.warn("Failed to trigger sync:", e);
                }
              }}
            >
              {syncStatus === "syncing" ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <MaterialIcons name="sync" size={20} color="#ffffff" />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.85}
              style={[
                styles.iconButton,
                { backgroundColor: "#3B82F6", borderColor: "transparent" },
              ]}
              onPress={() => router.push("/charts")}
            >
              <Ionicons name="bar-chart" size={22} color="#ffffff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.iconButton,
                { backgroundColor: "#EF4444", borderColor: "transparent" },
              ]}
              onPress={() => router.push("/notifications")}
            >
              <Ionicons
                name="notifications-outline"
                size={22}
                color="#ffffff"
              />
              {unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{
          paddingBottom: 80,
          rowGap: 12,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Tài sản / tiền mặt */}
        <View style={styles.assetOverview}>
          <TouchableOpacity
            style={[styles.cardShadow, styles.balanceCard]}
            activeOpacity={0.95}
          >
            <LinearGradient
              colors={["#667eea", "#764ba2"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.balanceGradient}
            >
              <View style={styles.balanceContent}>
                <View style={styles.balanceInfo}>
                  <Text style={styles.balanceLabel}>{t("totalAssets")}</Text>
                  <Text style={styles.balanceAmount}>
                    {fmtMoney(cashTotal)}
                  </Text>
                  <View style={styles.netChangeRow}>
                    <Ionicons
                      name={netChange >= 0 ? "trending-up" : "trending-down"}
                      size={16}
                      color={netChange >= 0 ? "#4ade80" : "#f87171"}
                    />
                    <Text
                      style={[
                        styles.netChangeText,
                        { color: netChange >= 0 ? "#4ade80" : "#f87171" },
                      ]}
                    >
                      {netChange >= 0 ? "+" : ""}
                      {fmtMoney(netChange)}
                    </Text>
                    <Text style={styles.netChangePeriod}> {t("inPeriod")}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.walletIconButton}
                  onPress={() => router.push("/setting/wallets")}
                >
                  <Ionicons name="wallet-outline" size={28} color="#fff" />
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </TouchableOpacity>
        </View>
        {/* Bộ lọc thời gian */}
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
                    {translateTimeRange(item)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
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
                  style={{
                    fontSize: 16,
                    color: colors.text,
                    fontWeight: "600",
                  }}
                >
                  {fmt(rangeStart)} - {fmt(rangeEnd)}
                </Text>
              </TouchableOpacity>
              <View style={{ position: "absolute", right: 0 }}>
                <TouchableOpacity onPress={() => setPickerVisible(true)}>
                  <MaterialIcons
                    name="calendar-today"
                    size={ICON_SIZE - 4}
                    color={colors.icon}
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
                    color={colors.icon}
                  />
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => setPickerVisible(true)}>
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
                {!atCurrentPeriod && (
                  <TouchableOpacity
                    onPress={goToCurrentPeriod}
                    style={{ marginRight: 10 }}
                  >
                    <MaterialCommunityIcons
                      name="fast-forward-outline"
                      size={ICON_SIZE - 2}
                      color={colors.icon}
                    />
                  </TouchableOpacity>
                )}
                {canGoNext ? (
                  <TouchableOpacity onPress={() => shiftAnchor(1)}>
                    <MaterialIcons
                      name="keyboard-arrow-right"
                      size={ICON_SIZE}
                      color={colors.icon}
                    />
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          )}
        </View>
        {/* Thay đổi ròng + tổng chi/thu trong kỳ */}
        <View style={styles.statsContainer}>
          <TouchableOpacity
            style={[styles.statCard, styles.cardShadow]}
            activeOpacity={0.9}
          >
            <View style={styles.statIconWrapper}>
              <Ionicons name="arrow-down" size={20} color="#EF4444" />
            </View>
            <View style={styles.statContent}>
              <Text style={styles.statLabel}>{t("expense")}</Text>
              <Text
                style={[styles.statValue, { color: "#EF4444" }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {fmtMoney(periodExpense)}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.statCard, styles.cardShadow]}
            activeOpacity={0.9}
          >
            <View
              style={[styles.statIconWrapper, { backgroundColor: "#DCFCE7" }]}
            >
              <Ionicons name="arrow-up" size={20} color="#10B981" />
            </View>
            <View style={styles.statContent}>
              <Text style={styles.statLabel}>{t("income")}</Text>
              <Text
                style={[styles.statValue, { color: "#10B981" }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {fmtMoney(periodIncome)}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
        {/* Tabs Chi phí / Thu nhập */}
        <View style={styles.tabsContainer}>
          <Text style={styles.sectionTitle}>{t("transactionDetail")}</Text>
          <View style={styles.tabsWrapper}>
            {(["Chi phí", "Thu nhập"] as Tab[]).map((item) => {
              const isActive = item === activeTab;
              return (
                <TouchableOpacity
                  key={item}
                  onPress={() => setActiveTab(item)}
                  style={[styles.tabButton, isActive && styles.tabButtonActive]}
                >
                  <Text
                    style={[
                      styles.tabButtonText,
                      isActive && styles.tabButtonTextActive,
                    ]}
                  >
                    {translateTab(item)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
        {/* Biểu đồ donut + danh mục */}
        {listData.length > 0 ? (
          <>
            <ExpenseDonutChart data={chartData} colors={colors} />
            {/* ---------- Danh mục đã xài ---------- */}
            <View
              style={{ marginHorizontal: 16, marginTop: -20, marginBottom: 24 }}
            >
              {listData.map((it, idx) => (
                <CategoryRow
                  key={idx}
                  categoryId={it.categoryId}
                  title={it.category}
                  amount={it.amount}
                  percent={it.percent}
                  color={it.color}
                  colors={colors}
                  iconName={it.iconName}
                  onPress={() => {
                    if (it.categoryId) {
                      router.push({
                        pathname: "/category-detail",
                        params: {
                          categoryId: it.categoryId,
                          categoryName: it.category,
                          categoryIcon: it.iconName,
                          categoryColor: it.color,
                        },
                      });
                    }
                  }}
                />
              ))}
            </View>
          </>
        ) : (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconContainer}>
              <Ionicons
                name={
                  activeTab === "Chi phí" ? "wallet-outline" : "cash-outline"
                }
                size={64}
                color={colors.divider}
              />
            </View>
            <Text style={styles.emptyTitle}>
              Chưa có {activeTab.toLowerCase()} nào
            </Text>
            <Text style={styles.emptyDescription}>
              {activeTab === "Chi phí"
                ? "Bắt đầu ghi lại chi tiêu của bạn để theo dõi tài chính tốt hơn"
                : "Thêm các khoản thu nhập để quản lý ngân sách hiệu quả"}
            </Text>
            <TouchableOpacity style={styles.emptyButton} activeOpacity={0.8}>
              <Ionicons name="add-circle" size={20} color="#fff" />
              <Text style={styles.emptyButtonText}>
                Thêm {activeTab.toLowerCase()}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
      <Portal>
        <Modal
          visible={pickerVisible}
          onDismiss={() => setPickerVisible(false)}
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
    </SafeAreaView>
  );
}

const makeStyles = (c: {
  background: string;
  card: string;
  text: string;
  subText: string;
  divider: string;
  icon: string;
}) =>
  StyleSheet.create({
    header: {
      paddingHorizontal: 16,
      paddingBottom: 8,
      backgroundColor: c.background,
    },

    shortcutRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    logoContainer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    logo: {
      width: 48,
      height: 48,
      borderRadius: 24,
    },
    greeting: {
      fontSize: 13,
      color: c.subText,
      fontWeight: "500",
    },
    username: {
      fontSize: 17,
      color: c.text,
      fontWeight: "700",
      maxWidth: 220,
      flex: 1,
      flexShrink: 1,
    },
    iconButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.card,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: c.divider,
      position: "relative",
    },
    badge: {
      position: "absolute",
      top: -2,
      right: -2,
      backgroundColor: "#EF4444",
      borderRadius: 10,
      minWidth: 18,
      height: 18,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 4,
    },
    badgeText: {
      color: "#fff",
      fontSize: 11,
      fontWeight: "700",
    },
    assetOverview: {
      paddingHorizontal: 16,
      marginTop: 4,
    },
    cardShadow: {
      shadowColor: "#000",
      shadowOpacity: 0.1,
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 12,
      elevation: 5,
    },
    balanceCard: {
      borderRadius: 24,
      overflow: "hidden",
    },
    balanceGradient: {
      padding: 24,
      borderRadius: 24,
    },
    balanceContent: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    balanceInfo: {
      flex: 1,
    },
    balanceLabel: {
      fontSize: 13,
      color: "rgba(255,255,255,0.75)",
      fontWeight: "500",
      marginBottom: 8,
    },
    balanceAmount: {
      fontSize: 32,
      color: "#fff",
      fontWeight: "800",
      letterSpacing: -0.5,
      marginBottom: 8,
    },
    netChangeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    netChangeText: {
      fontSize: 15,
      fontWeight: "700",
    },
    netChangePeriod: {
      fontSize: 13,
      color: "rgba(255,255,255,0.7)",
      fontWeight: "500",
    },
    walletIconButton: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: "rgba(255,255,255,0.15)",
      alignItems: "center",
      justifyContent: "center",
    },
    timeFilterContainer: {
      marginHorizontal: 16,
      marginVertical: 4,
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
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.divider,
    },
    timeFilterBtnActive: {
      backgroundColor: "#667eea",
      borderColor: "#667eea",
    },
    timeFilterText: {
      fontSize: 13,
      color: c.subText,
      fontWeight: "500",
    },
    timeFilterTextActive: {
      color: "#fff",
      fontWeight: "700",
    },
    statsContainer: {
      flexDirection: "row",
      marginHorizontal: 16,
      gap: 12,
    },
    statCard: {
      flex: 1,
      backgroundColor: c.card,
      padding: 14,
      borderRadius: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderWidth: 1,
      borderColor: c.divider,
      minWidth: 0,
    },
    statIconWrapper: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: "#FEE2E2",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    statContent: {
      flex: 1,
      minWidth: 0,
    },
    statLabel: {
      fontSize: 12,
      color: c.subText,
      fontWeight: "500",
      marginBottom: 4,
    },
    statValue: {
      fontSize: 14,
      fontWeight: "700",
    },
    tabsContainer: {
      marginHorizontal: 16,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: c.text,
      marginBottom: 12,
    },
    tabsWrapper: {
      flexDirection: "row",
      backgroundColor: c.card,
      padding: 4,
      borderRadius: 16,
      gap: 4,
    },
    tabButton: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 12,
      alignItems: "center",
    },
    tabButtonActive: {
      backgroundColor: "#667eea",
    },
    tabButtonText: {
      fontSize: 14,
      color: c.subText,
      fontWeight: "600",
    },
    tabButtonTextActive: {
      color: "#fff",
      fontWeight: "700",
    },
    emptyState: {
      marginHorizontal: 16,
      marginVertical: 32,
      alignItems: "center",
      paddingVertical: 48,
    },
    emptyIconContainer: {
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: c.card,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 24,
      borderWidth: 1,
      borderColor: c.divider,
    },
    emptyTitle: {
      fontSize: 20,
      fontWeight: "700",
      color: c.text,
      marginBottom: 12,
    },
    emptyDescription: {
      fontSize: 14,
      color: c.subText,
      textAlign: "center",
      lineHeight: 20,
      marginBottom: 24,
      paddingHorizontal: 32,
    },
    emptyButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: "#667eea",
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 24,
    },
    emptyButtonText: {
      color: "#fff",
      fontSize: 15,
      fontWeight: "700",
    },
  });
