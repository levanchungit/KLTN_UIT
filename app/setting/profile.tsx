import { useUser } from "@/context/userContext";
import { useI18n } from "@/i18n/I18nProvider";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React from "react";
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

export default function ProfileScreen() {
  const { user, logout } = useUser();
  const { t } = useI18n();

  const handleLogout = () => {
    Alert.alert(t("logout"), t("logoutConfirm"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("logout"),
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/auth/login");
        },
      },
    ]);
  };

  if (!user) {
    return (
      <View style={styles.container}>
        <View style={styles.notLoggedIn}>
          <MaterialCommunityIcons
            name="account-circle-outline"
            size={80}
            color="#ccc"
          />
          <Text style={styles.notLoggedInText}>{t("notLoggedIn")}</Text>
          <TouchableOpacity
            style={styles.loginButton}
            onPress={async () => {
              try {
                await AsyncStorage.setItem("upgrade_after_login", "1");
              } catch (e) {
                // ignore
              }
              router.push("/auth/login?upgrade=1");
            }}
          >
            <Text style={styles.loginButtonText}>{t("loginNow")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          {user.image ? (
            <Image
              source={{ uri: user.image }}
              style={{ width: 100, height: 100, borderRadius: 50 }}
            />
          ) : (
            <MaterialCommunityIcons name="account" size={60} color="#fff" />
          )}
        </View>
        <Text style={styles.username} numberOfLines={1} ellipsizeMode="tail">
          {(() => {
            const displayName = user.name ?? user.username;
            return displayName.length > 15
              ? displayName.substring(0, 15) + "..."
              : displayName;
          })()}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Thông tin tài khoản</Text>

        <View style={styles.infoRow}>
          <MaterialCommunityIcons
            name="account-outline"
            size={24}
            color="#666"
          />
          <View style={styles.infoContent}>
            <Text style={styles.infoLabel}>Username</Text>
            <Text style={styles.infoValue}>{user.username}</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <MaterialCommunityIcons name="key-outline" size={24} color="#666" />
          <View style={styles.infoContent}>
            <Text style={styles.infoLabel}>User ID</Text>
            <Text style={styles.infoValue}>{user.id}</Text>
          </View>
        </View>
      </View>

      {user && (
        <View style={styles.section}>
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={24} color="#fff" />
            <Text style={styles.logoutButtonText}>{t("logout")}</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  notLoggedIn: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  notLoggedInText: {
    fontSize: 18,
    color: "#999",
    marginTop: 16,
    marginBottom: 24,
  },
  loginButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
  },
  loginButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  header: {
    backgroundColor: "#007AFF",
    paddingVertical: 40,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(255,255,255,0.3)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  username: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 4,
    maxWidth: "90%",
    flex: 1,
    flexShrink: 1,
  },
  email: {
    fontSize: 14,
    color: "rgba(255,255,255,0.8)",
    maxWidth: "90%",
    flexShrink: 1,
  },
  section: {
    backgroundColor: "#fff",
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  infoContent: {
    flex: 1,
    marginLeft: 16,
  },
  infoLabel: {
    fontSize: 12,
    color: "#999",
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    color: "#333",
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FF3B30",
    paddingVertical: 14,
    borderRadius: 8,
    gap: 8,
  },
  logoutButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
