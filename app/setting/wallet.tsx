import { useTheme } from "@/app/providers/ThemeProvider";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Modal, Portal } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Currency = {
  code: string;
  name: string;
  symbol: string;
  icon: string;
};

const CURRENCIES: Currency[] = [
  { code: "VND", name: "Việt Nam Đồng", symbol: "₫", icon: "🇻🇳" },
  { code: "USD", name: "US Dollar", symbol: "$", icon: "🇺🇸" },
  { code: "EUR", name: "Euro", symbol: "€", icon: "🇪🇺" },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", icon: "🇯🇵" },
  { code: "KRW", name: "Korean Won", symbol: "₩", icon: "🇰🇷" },
];

export default function WalletSettingsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);

  const [walletName, setWalletName] = useState("Tiền mặt");
  const [selectedCurrency, setSelectedCurrency] = useState(CURRENCIES[0]);
  const [currencyModalVisible, setCurrencyModalVisible] = useState(false);
  const [initialBalance, setInitialBalance] = useState(0);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Cài đặt ví và danh mục</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      >
        {/* Tên ví */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Tên ví</Text>
          <View style={styles.card}>
            <Text style={styles.cardValue}>{walletName}</Text>
          </View>
        </View>

        {/* Tiền tệ */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.card}
            onPress={() => setCurrencyModalVisible(true)}
          >
            <Text style={styles.cardValue}>
              Tiền tệ -{selectedCurrency.code} ({selectedCurrency.symbol})
            </Text>
          </TouchableOpacity>
        </View>

        {/* Số dư ban đầu */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.card}>
            <Text style={styles.cardLabel}>Số dư ban đầu</Text>
            <Text style={styles.cardAmount}>₫{initialBalance}</Text>
          </TouchableOpacity>
        </View>

        {/* Quản lý danh mục */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push("/setting/categories")}
          >
            <MaterialCommunityIcons
              name="format-list-bulleted"
              size={24}
              color={colors.text}
              style={{ marginRight: 12 }}
            />
            <Text style={styles.cardValue}>Quản lý danh mục</Text>
          </TouchableOpacity>
        </View>

        {/* Chia sẻ ví và mời thành viên */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.card}>
            <MaterialCommunityIcons
              name="account-multiple-plus-outline"
              size={24}
              color={colors.text}
              style={{ marginRight: 12 }}
            />
            <Text style={styles.cardValue}>Chia sẻ ví và mời thành viên</Text>
          </TouchableOpacity>
        </View>

        {/* Ví yêu cầu mở khóa sinh trắc học */}
        <View style={styles.section}>
          <View style={styles.switchCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchLabel}>
                Ví yêu cầu mở khóa sinh trắc học 🔒
              </Text>
            </View>
            <Switch
              value={biometricEnabled}
              onValueChange={setBiometricEnabled}
              trackColor={{ false: colors.divider, true: "#34C759" }}
              thumbColor="#fff"
            />
          </View>
        </View>
      </ScrollView>

      {/* Bottom Buttons */}
      <View
        style={[styles.bottomButtons, { paddingBottom: insets.bottom + 16 }]}
      >
        <TouchableOpacity style={styles.saveButton}>
          <Text style={styles.saveButtonText}>Lưu</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteButton}>
          <Text style={styles.deleteButtonText}>Xóa ví</Text>
        </TouchableOpacity>
      </View>

      {/* Modal chọn tiền tệ */}
      <Portal>
        <Modal
          visible={currencyModalVisible}
          onDismiss={() => setCurrencyModalVisible(false)}
          contentContainerStyle={[
            styles.currencyModal,
            { backgroundColor: colors.card },
          ]}
        >
          <Text style={[styles.modalTitle, { color: colors.text }]}>
            Chọn tiền tệ
          </Text>
          <ScrollView>
            {CURRENCIES.map((currency) => (
              <TouchableOpacity
                key={currency.code}
                style={styles.currencyItem}
                onPress={() => {
                  setSelectedCurrency(currency);
                  setCurrencyModalVisible(false);
                }}
              >
                <Text style={styles.currencyIcon}>{currency.icon}</Text>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.currencyName, { color: colors.text }]}>
                    {currency.name}
                  </Text>
                  <Text
                    style={[styles.currencyCode, { color: colors.subText }]}
                  >
                    {currency.code} ({currency.symbol})
                  </Text>
                </View>
                {selectedCurrency.code === currency.code && (
                  <Ionicons name="checkmark" size={24} color="#10B981" />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Modal>
      </Portal>
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
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: c.divider,
    },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 18, fontWeight: "700", color: c.text },
    content: { flex: 1, paddingHorizontal: 16 },
    section: {
      marginBottom: 16,
    },
    sectionLabel: {
      fontSize: 14,
      color: c.subText,
      marginBottom: 8,
      marginLeft: 4,
    },
    card: {
      backgroundColor: c.card,
      borderRadius: 16,
      padding: 20,
      flexDirection: "row",
      alignItems: "center",
      shadowColor: "#000",
      shadowOpacity: 0.05,
      shadowOffset: { width: 0, height: 2 },
      shadowRadius: 8,
      elevation: 2,
    },
    cardValue: {
      fontSize: 16,
      color: c.text,
      flex: 1,
    },
    cardLabel: {
      fontSize: 16,
      color: c.text,
      flex: 1,
    },
    cardAmount: {
      fontSize: 16,
      color: c.text,
      fontWeight: "600",
    },
    switchCard: {
      backgroundColor: c.card,
      borderRadius: 16,
      padding: 20,
      flexDirection: "row",
      alignItems: "center",
      shadowColor: "#000",
      shadowOpacity: 0.05,
      shadowOffset: { width: 0, height: 2 },
      shadowRadius: 8,
      elevation: 2,
    },
    switchLabel: {
      fontSize: 15,
      color: c.text,
    },
    bottomButtons: {
      paddingHorizontal: 16,
      paddingTop: 16,
      backgroundColor: c.background,
      borderTopWidth: 1,
      borderTopColor: c.divider,
      gap: 12,
    },
    saveButton: {
      backgroundColor: "#00BCD4",
      borderRadius: 30,
      paddingVertical: 16,
      alignItems: "center",
    },
    saveButtonText: {
      color: "#fff",
      fontSize: 16,
      fontWeight: "600",
    },
    deleteButton: {
      backgroundColor: "#FF5252",
      borderRadius: 30,
      paddingVertical: 16,
      alignItems: "center",
    },
    deleteButtonText: {
      color: "#fff",
      fontSize: 16,
      fontWeight: "600",
    },
    currencyModal: {
      marginHorizontal: 24,
      padding: 20,
      borderRadius: 16,
      maxHeight: "80%",
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: "700",
      marginBottom: 16,
    },
    currencyItem: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: c.divider,
    },
    currencyIcon: {
      fontSize: 32,
    },
    currencyName: {
      fontSize: 16,
      fontWeight: "600",
    },
    currencyCode: {
      fontSize: 13,
      marginTop: 2,
    },
  });
