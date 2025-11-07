// app/(tabs)/Transactions.tsx
import { listBetween, type TxDetailRow } from "@/repos/transactionRepo";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";

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
  if (diff === 0) return `Hôm nay - ${dateText}`;
  if (diff === 1) return `Hôm qua - ${dateText}`;
  return dateText;
};
const fmtMoney = (n: number) =>
  (n || 0).toLocaleString("vi-VN", { maximumFractionDigits: 0 }) + " VND";

type Section = { title: string; key: string; date: Date; data: TxDetailRow[] };

export default function Transactions() {
  const [sections, setSections] = useState<Section[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadedDays, setLoadedDays] = useState(0);

  const PAGE_DAYS = 14; // ↑ tăng page để giảm số lần query
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

  const renderItem = useCallback(({ item }: { item: TxDetailRow }) => {
    const isIncome = item.type === "income";
    const amountColor = isIncome ? "#0EA869" : "#E11D48";
    const icon = item.category_icon ? { uri: item.category_icon } : undefined;

    return (
      <View style={styles.row}>
        <View style={styles.leftIcon}>
          {icon ? (
            <Image
              source={icon}
              style={{ width: 22, height: 22 }}
              resizeMode="contain"
            />
          ) : (
            <MaterialCommunityIcons name="wallet" size={22} color="#0EA5E9" />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.catName} numberOfLines={1}>
            {item.category_name ?? "Danh mục"}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {item.account_name} · {item.note ?? "Mô tả"}
          </Text>
        </View>
        <Text style={[styles.amount, { color: amountColor }]}>
          {(isIncome ? "+" : "-") + fmtMoney(Math.abs(item.amount))}
        </Text>
        <MaterialCommunityIcons
          name="chevron-right"
          size={18}
          color="#9CA3AF"
        />
      </View>
    );
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
        )}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={loadInitial} />
        }
        contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
        onMomentumScrollBegin={() => {
          onEndMomentumFired.current = false;
        }}
        onEndReached={() => {
          if (!onEndMomentumFired.current) {
            loadMore();
            onEndMomentumFired.current = true;
          }
        }}
        onEndReachedThreshold={0.2}
        ListFooterComponent={
          loadingMore ? (
            <View style={{ paddingVertical: 16 }}>
              <ActivityIndicator />
            </View>
          ) : null
        }
        ListEmptyComponent={
          !refreshing ? (
            <View style={{ padding: 24, alignItems: "center" }}>
              <Text>Chưa có giao dịch nào.</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { marginTop: 8, marginBottom: 4, paddingVertical: 6 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: "#111827" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#E5E7EB",
  },
  leftIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: "#ECFEFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#BAE6FD",
  },
  catName: { fontSize: 15, fontWeight: "700", color: "#111827" },
  sub: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  amount: { fontSize: 14, fontWeight: "800" },
});
