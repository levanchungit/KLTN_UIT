// app/(tabs)/Transactions.tsx
import { listBetween, type TxDetailRow } from "@/repos/transactionRepo";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  SectionList,
  StyleSheet,
  Text,
  View
} from "react-native";
import { useTheme } from "../providers/ThemeProvider";

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

export default function Transactions() {
  const { colors, mode } = useTheme();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const [sections, setSections] = useState<Section[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadedDays, setLoadedDays] = useState(0);

  const PAGE_DAYS = 14;
  const MAX_PAST_DAYS = 365 * 3;

  const loadingMoreRef = useRef(false);
  const onEndMomentumFired = useRef(false);

  // Group rows → sections theo ngày (LÀM Ở JS, không query từng ngày)
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

  // Fetch một lần theo khoảng ngày
  const fetchRange = useCallback(
    async (fromOffsetDays: number, days: number) => {
      const to = startOfDay(new Date());
      to.setDate(to.getDate() - fromOffsetDays); // exclusive end (HÔM NAY - offset)
      const from = new Date(to);
      from.setDate(to.getDate() - days); // lấy "days" ngày trước đó

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
    [groupByDay]
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
    }, [loadInitial])
  );

  // Load more theo page (vẫn chỉ 1 query / lần)
  const loadMore = useCallback(async () => {
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
  }, [fetchRange, loadedDays, sections]);

  return (
    <View style={styles.container}>
      <SectionList
        sections={sections}
        keyExtractor={(item, index) => `${item.id || index}`}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.leftIcon}>
              <Ionicons
                name={item.type === "expense" ? "arrow-down" : "arrow-up"}
                size={18}
                color={item.type === "expense" ? "#EF4444" : "#10B981"}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.catName}>{item.category || "Khác"}</Text>
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
          </View>
        )}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          // ...reload data...
          setRefreshing(false);
        }}
        onEndReached={() => {
          if (!loadingMoreRef.current && onEndMomentumFired.current) {
            loadingMoreRef.current = true;
            setLoadingMore(true);
            // ...load more data...
            setTimeout(() => {
              setLoadingMore(false);
              loadingMoreRef.current = false;
            }, 1000);
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
    </View>
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
      backgroundColor: c.card,
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
