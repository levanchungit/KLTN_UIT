import { useTheme } from "@/app/providers/ThemeProvider";
import { useI18n } from "@/i18n/I18nProvider";
import {
  authenticateWithBiometric,
  getBiometricType,
  isBiometricEnabled,
  isBiometricSupported,
  setBiometricEnabled as saveBiometricEnabled,
} from "@/utils/biometric";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
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
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);

  const [walletName, setWalletName] = useState("Tiền mặt");
  const [selectedCurrency, setSelectedCurrency] = useState(CURRENCIES[0]);
  const [currencyModalVisible, setCurrencyModalVisible] = useState(false);
  const [initialBalance, setInitialBalance] = useState(0);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricSupported, setBiometricSupported] = useState(false);
  // Map biometric type to localized string
  const { lang } = useI18n();
  const [biometricType, setBiometricType] = useState("Sinh trắc học");
  const getLocalizedBiometricType = (type: string) => {
    if (type.toLowerCase().includes("finger")) {
      return lang === "vi" ? "Vân tay" : "Fingerprint";
    }
    if (type.toLowerCase().includes("face")) {
      return lang === "vi" ? "Khuôn mặt" : "Face";
    }
    return lang === "vi" ? "Sinh trắc học" : "Biometric";
  };

  useEffect(() => {
    // Load biometric settings
    (async () => {
      const supported = await isBiometricSupported();
      setBiometricSupported(supported);

      if (supported) {
        const enabled = await isBiometricEnabled();
        setBiometricEnabled(enabled);

        const type = await getBiometricType();
        setBiometricType(type);
      }
    })();
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("walletSettings")}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      >
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
            <Text style={styles.cardValue}>{t("manageCategories")}</Text>
          </TouchableOpacity>
        </View>

        {/* Biometric unlock (localized) */}
        {biometricSupported && (
          <View style={styles.section}>
            <View style={styles.switchCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchLabel}>
                  {t("biometricUnlock", {
                    type: getLocalizedBiometricType(biometricType),
                  })}
                </Text>
                <Text style={styles.switchDesc}>
                  {t("biometricUnlockDesc")}
                </Text>
              </View>
              <Switch
                value={biometricEnabled}
                onValueChange={async (value) => {
                  if (value) {
                    // Require authentication before enabling
                    const success = await authenticateWithBiometric(
                      t("biometricRegister", { type: biometricType })
                    );
                    if (success) {
                      setBiometricEnabled(true);
                      await saveBiometricEnabled(true);
                      // Biometric enabled — no success alert shown (silently enable)
                    } else {
                      Alert.alert(
                        t("biometricFailed"),
                        t("biometricFailedDesc")
                      );
                    }
                  } else {
                    // Disable without authentication
                    setBiometricEnabled(false);
                    await saveBiometricEnabled(false);
                  }
                }}
                trackColor={{ false: colors.divider, true: "#34C759" }}
                thumbColor="#fff"
              />
            </View>
          </View>
        )}
      </ScrollView>
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
      marginTop: 12,
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
      fontWeight: "600",
    },
    switchDesc: {
      fontSize: 12,
      color: c.subText,
      marginTop: 4,
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
