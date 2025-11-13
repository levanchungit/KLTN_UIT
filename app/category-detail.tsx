// app/category-detail.tsx
import { listBetween, type TxDetailRow } from "@/repos/transactionRepo";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { writeAsStringAsync } from "expo-file-system";
import { router, useLocalSearchParams } from "expo-router";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { useTheme } from "./providers/ThemeProvider";

// Helper to get cache directory path
const getCacheDir = () => {
  return require("expo-file-system").documentDirectory || "";
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
const dayLabel = (d: Date) => {
  const today = startOfDay(new Date());
  const dd = startOfDay(d);
  const diff = Math.round((today.getTime() - dd.getTime()) / 86400000);
  const dateText = d.toLocaleDateString("vi-VN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  if (diff === 0) return "Hôm nay, " + dateText;
  if (diff === 1) return "Hôm qua, " + dateText;
  return dateText;
};
const fmtMoney = (n: number) =>
  (n || 0).toLocaleString("vi-VN", { maximumFractionDigits: 0 }) + " VND";

type Section = { title: string; key: string; date: Date; data: TxDetailRow[] };

export default function CategoryDetail() {
  const { colors, mode } = useTheme();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const params = useLocalSearchParams();
  const categoryId = params.categoryId as string;
  const categoryName = params.categoryName as string;
  const categoryIcon = params.categoryIcon as string | undefined;
  const categoryColor = params.categoryColor as string | undefined;

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

  // Search state
  const [searchText, setSearchText] = useState("");

  const PAGE_DAYS = 14;
  const MAX_PAST_DAYS = 365 * 3;

  const loadingMoreRef = useRef(false);
  const onEndMomentumFired = useRef(false);

  // Group rows → sections theo ngày
  const groupByDay = useCallback((rows: TxDetailRow[]) => {
    const map = new Map<string, Section>();
    for (const r of rows) {
      const day = startOfDay(new Date(r.occurred_at * 1000));
      const key = String(day.getTime());
      let sec = map.get(key);
      if (!sec) {
        sec = { title: dayLabel(day), key, date: day, data: [] };
        map.set(key, sec);
      }
      sec.data.push(r);
    }
    return [...map.values()].sort(
      (a, b) => b.date.getTime() - a.date.getTime()
    );
  }, []);

  // Fetch transactions filtered by category
  const fetchRange = useCallback(
    async (fromOffsetDays: number, days: number) => {
      let from: Date;
      let to: Date;

      if (filterType === "all") {
        to = startOfDay(new Date());
        to.setDate(to.getDate() - fromOffsetDays);
        to.setHours(23, 59, 59, 999);
        from = new Date(to);
        from.setDate(to.getDate() - days + 1);
        from.setHours(0, 0, 0, 0);
      } else if (filterType === "day") {
        from = startOfDay(new Date());
        to = new Date(from);
        to.setHours(23, 59, 59, 999);
      } else if (filterType === "week") {
        const today = new Date();
        const dayOfWeek = (today.getDay() + 6) % 7;
        from = startOfDay(new Date());
        from.setDate(from.getDate() - dayOfWeek);
        to = new Date(from);
        to.setDate(to.getDate() + 6);
        to.setHours(23, 59, 59, 999);
      } else if (filterType === "month") {
        const today = new Date();
        from = new Date(today.getFullYear(), today.getMonth(), 1);
        to = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        to.setHours(23, 59, 59, 999);
      } else if (filterType === "year") {
        const today = new Date();
        from = new Date(today.getFullYear(), 0, 1);
        to = new Date(today.getFullYear(), 11, 31);
        to.setHours(23, 59, 59, 999);
      } else if (filterType === "custom") {
        from = startOfDay(filterStartDate);
        to = startOfDay(filterEndDate);
        to.setHours(23, 59, 59, 999);
      } else {
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
        // Filter by categoryId
        const filtered = rows.filter((r) => r.category_id === categoryId);
        return groupByDay(filtered);
      } catch (e) {
        console.warn("listBetween error", e);
        return [];
      }
    },
    [groupByDay, filterType, filterStartDate, filterEndDate, categoryId]
  );

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
    }, [loadInitial])
  );

  const loadMore = useCallback(async () => {
    if (filterType !== "all") return;
    if (loadingMoreRef.current) return;
    if (loadedDays >= MAX_PAST_DAYS) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const more = await fetchRange(loadedDays, PAGE_DAYS);
      if (more.length === 0) return;

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
      const allTransactions = sections.flatMap((section) => section.data);

      if (allTransactions.length === 0) {
        Alert.alert("Thông báo", "Không có giao dịch để xuất");
        return;
      }

      const csvHeader = "Số tiền,Loại,Danh mục,Ghi chú,Ngày\n";
      const csvRows = allTransactions
        .map((tx) => {
          const dateObj = new Date(tx.occurred_at * 1000);
          const date = `${String(dateObj.getDate()).padStart(2, "0")}/${String(
            dateObj.getMonth() + 1
          ).padStart(2, "0")}/${dateObj.getFullYear()} ${String(
            dateObj.getHours()
          ).padStart(2, "0")}:${String(dateObj.getMinutes()).padStart(2, "0")}`;
          const type = tx.type === "expense" ? "Chi tiêu" : "Thu nhập";
          const amount = tx.amount.toString();
          const category = (tx.category_name || "").replace(/"/g, '""');
          const note = (tx.note || "").replace(/"/g, '""');
          return `${amount},"${type}","${category}","${note}","${date}"`;
        })
        .join("\n");

      const csvContent = csvHeader + csvRows;
      const fileName = `giao_dich_${categoryName}_${new Date().getTime()}.csv`;
      const fileUri = `${getCacheDir()}${fileName}`;

      await writeAsStringAsync(fileUri, csvContent);

      const canShare = await isAvailableAsync();
      if (canShare) {
        await shareAsync(fileUri, {
          mimeType: "text/csv",
          dialogTitle: "Xuất giao dịch",
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

  // Get icon name for display
  const getIconName = () => {
    if (!categoryIcon) return "cash";
    if (categoryIcon.startsWith("mc:")) return categoryIcon.replace("mc:", "");
    if (categoryIcon.startsWith("mi:")) {
      const iconMap: Record<string, string> = {
        "directions-car": "car",
        "flight-takeoff": "airplane-takeoff",
        assignment: "file-document-outline",
        pets: "paw",
        "credit-card": "credit-card-outline",
      };
      const miName = categoryIcon.replace("mi:", "");
      return iconMap[miName] || "help-circle-outline";
    }
    return categoryIcon;
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
          <MaterialCommunityIcons
            name="arrow-left"
            size={24}
            color={colors.text}
          />
        </TouchableOpacity>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            flex: 1,
          }}
        >
          <View
            style={[
              styles.categoryIconCircle,
              { backgroundColor: categoryColor || "#667eea" },
            ]}
          >
            <MaterialCommunityIcons
              name={getIconName() as any}
              size={24}
              color="#fff"
            />
          </View>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {categoryName}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity
            style={styles.exportButton}
            onPress={exportToCSV}
            activeOpacity={0.7}
          >
            <Ionicons name="download" size={18} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.filterButton}
            onPress={() => setShowFilterModal(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="filter" size={18} color="#fff" />
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

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputWrapper}>
          <Ionicons
            name="search"
            size={20}
            color={colors.subText}
            style={{ marginRight: 8 }}
          />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Tìm kiếm giao dịch..."
            placeholderTextColor={colors.subText}
            value={searchText}
            onChangeText={setSearchText}
          />
          {searchText ? (
            <TouchableOpacity onPress={() => setSearchText("")}>
              <Ionicons name="close-circle" size={20} color={colors.subText} />
            </TouchableOpacity>
          ) : null}
        </View>
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
            Lọc giao dịch
          </Text>

          {(
            ["all", "day", "week", "month", "year", "custom"] as FilterType[]
          ).map((filter) => {
            const labels: Record<string, string> = {
              all: "Tất cả",
              day: "Hôm nay",
              week: "Tuần này",
              month: "Tháng này",
              year: "Năm này",
              custom: "Khoảng thời gian",
            };

            return (
              <TouchableOpacity
                key={filter}
                onPress={() => {
                  if (filter === "custom") {
                    setShowFilterModal(false);
                    setTimeout(() => {
                      setShowCalendarModal(true);
                    }, 100);
                  } else {
                    setFilterType(filter);
                    setShowFilterModal(false);
                    loadInitial();
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
          <CalendarPicker
            allowRangeSelection={true}
            selectedStartDate={tempStartDate ?? undefined}
            selectedEndDate={tempEndDate ?? undefined}
            initialDate={tempStartDate ?? new Date()}
            minDate={new Date(1970, 0, 1)}
            maxDate={new Date()}
            weekdays={["T2", "T3", "T4", "T5", "T6", "T7", "CN"]}
            months={[
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
            ]}
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
                setTempStartDate(date);
                if (tempEndDate && date > tempEndDate) setTempEndDate(null);
              } else {
                setTempEndDate(date);
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
                if (tempStartDate && tempEndDate) {
                  setFilterStartDate(tempStartDate);
                  setFilterEndDate(tempEndDate);
                  setFilterType("custom");
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

      {/* Custom date range display */}
      {filterType === "custom" && (
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 12,
            backgroundColor: colors.card,
            borderBottomWidth: 1,
            borderBottomColor: colors.divider,
          }}
        >
          <TouchableOpacity
            onPress={() => setShowCalendarModal(true)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                fontSize: 15,
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
            <Ionicons
              name="calendar-outline"
              size={18}
              color={colors.icon}
              style={{ marginLeft: 8 }}
            />
          </TouchableOpacity>
        </View>
      )}

      <SectionList
        sections={sections
          .map((section) => ({
            ...section,
            data: section.data.filter((item) => {
              const matchesSearch =
                !searchText ||
                (item.note || "")
                  .toLowerCase()
                  .includes(searchText.toLowerCase()) ||
                (item.category_name || "")
                  .toLowerCase()
                  .includes(searchText.toLowerCase());
              return matchesSearch;
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
          const iconMap: Record<string, string> = {
            "directions-car": "car",
            "flight-takeoff": "airplane-takeoff",
            assignment: "file-document-outline",
            pets: "paw",
            "credit-card": "credit-card-outline",
          };

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
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: c.divider,
      backgroundColor: c.card,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: c.text,
      flex: 1,
    },
    categoryIconCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
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
    searchContainer: {
      flexDirection: "row",
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: c.card,
      borderBottomWidth: 1,
      borderBottomColor: c.divider,
    },
    searchInputWrapper: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.background,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: c.divider,
    },
    searchInput: {
      flex: 1,
      fontSize: 15,
      color: c.text,
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
  });
