import { useTheme } from "@/app/providers/ThemeProvider";
import { useUser } from "@/context/userContext";
import { useI18n } from "@/i18n/I18nProvider";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function Setting() {
  const { colors, mode, preference, cyclePreference } = useTheme();
  const { user } = useUser();
  const { t } = useI18n();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.profileButton}
          onPress={() => {
            if (user) {
              router.push("/setting/profile");
            } else {
              router.push("/auth/login");
            }
          }}
        >
          <View style={styles.avatar}>
            <Ionicons
              name={user ? "person" : "person-outline"}
              size={24}
              color="#fff"
            />
          </View>
          <View style={{ marginLeft: 12 }}>
            <Text style={styles.profileName}>
              {user ? user.username : "Chưa đăng nhập"}
            </Text>
            <Text style={styles.profileDesc}>
              {user ? "Xem hồ sơ" : "Đăng nhập ngay"}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.sunBtn}
          onPress={cyclePreference}
          activeOpacity={0.8}
        >
          <Ionicons
            name={mode === "light" ? "sunny-outline" : "moon-outline"}
            size={24}
            color={mode === "light" ? "#FBBF24" : "#FDE68A"}
          />
        </TouchableOpacity>
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Setting List */}
      <View style={styles.list}>
        <TouchableOpacity
          style={styles.item}
          activeOpacity={0.9}
          onPress={() => router.push("/setting/wallet")}
        >
          <MaterialIcons
            name="account-balance-wallet"
            size={28}
            color={colors.icon}
          />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.itemTitle}>{t("walletAndCategories")}</Text>
            <Text style={styles.itemDesc}>{t("walletAndCategories_desc")}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.item}
          activeOpacity={0.9}
          onPress={() => router.push("/setting/account")}
        >
          <Ionicons name="settings-outline" size={28} color={colors.icon} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.itemTitle}>{t("accountSettings")}</Text>
            <Text style={styles.itemDesc}>{t("accountSettings_desc")}</Text>
          </View>
        </TouchableOpacity>
      </View>
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
      marginBottom: 12,
      paddingHorizontal: 20,
      justifyContent: "space-between",
    },
    profileButton: {
      flexDirection: "row",
      alignItems: "center",
      flex: 1,
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: "#007AFF",
      justifyContent: "center",
      alignItems: "center",
    },
    profileName: {
      fontSize: 16,
      fontWeight: "600",
      color: c.text,
    },
    profileDesc: {
      fontSize: 13,
      color: c.subText,
      marginTop: 2,
    },
    sunBtn: {
      backgroundColor: c.card,
      borderRadius: 20,
      padding: 8,
      elevation: 2,
      shadowColor: "#000",
      shadowOpacity: 0.08,
      shadowOffset: { width: 0, height: 1 },
      shadowRadius: 2,
    },
    divider: {
      height: 1,
      backgroundColor: c.divider,
      marginHorizontal: 20,
      marginVertical: 8,
    },
    list: {
      marginTop: 8,
      paddingHorizontal: 16,
    },
    item: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.card,
      borderRadius: 14,
      padding: 18,
      marginBottom: 14,
      elevation: 1,
      shadowColor: "#000",
      shadowOpacity: 0.04,
      shadowOffset: { width: 0, height: 1 },
      shadowRadius: 2,
    },
    itemTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: c.text,
      marginBottom: 2,
    },
    itemDesc: {
      fontSize: 13,
      color: c.subText,
    },
  });
