import { useTheme } from "@/app/providers/ThemeProvider";
import { useUser } from "@/context/userContext";
import { useI18n } from "@/i18n/I18nProvider";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React from "react";
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function Setting() {
  const { colors, mode, preference, setPreference } = useTheme();
  const { user } = useUser();
  const { t } = useI18n();
  const styles = React.useMemo(() => makeStyles(colors, mode), [colors, mode]);
  const [themeModalVisible, setThemeModalVisible] = React.useState(false);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.profileButton}
          onPress={async () => {
            if (user) {
              router.push("/setting/profile");
              return;
            }
            try {
              await AsyncStorage.setItem("upgrade_after_login", "1");
            } catch (e) {
              // ignore
            }
            router.push("/auth/login?upgrade=1");
          }}
        >
          <View style={styles.avatar}>
            {user && user.image ? (
              <Image
                source={{ uri: user.image }}
                style={{ width: 48, height: 48, borderRadius: 24 }}
              />
            ) : (
              <Ionicons
                name={user ? "person" : "person-outline"}
                size={24}
                color="#fff"
              />
            )}
          </View>
          <View style={{ marginLeft: 12 }}>
            <Text
              style={styles.profileName}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {(() => {
                const displayName = user
                  ? user.name ?? user.username
                  : "Chưa đăng nhập";
                return displayName.length > 15
                  ? displayName.substring(0, 15) + "..."
                  : displayName;
              })()}
            </Text>
            <Text style={styles.profileDesc}>
              {user ? "Xem hồ sơ" : "Đăng nhập ngay"}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.sunBtn}
          onPress={() => setThemeModalVisible(true)}
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
          onPress={() => router.push("/setting/notifications")}
        >
          <Ionicons
            name="notifications-outline"
            size={28}
            color={colors.icon}
          />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.itemTitle}>{t("smartNotifications")}</Text>
            <Text style={styles.itemDesc}>{t("smartNotificationsDesc")}</Text>
          </View>
        </TouchableOpacity>
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

      {/* Theme Preference Modal */}
      <Modal
        visible={themeModalVisible}
        transparent
        animationType="fade"
        // set marginbottom inset bottom
        style={{ marginBottom: 34, marginTop: 34 }}
        onRequestClose={() => setThemeModalVisible(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setThemeModalVisible(false)}
        >
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>{t("appearance")}</Text>
            <Text style={styles.modalSubtitle}>{t("infoLanguage")}</Text>

            <TouchableOpacity
              style={[
                styles.modalItem,
                preference === "system" && styles.modalItemActive,
              ]}
              onPress={() => {
                setPreference("system");
                setThemeModalVisible(false);
              }}
            >
              <Ionicons
                name="phone-portrait-outline"
                size={20}
                color={colors.icon}
              />
              <Text style={styles.modalItemText}>{t("followSystem")}</Text>
              {preference === "system" && (
                <Ionicons name="checkmark" size={20} color="#10B981" />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.modalItem,
                preference === "light" && styles.modalItemActive,
              ]}
              onPress={() => {
                setPreference("light");
                setThemeModalVisible(false);
              }}
            >
              <Ionicons name="sunny-outline" size={20} color={colors.icon} />
              <Text style={styles.modalItemText}>{t("lightMode")}</Text>
              {preference === "light" && (
                <Ionicons name="checkmark" size={20} color="#10B981" />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.modalItem,
                preference === "dark" && styles.modalItemActive,
              ]}
              onPress={() => {
                setPreference("dark");
                setThemeModalVisible(false);
              }}
            >
              <Ionicons name="moon-outline" size={20} color={colors.icon} />
              <Text style={styles.modalItemText}>{t("darkMode")}</Text>
              {preference === "dark" && (
                <Ionicons name="checkmark" size={20} color="#10B981" />
              )}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (
  c: {
    background: string;
    card: string;
    text: string;
    subText: string;
    divider: string;
    icon: string;
  },
  mode: "light" | "dark"
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
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
      maxWidth: 200,
      flexShrink: 1,
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
    modalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.3)",
      justifyContent: "flex-end",
      marginBottom: 34,
    },
    modalSheet: {
      backgroundColor: c.card,
      padding: 16,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      gap: 8,
    },
    modalTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: c.text,
      marginBottom: 4,
    },
    modalSubtitle: {
      fontSize: 12,
      color: c.subText,
      marginBottom: 8,
    },
    modalItem: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: c.divider,
      gap: 12,
    },
    modalItemActive: {
      backgroundColor: mode === "light" ? "#F3F4F6" : "#111827",
    },
    modalItemText: {
      flex: 1,
      fontSize: 15,
      color: c.text,
    },
  });
