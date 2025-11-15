// app/setting/notifications.tsx - Smart notification settings
import { useTheme } from "@/app/providers/ThemeProvider";
import {
  getSettings,
  initSmartNotifications,
  updateSettings,
} from "@/services/smartNotificationService";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Modal, Portal, Switch } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";

export default function NotificationSettingsScreen() {
  const { colors } = useTheme();
  const [settings, setSettings] = useState({
    dailyReminderTime: { hour: 19, minute: 0 },
    enableDaily: true,
    enableInactivity: true,
    enableBudget: true,
    enableWeekly: true,
  });
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [selectedHour, setSelectedHour] = useState(19);
  const [selectedMinute, setSelectedMinute] = useState(0);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const current = await getSettings();
    setSettings(current);
    setSelectedHour(current.dailyReminderTime.hour);
    setSelectedMinute(current.dailyReminderTime.minute);
  };

  const handleToggle = async (key: keyof typeof settings) => {
    const updated = { ...settings, [key]: !settings[key] };
    setSettings(updated);
    await updateSettings(updated);

    // Reinitialize notifications with new settings
    if (key === "enableDaily") {
      await initSmartNotifications();
    }
  };

  const handleTimeConfirm = async () => {
    setShowTimePicker(false);
    const updated = {
      ...settings,
      dailyReminderTime: {
        hour: selectedHour,
        minute: selectedMinute,
      },
    };
    setSettings(updated);
    await updateSettings(updated);
    await initSmartNotifications();
    Alert.alert(
      "Đã cập nhật",
      `Nhắc nhở hàng ngày sẽ gửi lúc ${selectedHour}:${selectedMinute
        .toString()
        .padStart(2, "0")}`
    );
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    backButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
    },
    headerTitle: {
      fontSize: 20,
      fontWeight: "700",
      color: colors.text,
    },
    section: {
      marginTop: 24,
      paddingHorizontal: 16,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.subText,
      marginBottom: 12,
      textTransform: "uppercase",
    },
    settingItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 16,
      paddingHorizontal: 16,
      backgroundColor: colors.card,
      borderRadius: 12,
      marginBottom: 8,
    },
    settingLeft: {
      flex: 1,
      marginRight: 12,
    },
    settingTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.text,
      marginBottom: 4,
    },
    settingDesc: {
      fontSize: 13,
      color: colors.subText,
      lineHeight: 18,
    },
    timeButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: colors.background,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    timeText: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.text,
    },
    infoBox: {
      marginHorizontal: 16,
      marginTop: 16,
      padding: 16,
      backgroundColor: "#DBEAFE",
      borderRadius: 12,
      borderLeftWidth: 4,
      borderLeftColor: "#3B82F6",
    },
    infoTitle: {
      fontSize: 14,
      fontWeight: "700",
      color: "#1E40AF",
      marginBottom: 8,
    },
    infoText: {
      fontSize: 13,
      color: "#1E40AF",
      lineHeight: 20,
    },
    pickerModal: {
      margin: 20,
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 20,
    },
    pickerTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 16,
      textAlign: "center",
    },
    pickerRow: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      marginBottom: 20,
    },
    pickerColumn: {
      alignItems: "center",
      marginHorizontal: 10,
    },
    pickerLabel: {
      fontSize: 14,
      color: colors.subText,
      marginBottom: 8,
    },
    pickerValue: {
      fontSize: 32,
      fontWeight: "700",
      color: colors.text,
      minWidth: 50,
      textAlign: "center",
    },
    pickerButtons: {
      flexDirection: "column",
      gap: 4,
    },
    pickerButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.background,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.divider,
    },
    modalActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 12,
      marginTop: 16,
    },
    modalButton: {
      paddingVertical: 10,
      paddingHorizontal: 20,
      borderRadius: 8,
    },
    cancelButton: {
      backgroundColor: colors.divider,
    },
    confirmButton: {
      backgroundColor: "#667eea",
    },
    buttonText: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.text,
    },
    confirmButtonText: {
      color: "#fff",
    },
  });

  const currentTime = new Date();
  currentTime.setHours(settings.dailyReminderTime.hour);
  currentTime.setMinutes(settings.dailyReminderTime.minute);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color={colors.icon} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Cài đặt thông báo</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>🔔 Thông báo thông minh</Text>
          <Text style={styles.infoText}>
            Hệ thống tự động gửi thông báo phù hợp dựa trên thói quen chi tiêu
            của bạn. Tối đa 3 thông báo/ngày, cách nhau ≥1 giờ.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Nhắc nhở hàng ngày</Text>
          <View style={styles.settingItem}>
            <View style={styles.settingLeft}>
              <Text style={styles.settingTitle}>Bật nhắc nhở</Text>
              <Text style={styles.settingDesc}>
                Nhắc ghi chi tiêu nếu hôm nay bạn chưa ghi
              </Text>
            </View>
            <Switch
              value={settings.enableDaily}
              onValueChange={() => handleToggle("enableDaily")}
              color="#667eea"
            />
          </View>

          {settings.enableDaily && (
            <View style={styles.settingItem}>
              <View style={styles.settingLeft}>
                <Text style={styles.settingTitle}>Thời gian nhắc</Text>
                <Text style={styles.settingDesc}>
                  Chọn giờ nhận thông báo mỗi ngày
                </Text>
              </View>
              <TouchableOpacity
                style={styles.timeButton}
                onPress={() => setShowTimePicker(true)}
              >
                <Ionicons name="time-outline" size={18} color={colors.icon} />
                <Text style={styles.timeText}>
                  {settings.dailyReminderTime.hour}:
                  {settings.dailyReminderTime.minute
                    .toString()
                    .padStart(2, "0")}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cảnh báo không hoạt động</Text>
          <View style={styles.settingItem}>
            <View style={styles.settingLeft}>
              <Text style={styles.settingTitle}>Bật cảnh báo</Text>
              <Text style={styles.settingDesc}>
                Nhắc khi 3 ngày hoặc 7 ngày không ghi chi tiêu
              </Text>
            </View>
            <Switch
              value={settings.enableInactivity}
              onValueChange={() => handleToggle("enableInactivity")}
              color="#667eea"
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cảnh báo ngân sách</Text>
          <View style={styles.settingItem}>
            <View style={styles.settingLeft}>
              <Text style={styles.settingTitle}>Bật cảnh báo</Text>
              <Text style={styles.settingDesc}>
                Thông báo khi đạt 70%, 90%, 100% ngân sách danh mục
              </Text>
            </View>
            <Switch
              value={settings.enableBudget}
              onValueChange={() => handleToggle("enableBudget")}
              color="#667eea"
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Báo cáo tuần</Text>
          <View style={styles.settingItem}>
            <View style={styles.settingLeft}>
              <Text style={styles.settingTitle}>Bật báo cáo</Text>
              <Text style={styles.settingDesc}>
                Gửi Chủ nhật 20:00 nếu chi tiêu thay đổi ≥10%
              </Text>
            </View>
            <Switch
              value={settings.enableWeekly}
              onValueChange={() => handleToggle("enableWeekly")}
              color="#667eea"
            />
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {showTimePicker && (
        <Portal>
          <Modal
            visible={showTimePicker}
            onDismiss={() => setShowTimePicker(false)}
            contentContainerStyle={styles.pickerModal}
          >
            <Text style={styles.pickerTitle}>Chọn thời gian</Text>

            <View style={styles.pickerRow}>
              <View style={styles.pickerColumn}>
                <Text style={styles.pickerLabel}>Giờ</Text>
                <View style={styles.pickerButtons}>
                  <TouchableOpacity
                    style={styles.pickerButton}
                    onPress={() => setSelectedHour((h) => (h + 1) % 24)}
                  >
                    <Ionicons name="chevron-up" size={20} color={colors.text} />
                  </TouchableOpacity>
                  <Text style={styles.pickerValue}>
                    {selectedHour.toString().padStart(2, "0")}
                  </Text>
                  <TouchableOpacity
                    style={styles.pickerButton}
                    onPress={() => setSelectedHour((h) => (h - 1 + 24) % 24)}
                  >
                    <Ionicons
                      name="chevron-down"
                      size={20}
                      color={colors.text}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              <Text style={[styles.pickerValue, { marginHorizontal: 8 }]}>
                :
              </Text>

              <View style={styles.pickerColumn}>
                <Text style={styles.pickerLabel}>Phút</Text>
                <View style={styles.pickerButtons}>
                  <TouchableOpacity
                    style={styles.pickerButton}
                    onPress={() => setSelectedMinute((m) => (m + 1) % 60)}
                  >
                    <Ionicons name="chevron-up" size={20} color={colors.text} />
                  </TouchableOpacity>
                  <Text style={styles.pickerValue}>
                    {selectedMinute.toString().padStart(2, "0")}
                  </Text>
                  <TouchableOpacity
                    style={styles.pickerButton}
                    onPress={() => setSelectedMinute((m) => (m - 1 + 60) % 60)}
                  >
                    <Ionicons
                      name="chevron-down"
                      size={20}
                      color={colors.text}
                    />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setShowTimePicker(false)}
              >
                <Text style={styles.buttonText}>Huỷ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton]}
                onPress={handleTimeConfirm}
              >
                <Text style={[styles.buttonText, styles.confirmButtonText]}>
                  Xong
                </Text>
              </TouchableOpacity>
            </View>
          </Modal>
        </Portal>
      )}
    </SafeAreaView>
  );
}
