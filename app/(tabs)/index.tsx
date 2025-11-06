import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";

// Dummy components for illustration
const HeaderSection = () => (
  <View style={styles.header}>
    <Text style={styles.greeting}>Xin chào! 👋</Text>
    <View style={styles.shortcutRow}>
      <TouchableOpacity style={styles.milestoneBtn}><Text>🏆 Những cột mốc</Text></TouchableOpacity>
      <TouchableOpacity style={styles.analysisBtn}><Text>📊 Phân tích thêm</Text></TouchableOpacity>
    </View>
  </View>
);

const AssetOverviewSection = () => (
  <View style={styles.assetOverview}>
    <View style={styles.assetCard}><Text>Tiền mặt: 1.743.123₫</Text></View>
    <TouchableOpacity style={styles.newWalletCard}><Text>+ Ví mới</Text></TouchableOpacity>
    <View style={styles.periodSelect}><Text>Tuần ▼</Text></View>
  </View>
);

const NetChangeCard = () => (
  <View style={styles.netChangeCard}>
    <Text style={styles.netChangeTitle}>Thay đổi ròng: 5.743.123₫</Text>
    <View style={styles.netChangeRow}>
      <Text style={styles.expense}>Chi phí: 14.256.877₫ ▼</Text>
      <Text style={styles.income}>Thu nhập: 20.000.000₫ ▲</Text>
    </View>
  </View>
);

const ExpenseDonutChart = () => (
  <View style={styles.donutChart}>
    <Text>Biểu đồ donut (placeholder)</Text>
  </View>
);

const ExpenseGroupList = () => (
  <View style={styles.expenseGroupList}>
    <Text>🍔 Thức ăn & Đồ uống: 5.110.000₫ (36%)</Text>
    <Text>🛫 Du lịch: 5.000.000₫ (35%)</Text>
    <Text>👕 Mua sắm: 3.740.000₫ (26%)</Text>
    <Text>❓ Chưa phân loại: 406.877₫ (3%)</Text>
  </View>
);

const FloatingAddButton = () => (
  <TouchableOpacity style={styles.fab}>
    <Text style={styles.fabText}>+</Text>
  </TouchableOpacity>
);

const BottomTabNavigator = () => (
  <View style={styles.bottomTab}>
    <Text style={styles.tabActive}>Trang chủ</Text>
    <Text>Giao dịch</Text>
    <Text>Công cụ tiền</Text>
    <Text>Cài đặt</Text>
  </View>
);

export default function DashboardScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScrollView>
        <HeaderSection />
        <AssetOverviewSection />
        <NetChangeCard />
        <ExpenseDonutChart />
        <ExpenseGroupList />
      </ScrollView>
      <FloatingAddButton />
      <BottomTabNavigator />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { padding: 16, backgroundColor: '#f8f8f8' },
  greeting: { fontSize: 20, fontWeight: 'bold' },
  shortcutRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  milestoneBtn: { backgroundColor: '#ffe4a1', padding: 8, borderRadius: 8 },
  analysisBtn: { backgroundColor: '#c6f1ff', padding: 8, borderRadius: 8 },
  assetOverview: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', padding: 16 },
  assetCard: { backgroundColor: '#e0f7fa', padding: 16, borderRadius: 8 },
  newWalletCard: { backgroundColor: '#f0f0f0', padding: 16, borderRadius: 8 },
  periodSelect: { marginLeft: 8 },
  netChangeCard: { backgroundColor: '#e3f6fc', margin: 16, padding: 16, borderRadius: 8 },
  netChangeTitle: { fontWeight: 'bold', fontSize: 16 },
  netChangeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  expense: { color: '#e74c3c' },
  income: { color: '#27ae60' },
  donutChart: { alignItems: 'center', margin: 16, padding: 16, backgroundColor: '#f9f9f9', borderRadius: 8 },
  expenseGroupList: { margin: 16 },
  fab: { position: 'absolute', right: 24, bottom: 72, backgroundColor: '#00bcd4', width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  fabText: { color: '#fff', fontSize: 32, fontWeight: 'bold' },
  bottomTab: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', height: 56, backgroundColor: '#f8f8f8', borderTopWidth: 1, borderColor: '#eee' },
  tabActive: { color: '#00bcd4', fontWeight: 'bold' },
});
