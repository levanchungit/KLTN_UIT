import { useTheme } from "@/app/providers/ThemeProvider";
import { useUser } from "@/context/userContext";
import { db, openDb } from "@/db";
import { useI18n } from "@/i18n/I18nProvider";
import {
  initSmartNotifications,
  updateSettings,
} from "@/services/smartNotificationService";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
// picker rendered inline for onboarding
import NotificationPrePermission from "@/components/NotificationPrePermission";
import { requestNotificationPermissions } from "@/services/notificationService";
import * as Notifications from "expo-notifications";
import { Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function ReminderSetup() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { user } = useUser();

  useEffect(() => {
    if (!user) {
      console.warn("No user in reminder-setup, redirecting to login");
      router.replace("/auth/login");
    }
  }, [user]);

  const now = new Date();
  const [selectedHour, setSelectedHour] = useState<number>(now.getHours());
  const [selectedMinute, setSelectedMinute] = useState<number>(
    now.getMinutes()
  );
  // picker always visible; no show flag required

  const handleConfirm = async () => {
    const hh = String(selectedHour).padStart(2, "0");
    const mm = String(selectedMinute).padStart(2, "0");
    await AsyncStorage.setItem("daily_reminder_time", `${hh}:${mm}`);
    await AsyncStorage.setItem("onboarding_complete", "1");
    // Clear the onboarding requirement for this user so they won't be forced again
    try {
      await AsyncStorage.removeItem("requires_onboarding");
    } catch (e) {
      console.warn("Failed to clear requires_onboarding:", e);
    }
    // Show pre-permission modal (in-app explanation) before showing system prompt
    // Persist chosen time into notification settings so Settings screen stays in sync
    try {
      await updateSettings({
        dailyReminderTime: { hour: selectedHour, minute: selectedMinute },
      });
    } catch (e) {
      console.warn("Failed to update notification settings:", e);
    }

    // If we already have permission, skip modal and finalize directly
    try {
      const { status } = await Notifications.getPermissionsAsync();
      if (status === "granted") {
        // already allowed: initialize and finalize
        try {
          await initSmartNotifications();
        } catch (e) {
          console.warn("Failed to init notifications:", e);
        }
        await doFinalizeNavigation();
        return;
      }
    } catch (e) {
      // ignore and fall back to showing pre-permission modal
      console.warn("Failed to read notification permissions:", e);
    }

    setShowPrePermission(true);
  };

  const [showPrePermission, setShowPrePermission] = useState(false);

  // Shared finalize: check user, DB resources and navigate appropriately
  const doFinalizeNavigation = async () => {
    try {
      // Wait briefly for user context to initialize (avoid false negatives)
      let ownerId = user?.id;
      if (!ownerId) {
        const start = Date.now();
        while (!ownerId && Date.now() - start < 2000) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 100));
          ownerId = (await (async () => user)())?.id;
        }
      }

      if (!ownerId) {
        console.warn(
          "User not available for post-onboarding checks; redirecting to login"
        );
        return;
      }

      await openDb();
      const accRow = await db.getFirstAsync<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM accounts WHERE user_id=?`,
        ownerId as any
      );
      const accCount = accRow?.cnt ?? 0;
      if (accCount <= 0) {
        router.replace("/onboarding/wallet-setup");
        return;
      }
      const catRow = await db.getFirstAsync<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM categories WHERE user_id=?`,
        ownerId as any
      );
      const catCount = catRow?.cnt ?? 0;
      console.log("Category count for onboarding check reminder:", catCount);
      if (catCount < 3) {
        router.replace("/onboarding/categories-setup");
        return;
      }
    } catch (e) {
      console.warn("Post-onboarding navigation check failed:", e);
    }
    router.replace("/(tabs)");
  };

  const handlePrePermissionConfirm = async () => {
    setShowPrePermission(false);
    try {
      const granted = await requestNotificationPermissions();
      if (!granted) {
        Alert.alert(
          "Quyền thông báo",
          "Bạn đã chọn thời gian nhắc nhở. Để nhận nhắc nhở, vui lòng cho phép ứng dụng gửi thông báo. Bạn có thể bật sau trong Cài đặt.",
          [{ text: "Đã hiểu" }]
        );
      }
      // Ensure settings reflect chosen time before scheduling
      try {
        await updateSettings({
          dailyReminderTime: { hour: selectedHour, minute: selectedMinute },
        });
      } catch (e) {
        console.warn("Failed to update notification settings:", e);
      }
      await initSmartNotifications();
    } catch (e) {
      console.warn("Failed to init notifications:", e);
    }
    await doFinalizeNavigation();
  };

  const handlePrePermissionCancel = async () => {
    setShowPrePermission(false);
    try {
      // Even if user cancels granting permission, persist chosen time to settings
      try {
        await updateSettings({
          dailyReminderTime: { hour: selectedHour, minute: selectedMinute },
        });
      } catch (e) {
        console.warn("Failed to update notification settings:", e);
      }
      await initSmartNotifications();
    } catch (e) {
      console.warn("Failed to init notifications:", e);
    }
    await doFinalizeNavigation();
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["top", "bottom"]}
    >
      <View style={styles.inner}>
        <Text style={[styles.title, { color: colors.text }]}>
          Thiết lập nhắc nhở hàng ngày
        </Text>
        <Text style={[styles.desc, { color: colors.subText }]}>
          Chọn thời gian bạn muốn nhận nhắc nhở mỗi ngày.
        </Text>

        {/* Inline picker displayed below - no trigger buttons needed */}

        {/* Inline picker shown directly on the screen (no modal) */}
        <View style={[styles.pickerModal, { backgroundColor: colors.card }]}>
          {/* Inline picker (time selection) */}

          <View style={styles.pickerRow}>
            <View style={styles.pickerColumn}>
              <Text style={[styles.pickerLabel, { color: colors.subText }]}>
                {t("hour") || "Giờ"}
              </Text>
              <View style={styles.pickerButtons}>
                <TouchableOpacity
                  style={[styles.pickerButton, { borderColor: colors.divider }]}
                  onPress={() => setSelectedHour((h) => (h + 1) % 24)}
                >
                  <Ionicons name="chevron-up" size={20} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.pickerValue, { color: colors.text }]}>
                  {selectedHour.toString().padStart(2, "0")}
                </Text>
                <TouchableOpacity
                  style={[styles.pickerButton, { borderColor: colors.divider }]}
                  onPress={() => setSelectedHour((h) => (h - 1 + 24) % 24)}
                >
                  <Ionicons name="chevron-down" size={20} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>

            <Text
              style={[
                styles.pickerValue,
                { marginHorizontal: 8, color: colors.text },
              ]}
            >
              {":"}
            </Text>

            <View style={styles.pickerColumn}>
              <Text style={[styles.pickerLabel, { color: colors.subText }]}>
                {t("minute") || "Phút"}
              </Text>
              <View style={styles.pickerButtons}>
                <TouchableOpacity
                  style={[styles.pickerButton, { borderColor: colors.divider }]}
                  onPress={() => setSelectedMinute((m) => (m + 1) % 60)}
                >
                  <Ionicons name="chevron-up" size={20} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.pickerValue, { color: colors.text }]}>
                  {selectedMinute.toString().padStart(2, "0")}
                </Text>
                <TouchableOpacity
                  style={[styles.pickerButton, { borderColor: colors.divider }]}
                  onPress={() => setSelectedMinute((m) => (m - 1 + 60) % 60)}
                >
                  <Ionicons name="chevron-down" size={20} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={styles.actionsContainer}>
            <TouchableOpacity
              style={[styles.confirmFull, { backgroundColor: "#16A34A" }]}
              onPress={handleConfirm}
            >
              <Text style={styles.confirmFullText}>
                {t("confirm") || "Xác nhận"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      <NotificationPrePermission
        visible={showPrePermission}
        onConfirm={handlePrePermissionConfirm}
        onCancel={handlePrePermissionCancel}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  inner: { flex: 1, padding: 24, justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 8 },
  desc: { color: "#666", marginBottom: 20 },
  timeBtn: {
    padding: 12,
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 8,
    marginBottom: 12,
    alignItems: "center",
  },
  btn: {
    backgroundColor: "#16A34A",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700" },

  /* picker modal styles */
  pickerModal: {
    marginHorizontal: 0,
    borderRadius: 12,
    padding: 18,
    alignSelf: "stretch",
  },
  pickerTitle: { fontSize: 18, fontWeight: "700", marginBottom: 12 },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  pickerColumn: { alignItems: "center", marginHorizontal: 8 },
  pickerLabel: { fontSize: 12, marginBottom: 6, color: "#888" },
  pickerButtons: { alignItems: "center" },
  pickerButton: {
    padding: 8,
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 6,
  },
  pickerValue: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    minWidth: 50,
  },

  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 18,
  },
  modalButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginLeft: 8,
  },
  cancelButton: { backgroundColor: "transparent" },
  confirmButton: { backgroundColor: "#16A34A" },
  buttonText: { color: "#111", fontWeight: "600" },
  confirmButtonText: { color: "#fff" },
  /* screen action styles */
  actionsContainer: { marginTop: 20, alignItems: "center" },
  confirmFull: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  confirmFullText: { color: "#fff", fontWeight: "700" },
});
