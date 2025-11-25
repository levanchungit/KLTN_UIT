// app/(tabs)/Transactions.tsx
import { useI18n } from "@/i18n/I18nProvider";
import { listCategories } from "@/repos/categoryRepo";
import { listBetween, type TxDetailRow } from "@/repos/transactionRepo";
import {
  Ionicons,
  MaterialCommunityIcons,
  MaterialIcons,
} from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { writeAsStringAsync } from "expo-file-system/legacy";
import { router } from "expo-router";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import CalendarPicker from "react-native-calendar-picker";
import { Modal, Portal } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../providers/ThemeProvider";

// Helper to get cache directory path
const getCacheDir = () => {
  try {
    const fs = require("expo-file-system/legacy");
    const dir = fs.cacheDirectory || fs.documentDirectory || "";
    if (!dir) return "";
    return dir.endsWith("/") ? dir : dir + "/";
  } catch (e) {
    try {
      const fs = require("expo-file-system");
      const dir = fs.cacheDirectory || fs.documentDirectory || "";
      if (!dir) return "";
      return dir.endsWith("/") ? dir : dir + "/";
    } catch {
      return "";
    }
  }
};

type FilterType = "all" | "day" | "week" | "month" | "year" | "custom";

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

/* Helpers */
const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
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
function dayLabel(
  d: Date,
  t: (key: string, vars?: Record<string, string | number>) => string,
  lang: string
) {
  const today = startOfDay(new Date());
  const dd = startOfDay(d);
  const diff = Math.round((today.getTime() - dd.getTime()) / 86400000);
  let dateText = "";
  if (lang === "vi") {
    dateText = d.toLocaleDateString("vi-VN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } else {
    dateText = d.toLocaleDateString("en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  if (diff === 0) return t("today") + ", " + dateText;
  if (diff === 1) return t("yesterday") + ", " + dateText;
  return dateText;
}
const fmtMoney = (n: number) =>
  (n || 0).toLocaleString("vi-VN", { maximumFractionDigits: 0 }) + " VND";

type Section = { title: string; key: string; date: Date; data: TxDetailRow[] };

export default function Transactions() {
  const { colors, mode } = useTheme();
  const { t, lang } = useI18n();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const [sections, setSections] = useState<Section[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadedDays, setLoadedDays] = useState(0);

  // Filter state
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [filterStartDate, setFilterStartDate] = useState<Date>(new Date());
  const [filterEndDate, setFilterEndDate] = useState<Date>(new Date());
  const [tempStartDate, setTempStartDate] = useState<Date | null>(null);
  const [tempEndDate, setTempEndDate] = useState<Date | null>(null);
  const [tempAnchor, setTempAnchor] = useState<Date | null>(null);
  const [tempYear, setTempYear] = useState<number>(new Date().getFullYear());
  const [tempMonth, setTempMonth] = useState<number>(new Date().getMonth());
  const [tempOnlyYear, setTempOnlyYear] = useState<number>(
    new Date().getFullYear()
  );

  // Search and category filter state
  const [searchText, setSearchText] = useState("");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<
    string | null
  >(null);
  const [showCategoryFilterModal, setShowCategoryFilterModal] = useState(false);
  const [allCategories, setAllCategories] = useState<any[]>([]);

  const PAGE_DAYS = 14;
  const MAX_PAST_DAYS = 365 * 3;

  const loadingMoreRef = useRef(false);
  const onEndMomentumFired = useRef(false);

  // Group rows → sections theo ngày (LÀM Ở JS, không query từng ngày)
  const groupByDay = useCallback(
    (rows: TxDetailRow[]) => {
      const map = new Map<string, Section>();
      for (const r of rows) {
        const day = startOfDay(new Date(r.occurred_at * 1000));
        const key = String(day.getTime());
        let sec = map.get(key);
        if (!sec) {
          sec = { title: dayLabel(day, t, lang), key, date: day, data: [] };
          map.set(key, sec);
        }
        sec.data.push(r);
      }
      return [...map.values()].sort(
        (a, b) => b.date.getTime() - a.date.getTime()
      );
    },
    [t, lang]
  );

  // Fetch một lần theo khoảng ngày với filter
  const fetchRange = useCallback(
    async (fromOffsetDays: number, days: number) => {
      let from: Date;
      let to: Date;

      // Apply filter
      if (filterType === "all") {
        // Load theo page như cũ
        to = startOfDay(new Date());
        to.setDate(to.getDate() - fromOffsetDays);
        to.setHours(23, 59, 59, 999);
        from = new Date(to);
        from.setDate(to.getDate() - days + 1);
        from.setHours(0, 0, 0, 0);
      } else if (filterType === "day") {
        // Use filterStartDate for the selected day
        from = startOfDay(filterStartDate);
        to = new Date(from);
        to.setHours(23, 59, 59, 999);
      } else if (filterType === "week") {
        // Use filterStartDate as the start of the selected week
        from = startOfDay(filterStartDate);
        to = new Date(from);
        to.setDate(to.getDate() + 6);
        to.setHours(23, 59, 59, 999);
      } else if (filterType === "month") {
        // Use filterStartDate to get the month
        from = new Date(
          filterStartDate.getFullYear(),
          filterStartDate.getMonth(),
          1
        );
        to = new Date(
          filterStartDate.getFullYear(),
          filterStartDate.getMonth() + 1,
          0
        );
        to.setHours(23, 59, 59, 999);
      } else if (filterType === "year") {
        // Use filterStartDate to get the year
        from = new Date(filterStartDate.getFullYear(), 0, 1);
        to = new Date(filterStartDate.getFullYear(), 11, 31);
        to.setHours(23, 59, 59, 999);
      } else if (filterType === "custom") {
        // Custom range - ignore offset
        from = startOfDay(filterStartDate);
        to = startOfDay(filterEndDate);
        to.setHours(23, 59, 59, 999);
      } else {
        // Default to all
        to = startOfDay(new Date());
        to.setDate(to.getDate() - fromOffsetDays);
        to.setHours(23, 59, 59, 999);
        from = new Date(to);
        from.setDate(to.getDate() - days + 1);
        from.setHours(0, 0, 0, 0);
      }

      const fromSec = Math.floor(from.getTime() / 1000);
      const toSec = Math.floor(to.getTime() / 1000);

      try {
        const rows = await listBetween(fromSec, toSec);
        return groupByDay(rows);
      } catch (e) {
        console.warn("listBetween error", e);
        return [];
      }
    },
    [groupByDay, filterType, filterStartDate, filterEndDate]
  );

  // Initial + on focus (DÙNG 1 nơi thôi để tránh double-load)
  const loadInitial = useCallback(async () => {
    setRefreshing(true);
    try {
      const secs = await fetchRange(0, PAGE_DAYS);
      setSections(secs);
      setLoadedDays(PAGE_DAYS);
    } finally {
      setRefreshing(false);
    }
  }, [fetchRange]);

  useFocusEffect(
    useCallback(() => {
      loadInitial();
      loadCategoriesForFilter();
    }, [loadInitial])
  );

  const loadCategoriesForFilter = async () => {
    try {
      const cats = await listCategories();
      setAllCategories(cats);
    } catch (e) {
      console.warn("Load categories error", e);
    }
  };

  const ICON_SIZE = 28;

  const getFilterDisplayText = () => {
    if (filterType === "day") {
      return filterStartDate.toLocaleDateString("vi-VN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    } else if (filterType === "week") {
      const start = filterStartDate.toLocaleDateString("vi-VN", {
        day: "numeric",
        month: "short",
      });
      const end = filterEndDate.toLocaleDateString("vi-VN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      return `${start} - ${end}`;
    } else if (filterType === "month") {
      return filterStartDate.toLocaleDateString("vi-VN", {
        month: "long",
        year: "numeric",
      });
    } else if (filterType === "year") {
      return filterStartDate.getFullYear().toString();
    } else if (filterType === "custom") {
      const start = filterStartDate.toLocaleDateString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      const end = filterEndDate.toLocaleDateString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      return `${start} - ${end}`;
    }
    return "";
  };

  const shiftAnchor = (direction: number) => {
    const newStart = new Date(filterStartDate);
    const newEnd = new Date(filterEndDate);
    if (filterType === "day") {
      newStart.setDate(newStart.getDate() + direction);
      newEnd.setDate(newEnd.getDate() + direction);
    } else if (filterType === "week") {
      newStart.setDate(newStart.getDate() + direction * 7);
      newEnd.setDate(newEnd.getDate() + direction * 7);
    } else if (filterType === "month") {
      newStart.setMonth(newStart.getMonth() + direction);
      newEnd.setMonth(newEnd.getMonth() + direction);
    } else if (filterType === "year") {
      newStart.setFullYear(newStart.getFullYear() + direction);
      newEnd.setFullYear(newEnd.getFullYear() + direction);
    }
    setFilterStartDate(newStart);
    setFilterEndDate(newEnd);
    loadInitial();
  };

  const handlePrevious = () => shiftAnchor(-1);

  const handleNext = () => {
    if (canGoNext) shiftAnchor(1);
  };

  const handleToday = () => {
    const today = new Date();
    let start: Date, end: Date;
    if (filterType === "day") {
      start = startOfDay(today);
      end = new Date(start);
      end.setHours(23, 59, 59, 999);
    } else if (filterType === "week") {
      const dayOfWeek = (today.getDay() + 6) % 7;
      start = startOfDay(today);
      start.setDate(start.getDate() - dayOfWeek);
      end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
    } else if (filterType === "month") {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
    } else if (filterType === "year") {
      start = new Date(today.getFullYear(), 0, 1);
      end = new Date(today.getFullYear(), 11, 31);
      end.setHours(23, 59, 59, 999);
    } else {
      return;
    }
    setFilterStartDate(start);
    setFilterEndDate(end);
    loadInitial();
  };

  const atCurrentPeriod =
    filterStartDate <= new Date() && filterEndDate >= new Date();
  const canGoNext = !atCurrentPeriod;

  const getLabel = () => {
    const now = new Date();
    if (filterType === "day") {
      const isToday = filterStartDate.toDateString() === now.toDateString();
      if (isToday) return "Hôm nay";
      return filterStartDate.toLocaleDateString("vi-VN", {
        day: "numeric",
        month: "numeric",
        year: "numeric",
      });
    } else if (filterType === "week") {
      const start = filterStartDate.toLocaleDateString("vi-VN", {
        day: "numeric",
        month: "numeric",
      });
      const end = filterEndDate.toLocaleDateString("vi-VN", {
        day: "numeric",
        month: "numeric",
      });
      const startYear = filterStartDate.getFullYear();
      const endYear = filterEndDate.getFullYear();
      const endStr = startYear === endYear ? end : `${end}/${endYear}`;
      return `Tuần ${start} - ${endStr}`;
    } else if (filterType === "month") {
      const isCurrentMonth =
        filterStartDate.getFullYear() === now.getFullYear() &&
        filterStartDate.getMonth() === now.getMonth();
      if (isCurrentMonth) return "Tháng này";
      return filterStartDate.toLocaleDateString("vi-VN", {
        month: "long",
        year: "numeric",
      });
    } else if (filterType === "year") {
      const isCurrentYear = filterStartDate.getFullYear() === now.getFullYear();
      if (isCurrentYear) return "Năm nay";
      return filterStartDate.getFullYear().toString();
    }
    return "";
  };

  function DayOrWeekPicker({ mode }: { mode: "Ngày" | "Khoảng thời gian" }) {
    const customDatesStyles =
      mode !== "Ngày" || !tempAnchor
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
            ? tempStartDate ?? undefined
            : tempAnchor ?? undefined
        }
        selectedEndDate={
          mode === "Khoảng thời gian"
            ? tempEndDate ?? undefined
            : mode === "Ngày" && tempAnchor
            ? addDays(startOfWeekMon(tempAnchor), 6)
            : undefined
        }
        initialDate={
          mode === "Khoảng thời gian"
            ? tempStartDate ?? new Date()
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
              setTempStartDate(date);
              if (tempEndDate && date > tempEndDate) setTempEndDate(null);
            } else {
              setTempEndDate(date);
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

  const goToCurrentPeriod = handleToday;

  const openCalendarModal = () => {
    // Initialize temp values based on current filter
    if (filterType === "day") {
      setTempAnchor(filterStartDate);
    } else if (filterType === "week") {
      setTempAnchor(filterStartDate);
      setTempYear(filterStartDate.getFullYear());
      setTempMonth(filterStartDate.getMonth());
    } else if (filterType === "month") {
      setTempYear(filterStartDate.getFullYear());
      setTempMonth(filterStartDate.getMonth());
    } else if (filterType === "year") {
      setTempOnlyYear(filterStartDate.getFullYear());
    } else if (filterType === "custom") {
      setTempStartDate(filterStartDate);
      setTempEndDate(filterEndDate);
    }
    setShowCalendarModal(true);
  };

  // Load more theo page (chỉ khi filter = "all")
  const loadMore = useCallback(async () => {
    // Chỉ load more khi filter = all
    if (filterType !== "all") return;

    if (loadingMoreRef.current) return;
    if (loadedDays >= MAX_PAST_DAYS) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const more = await fetchRange(loadedDays, PAGE_DAYS);
      if (more.length === 0) return;

      // merge theo key (ngày)
      const merged = new Map<string, Section>();
      for (const s of sections) merged.set(s.key, s);
      for (const s of more) {
        const prev = merged.get(s.key);
        if (prev)
          merged.set(s.key, { ...prev, data: [...prev.data, ...s.data] });
        else merged.set(s.key, s);
      }
      const arr = [...merged.values()].sort(
        (a, b) => b.date.getTime() - a.date.getTime()
      );
      setSections(arr);
      setLoadedDays((d) => d + PAGE_DAYS);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [fetchRange, loadedDays, sections, filterType]);

  const exportToCSV = async () => {
    try {
      // Flatten all transactions from sections
      const allTransactions = sections.flatMap((section) => section.data);

      if (allTransactions.length === 0) {
        Alert.alert(t("notification"), t("noTransactionsToExport"));
        return;
      }

      // CSV header (removed ID field)
      const csvHeader = `${t("csvAmount")},${t("csvType")},${t(
        "csvCategory"
      )},${t("csvNote")},${t("csvDate")}\n`;

      // CSV rows
      const csvRows = allTransactions
        .map((tx) => {
          const dateObj = new Date(tx.occurred_at * 1000);
          const date = `${String(dateObj.getDate()).padStart(2, "0")}/${String(
            dateObj.getMonth() + 1
          ).padStart(2, "0")}/${dateObj.getFullYear()} ${String(
            dateObj.getHours()
          ).padStart(2, "0")}:${String(dateObj.getMinutes()).padStart(2, "0")}`;
          const type = tx.type === "expense" ? t("expense") : t("income");
          const amount = tx.amount.toString(); // Export as plain number without formatting
          const category = (tx.category_name || "").replace(/"/g, '""');
          const note = (tx.note || "").replace(/"/g, '""');
          return `${amount},"${type}","${category}","${note}","${date}"`;
        })
        .join("\n");

      const csvContent = csvHeader + csvRows;
      const fileName = `giao_dich_${new Date().getTime()}.csv`;

      // Use the helper function
      const fileUri = `${getCacheDir()}${fileName}`;

      // Write file
      await writeAsStringAsync(fileUri, csvContent);

      // Share the file
      const canShare = await isAvailableAsync();
      if (canShare) {
        await shareAsync(fileUri, {
          mimeType: "text/csv",
          dialogTitle: t("exportTransactions"),
          UTI: "public.comma-separated-values-text",
        });
      } else {
        Alert.alert("Lỗi", "Không thể chia sẻ file trên thiết bị này");
      }
    } catch (error) {
      console.error("Error exporting CSV:", error);
      Alert.alert("Lỗi", "Không thể xuất file CSV: " + error);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      {/* Header with Add and Filter Buttons */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t("transactions")}</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity
            style={styles.exportButton}
            onPress={exportToCSV}
            activeOpacity={0.7}
          >
            <Ionicons name="download" size={18} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => router.push("/add-transaction")}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="plus" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Bar and Category Filter */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputWrapper}>
          <Ionicons name="search" size={20} color={colors.subText} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder={t("searchTransactions")}
            placeholderTextColor={colors.subText}
            value={searchText}
            onChangeText={setSearchText}
          />
          {searchText ? (
            <TouchableOpacity
              onPress={() => setSearchText("")}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close-circle" size={20} color={colors.subText} />
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity
          style={[
            styles.categoryFilterButton,
            {
              backgroundColor: selectedCategoryFilter ? "#10B981" : colors.card,
              borderColor: selectedCategoryFilter ? "#10B981" : colors.divider,
            },
          ]}
          onPress={() => setShowCategoryFilterModal(true)}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name="shape-outline"
            size={22}
            color={selectedCategoryFilter ? "#fff" : colors.icon}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.categoryFilterButton,
            {
              backgroundColor: filterType !== "all" ? "#10B981" : colors.card,
              borderColor: filterType !== "all" ? "#10B981" : colors.divider,
            },
          ]}
          onPress={() => setShowFilterModal(true)}
          activeOpacity={0.7}
        >
          <Ionicons
            name="filter"
            size={22}
            color={filterType !== "all" ? "#fff" : colors.icon}
          />
        </TouchableOpacity>
      </View>

      {/* Filter Modal */}
      <Portal>
        <Modal
          visible={showFilterModal}
          onDismiss={() => setShowFilterModal(false)}
          contentContainerStyle={{
            marginHorizontal: 24,
            borderRadius: 16,
            backgroundColor: colors.card,
            padding: 16,
            alignSelf: "center",
            width: 300,
            maxWidth: "90%",
          }}
        >
          <Text
            style={{
              fontSize: 18,
              fontWeight: "700",
              color: colors.text,
              marginBottom: 16,
            }}
          >
            {t("filterTransactions")}
          </Text>

          {(
            ["all", "day", "week", "month", "year", "custom"] as FilterType[]
          ).map((filter) => {
            const labels: Record<string, string> = {
              all: t("all"),
              day: t("day"),
              week: t("week"),
              month: t("month"),
              year: t("year"),
              custom: t("dateRange"),
            };

            return (
              <TouchableOpacity
                key={filter}
                onPress={() => {
                  if (filter === "custom") {
                    // Close filter modal and immediately open calendar picker
                    setShowFilterModal(false);
                    // Use setTimeout to ensure modal is closed before opening new one
                    setTimeout(() => {
                      setFilterType("custom");
                      openCalendarModal();
                    }, 100);
                  } else {
                    setFilterType(filter);
                    setShowFilterModal(false);
                    loadInitial(); // Reload with filter
                  }
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  backgroundColor:
                    filterType === filter ? "#667eea" : "transparent",
                  marginBottom: 8,
                }}
              >
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: "600",
                    color: filterType === filter ? "#fff" : colors.text,
                  }}
                >
                  {labels[filter]}
                </Text>
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity
            onPress={() => setShowFilterModal(false)}
            style={{
              marginTop: 8,
              paddingVertical: 10,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#10B981", fontWeight: "700" }}>Đóng</Text>
          </TouchableOpacity>
        </Modal>
      </Portal>

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
          {/* Quick select buttons */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {filterType === "day" && (
                  <TouchableOpacity
                    onPress={() => {
                      const today = new Date();
                      setTempAnchor(today);
                    }}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 16,
                      backgroundColor: colors.card,
                      borderWidth: 1,
                      borderColor: colors.divider,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: "600" }}>
                      Hôm nay
                    </Text>
                  </TouchableOpacity>
                )}
                {filterType === "week" && (
                  <TouchableOpacity
                    onPress={() => {
                      const today = new Date();
                      setTempAnchor(today);
                      setTempYear(today.getFullYear());
                      setTempMonth(today.getMonth());
                    }}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 16,
                      backgroundColor: colors.card,
                      borderWidth: 1,
                      borderColor: colors.divider,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: "600" }}>
                      Tuần này
                    </Text>
                  </TouchableOpacity>
                )}
                {filterType === "month" && (
                  <TouchableOpacity
                    onPress={() => {
                      const today = new Date();
                      setTempYear(today.getFullYear());
                      setTempMonth(today.getMonth());
                    }}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 16,
                      backgroundColor: colors.card,
                      borderWidth: 1,
                      borderColor: colors.divider,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: "600" }}>
                      Tháng này
                    </Text>
                  </TouchableOpacity>
                )}
                {filterType === "year" && (
                  <TouchableOpacity
                    onPress={() => {
                      const today = new Date();
                      setTempOnlyYear(today.getFullYear());
                    }}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 16,
                      backgroundColor: colors.card,
                      borderWidth: 1,
                      borderColor: colors.divider,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: "600" }}>
                      Năm nay
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </ScrollView>
          </View>

          {filterType === "day" && <DayOrWeekPicker mode="Ngày" />}
          {filterType === "week" && <WeekGridPicker />}
          {filterType === "month" && <MonthGridPicker />}
          {filterType === "year" && <YearPicker />}
          {filterType === "custom" && (
            <DayOrWeekPicker mode="Khoảng thời gian" />
          )}

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
                if (filterType === "custom") {
                  if (tempStartDate && tempEndDate) {
                    setFilterStartDate(tempStartDate);
                    setFilterEndDate(tempEndDate);
                    setShowCalendarModal(false);
                    loadInitial();
                  } else {
                    setShowCalendarModal(false);
                  }
                } else if (filterType === "day") {
                  if (tempAnchor) {
                    const start = startOfDay(tempAnchor);
                    const end = new Date(start);
                    end.setHours(23, 59, 59, 999);
                    setFilterStartDate(start);
                    setFilterEndDate(end);
                    setShowCalendarModal(false);
                    loadInitial();
                  } else {
                    setShowCalendarModal(false);
                  }
                } else if (filterType === "week") {
                  if (tempAnchor) {
                    const start = startOfWeekMon(tempAnchor);
                    const end = new Date(start);
                    end.setDate(end.getDate() + 6);
                    end.setHours(23, 59, 59, 999);
                    setFilterStartDate(start);
                    setFilterEndDate(end);
                    setShowCalendarModal(false);
                    loadInitial();
                  } else {
                    setShowCalendarModal(false);
                  }
                } else if (filterType === "month") {
                  const start = new Date(tempYear, tempMonth, 1);
                  const end = new Date(tempYear, tempMonth + 1, 0);
                  end.setHours(23, 59, 59, 999);
                  setFilterStartDate(start);
                  setFilterEndDate(end);
                  setShowCalendarModal(false);
                  loadInitial();
                } else if (filterType === "year") {
                  const start = new Date(tempOnlyYear, 0, 1);
                  const end = new Date(tempOnlyYear, 11, 31);
                  end.setHours(23, 59, 59, 999);
                  setFilterStartDate(start);
                  setFilterEndDate(end);
                  setShowCalendarModal(false);
                  loadInitial();
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

      {/* Category Filter Modal */}
      <Portal>
        <Modal
          visible={showCategoryFilterModal}
          onDismiss={() => setShowCategoryFilterModal(false)}
          contentContainerStyle={{
            marginHorizontal: 24,
            borderRadius: 16,
            backgroundColor: colors.card,
            padding: 16,
            alignSelf: "center",
            width: 320,
            maxWidth: "90%",
            maxHeight: "70%",
          }}
        >
          <Text
            style={{
              fontSize: 18,
              fontWeight: "700",
              color: colors.text,
              marginBottom: 16,
            }}
          >
            Lọc theo danh mục
          </Text>

          <ScrollView style={{ maxHeight: 400 }}>
            <TouchableOpacity
              onPress={() => {
                setSelectedCategoryFilter(null);
                setShowCategoryFilterModal(false);
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: 12,
                paddingHorizontal: 12,
                borderRadius: 8,
                backgroundColor: !selectedCategoryFilter
                  ? "#667eea"
                  : "transparent",
                marginBottom: 8,
              }}
            >
              <MaterialCommunityIcons
                name="all-inclusive"
                size={20}
                color={!selectedCategoryFilter ? "#fff" : colors.icon}
                style={{ marginRight: 12 }}
              />
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: "600",
                  color: !selectedCategoryFilter ? "#fff" : colors.text,
                }}
              >
                {t("allCategories")}
              </Text>
            </TouchableOpacity>

            {allCategories.map((cat) => {
              const isSelected = selectedCategoryFilter === cat.id;
              let iconName = "cash";
              if (cat.icon) {
                if (cat.icon.startsWith("mc:")) {
                  iconName = cat.icon.replace("mc:", "");
                } else if (cat.icon.startsWith("mi:")) {
                  const iconMap: Record<string, string> = {
                    "directions-car": "car",
                    "flight-takeoff": "airplane-takeoff",
                    assignment: "file-document-outline",
                    pets: "paw",
                    "credit-card": "credit-card-outline",
                  };
                  const miName = cat.icon.replace("mi:", "");
                  iconName = iconMap[miName] || "help-circle-outline";
                } else {
                  iconName = cat.icon;
                }
              }

              return (
                <TouchableOpacity
                  key={cat.id}
                  onPress={() => {
                    setSelectedCategoryFilter(cat.id);
                    setShowCategoryFilterModal(false);
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    backgroundColor: isSelected ? "#667eea" : "transparent",
                    marginBottom: 8,
                  }}
                >
                  <MaterialCommunityIcons
                    name={iconName as any}
                    size={20}
                    color={isSelected ? "#fff" : cat.color || colors.icon}
                    style={{ marginRight: 12 }}
                  />
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: "600",
                      color: isSelected ? "#fff" : colors.text,
                    }}
                  >
                    {cat.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity
            onPress={() => setShowCategoryFilterModal(false)}
            style={{
              marginTop: 16,
              paddingVertical: 10,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#10B981", fontWeight: "700" }}>Đóng</Text>
          </TouchableOpacity>
        </Modal>
      </Portal>

      {/* Show date range when filter is not all */}
      {filterType !== "all" && (
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 12,
            backgroundColor: colors.card,
            borderBottomWidth: 1,
            borderBottomColor: colors.divider,
          }}
        >
          {filterType === "custom" ? (
            <View
              style={{
                width: "100%",
                height: ICON_SIZE,
                justifyContent: "center",
                alignItems: "center",
                position: "relative",
              }}
            >
              <TouchableOpacity onPress={() => openCalendarModal()}>
                <Text
                  style={{
                    fontSize: 16,
                    color: colors.text,
                    fontWeight: "600",
                  }}
                >
                  {filterStartDate.toLocaleDateString("vi-VN", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}{" "}
                  -{" "}
                  {filterEndDate.toLocaleDateString("vi-VN", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}
                </Text>
              </TouchableOpacity>
              <View style={{ position: "absolute", right: 0 }}>
                <TouchableOpacity onPress={() => openCalendarModal()}>
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
                <TouchableOpacity onPress={handlePrevious}>
                  <MaterialIcons
                    name="keyboard-arrow-left"
                    size={ICON_SIZE}
                    color={colors.icon}
                  />
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => openCalendarModal()}>
                <Text
                  style={{
                    fontSize: 16,
                    color: colors.text,
                    fontWeight: "600",
                  }}
                >
                  {getLabel()}
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
                {canGoNext && (
                  <TouchableOpacity onPress={handleNext}>
                    <MaterialIcons
                      name="keyboard-arrow-right"
                      size={ICON_SIZE}
                      color={colors.icon}
                    />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        </View>
      )}

      <SectionList
        sections={sections
          .map((section) => ({
            ...section,
            data: section.data.filter((item) => {
              // Filter by search text
              const matchesSearch =
                !searchText ||
                (item.note || "")
                  .toLowerCase()
                  .includes(searchText.toLowerCase()) ||
                (item.category_name || "")
                  .toLowerCase()
                  .includes(searchText.toLowerCase());

              // Filter by category
              const matchesCategory =
                !selectedCategoryFilter ||
                item.category_id === selectedCategoryFilter;

              return matchesSearch && matchesCategory;
            }),
          }))
          .filter((section) => section.data.length > 0)}
        keyExtractor={(item, index) => `${item.id || index}`}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }) => {
          // Icon mapping for mi: prefix
          const iconMap: Record<string, string> = {
            "directions-car": "car",
            "flight-takeoff": "airplane-takeoff",
            assignment: "file-document-outline",
            pets: "paw",
            "credit-card": "credit-card-outline",
          };

          // Determine icon name and color
          let iconName = "cash";
          let iconColor = colors.icon;

          if (item.category_icon) {
            if (item.category_icon.startsWith("mc:")) {
              iconName = item.category_icon.replace("mc:", "");
            } else if (item.category_icon.startsWith("mi:")) {
              const miName = item.category_icon.replace("mi:", "");
              iconName = iconMap[miName] || "help-circle-outline";
            } else {
              iconName = item.category_icon;
            }
          }

          if (item.category_color) {
            iconColor = item.category_color;
          }

          return (
            <TouchableOpacity
              style={styles.row}
              onPress={() => router.push(`/add-transaction?id=${item.id}`)}
              activeOpacity={0.7}
            >
              <View style={styles.leftIcon}>
                <MaterialCommunityIcons
                  name={iconName as any}
                  size={18}
                  color={iconColor}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.catName}>
                  {item.category_name || "Khác"}
                </Text>
                <Text style={styles.sub}>{item.note || ""}</Text>
              </View>
              <Text
                style={[
                  styles.amount,
                  {
                    color: item.type === "expense" ? "#EF4444" : "#10B981",
                  },
                ]}
              >
                {item.type === "expense" ? "-" : "+"}
                {fmtMoney(item.amount)}
              </Text>
            </TouchableOpacity>
          );
        }}
        refreshing={refreshing}
        onRefresh={loadInitial}
        onEndReached={() => {
          // Chỉ load more khi filter = all
          if (filterType !== "all") return;

          if (!loadingMoreRef.current && onEndMomentumFired.current) {
            loadMore();
          }
        }}
        onEndReachedThreshold={0.3}
        onMomentumScrollBegin={() => {
          onEndMomentumFired.current = true;
        }}
        ListFooterComponent={
          loadingMore ? (
            <View style={{ paddingVertical: 20 }}>
              <ActivityIndicator size="small" color={colors.icon} />
            </View>
          ) : null
        }
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80 }}
        stickySectionHeadersEnabled={false}
      />
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
    addButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: "#1D4ED8",
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#1D4ED8",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 4,
      elevation: 4,
    },
    filterButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: "#10B981",
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#10B981",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 4,
      elevation: 4,
    },
    exportButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: "#F59E0B",
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#F59E0B",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 4,
      elevation: 4,
    },
    sectionHeader: {
      marginTop: 8,
      marginBottom: 4,
      paddingVertical: 6,
      backgroundColor: c.background,
    },
    sectionTitle: { fontSize: 18, fontWeight: "700", color: c.text },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.divider,
    },
    leftIcon: {
      width: 34,
      height: 34,
      borderRadius: 8,
      backgroundColor: c.card,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: c.divider,
    },
    catName: { fontSize: 15, fontWeight: "700", color: c.text },
    sub: { fontSize: 12, color: c.subText, marginTop: 2 },
    amount: { fontSize: 14, fontWeight: "800" },
    searchContainer: {
      flexDirection: "row",
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 12,
      backgroundColor: c.card,
      borderBottomWidth: 1,
      borderBottomColor: c.divider,
      alignItems: "center",
    },
    searchInputWrapper: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.background,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: c.divider,
    },
    searchInput: {
      flex: 1,
      fontSize: 15,
      color: c.text,
      paddingVertical: 0,
    },
    categoryFilterButton: {
      width: 48,
      height: 48,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: c.divider,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 2,
    },
  });
