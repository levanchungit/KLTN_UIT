import { useTheme } from "@/app/providers/ThemeProvider";
import NotificationPrePermission from "@/components/NotificationPrePermission";
import NotificationPreview from "@/components/NotificationPreview";
import { useI18n } from "@/i18n/I18nProvider";
import { requestNotificationPermissions } from "@/services/notificationService";
import {
  getSettings,
  initSmartNotifications,
  updateSettings,
  selectFunnyNotification,
  sendFunnyNotification,
} from "@/services/smartNotificationService";
import { sendLocalNotification } from "@/services/notificationService";
import funnyNotifications, { FunnyNotification } from "@/data/funnyNotifications";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Modal, Portal, Switch } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import TimeWheelPicker from "@/components/TimeWheelPicker";

export default function NotificationSettingsScreen() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [settings, setSettings] = useState({
    dailyReminderTime: { hour: 19, minute: 0 },
    enableDaily: true,
    enableInactivity: true,
    enableBudget: true,
    enableWeekly: true,
    enableFunnyMode: false,
    funnyTheme: 'random' as const,
  });
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [selectedHour, setSelectedHour] = useState(19);
  const [selectedMinute, setSelectedMinute] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  const [previewNotification, setPreviewNotification] = useState<FunnyNotification | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const current = await getSettings();
    // Merge with default settings to ensure all properties exist
    const mergedSettings = {
      dailyReminderTime: { hour: 19, minute: 0 },
      enableDaily: true,
      enableInactivity: true,
      enableBudget: true,
      enableWeekly: true,
      enableFunnyMode: false,
      funnyTheme: 'random' as const,
      ...current, // Override with saved settings
    };
    setSettings(mergedSettings);
    setSelectedHour(mergedSettings.dailyReminderTime.hour);
    setSelectedMinute(mergedSettings.dailyReminderTime.minute);
  };

  const handleToggle = async (key: keyof typeof settings) => {
    const targetValue = !settings[key];
    // If turning on daily reminders, show pre-permission modal first
    if (key === "enableDaily" && targetValue) {
      setShowPrePermission(true);
      return;
    }

    const updated = { ...settings, [key]: targetValue };
    setSettings(updated);
    await updateSettings(updated);

    // Reinitialize notifications with new settings
    if (key === "enableDaily") {
      await initSmartNotifications();
    }
  };

  const handleFunnyModeToggle = async (value: boolean) => {
    const updated = { ...settings, enableFunnyMode: value };
    setSettings(updated);
    await updateSettings(updated);
  };

  const handleFunnyThemeChange = async (theme: FunnyNotification['type'] | 'random') => {
    const updated = { ...settings, funnyTheme: theme };
    setSettings(updated);
    await updateSettings(updated);
  };

  const [showPrePermission, setShowPrePermission] = useState(false);

  const handlePrePermissionConfirm = async () => {
    setShowPrePermission(false);
    try {
      const granted = await requestNotificationPermissions();
      if (!granted) {
        Alert.alert(
          t("permissionDeniedTitle") || "Quyền thông báo bị từ chối",
          t("permissionDeniedDesc") ||
            "Bạn đã từ chối nhận thông báo. Mở cài đặt để cho phép.",
          [
            {
              text: t("openSettings") || "Mở cài đặt",
              onPress: () => Linking.openSettings(),
            },
            { text: t("later") || "Để sau" },
          ]
        );
        return;
      }

      const updated = { ...settings, enableDaily: true };
      setSettings(updated);
      await updateSettings(updated);
      await initSmartNotifications();
    } catch (e) {
      console.warn("Failed to enable notifications:", e);
    }
  };

  const handlePrePermissionCancel = () => {
    setShowPrePermission(false);
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
    const timeStr = `${selectedHour}:${selectedMinute.toString().padStart(2, "0")}`;
    Alert.alert(t("updated"), t("dailyReminderUpdated", { time: timeStr }));
  };

  const testAllNotifications = async () => {
    try {
      const modeText = settings.enableFunnyMode ? "CHẾ ĐỘ HÀI HƯỚC ĐÃ BẬT 🎭" : "CHẾ ĐỘ THÔNG THƯỜNG 📢";
     
      const kachingNotifications = funnyNotifications.filter(n => n.soundKey === 'kaching.wav');

      for (const notification of kachingNotifications) {
        await sendLocalNotification({
          title: notification.title,
          message: notification.message,
          type: notification.type === 'survival' || notification.type === 'drama' ? 'warning' : 'reminder',
        }, {
          iconName: notification.iconName,
          soundKey: notification.soundKey,
        });

        // Delay nhỏ giữa các thông báo
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      const otherFunnyNotifications = funnyNotifications.filter(n => n.soundKey !== 'kaching.wav');

      for (const notification of otherFunnyNotifications) {
        await sendLocalNotification({
          title: notification.title,
          message: notification.message,
          type: notification.type === 'survival' || notification.type === 'drama' ? 'warning' : 'reminder',
        }, {
          iconName: notification.iconName,
          soundKey: notification.soundKey,
        });

        // Delay nhỏ giữa các thông báo
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      // === THÔNG BÁO THÔNG THƯỜNG (TÙY CHẾ ĐỘ HÀI HƯỚC) ===
      if (!settings.enableFunnyMode) {
        console.log("📢 Gửi thông báo thông thường...");

        // 1. Nhắc ghi chú cuối ngày
        await sendLocalNotification({
          title: "Nhắc nhở chi tiêu 💸",
          message: "Đừng quên ghi chi tiêu hôm nay nha!",
          type: "reminder"
        });

        // 2. Cảnh báo không hoạt động - Gửi cả 2 loại
        await sendLocalNotification({
          title: "Bạn ổn chứ? 🤔",
          message: "Đã 3 ngày bạn chưa ghi chi tiêu. Hãy cập nhật để theo dõi tốt hơn nhé!",
          type: "warning"
        });

        await sendLocalNotification({
          title: "Chúng tôi nhớ bạn! 💙",
          message: "Đã 1 tuần rồi! Quay lại ghi chi tiêu để kiểm soát tài chính tốt hơn nhé.",
          type: "warning"
        });

        // 3. Cảnh báo ngân sách - Gửi các loại cảnh báo khác nhau
        await sendLocalNotification({
          title: "Cảnh báo ngân sách ⚠️",
          message: "Một danh mục đã đạt 70% ngân sách!",
          type: "warning"
        });

        await sendLocalNotification({
          title: "Gần vượt ngân sách! 🚨",
          message: "Một danh mục đã đạt 90% ngân sách!",
          type: "warning"
        });

        await sendLocalNotification({
          title: "Vượt ngân sách! 🔴",
          message: "Một danh mục đã vượt ngân sách!",
          type: "error"
        });

        // 4. Báo cáo tuần
        await sendLocalNotification({
          title: "Báo cáo tuần 📈",
          message: "Chi tiêu tuần này tăng/giảm X% so với tuần trước!",
          type: "info"
        });

        } else {
        // Gửi thêm một lượt tất cả funny notifications để thay thế 7 cái thông thường
        const allFunnyNotifications = [...funnyNotifications];

        for (const notification of allFunnyNotifications) {
          await sendLocalNotification({
            title: notification.title,
            message: notification.message,
            type: notification.type === 'survival' || notification.type === 'drama' ? 'warning' : 'reminder',
          }, {
            iconName: notification.iconName,
            soundKey: notification.soundKey,
          });

          // Delay nhỏ giữa các thông báo
          await new Promise(resolve => setTimeout(resolve, 150));
        }

      }
    } catch (error) {
      console.error("Error testing notifications:", error);
      Alert.alert("Lỗi", "Có lỗi xảy ra khi gửi thông báo");
    }
  };


  const handlePreviewFunny = () => {
    const selectedType = settings.funnyTheme === 'random' ? undefined : settings.funnyTheme;
    const notification = selectFunnyNotification({ type: selectedType });
    if (notification) {
      setPreviewNotification(notification);
      setShowPreview(true);
    } else {
      Alert.alert("Không có thông báo", "Không tìm thấy thông báo phù hợp cho chủ đề này.");
    }
  };

  const handleSendFunnySamples = async () => {
    try {
      for (let i = 0; i < 5; i++) {
        await sendFunnyNotification({
          bypassAntiSpam: true, // Allow sending multiple for testing
        });
        // Small delay between sends
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error("Error sending funny samples:", error);
      Alert.alert("Lỗi", "Có lỗi xảy ra khi gửi thông báo mẫu");
    }
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
    testButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#667eea",
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 8,
      marginBottom: 12,
      gap: 8,
    },
    testButtonText: {
      color: "#fff",
      fontSize: 16,
      fontWeight: "600",
    },
    testButtonDesc: {
      fontSize: 13,
      color: colors.subText,
      lineHeight: 18,
    },
    themeSelector: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 16,
    },
    themeButton: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      minWidth: 80,
      alignItems: 'center',
    },
    themeButtonText: {
      fontSize: 14,
      fontWeight: '600',
    },
    previewButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#10B981',
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 8,
      marginBottom: 12,
      gap: 8,
    },
  previewButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
    sampleButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.divider,
      gap: 8,
    },
    sampleButtonText: {
      fontSize: 14,
      fontWeight: '600',
    },
  });

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
        <Text style={styles.headerTitle}>{t("notificationSettings")}</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>🔔 {t("smartNotifications")}</Text>
          <Text style={styles.infoText}>{t("smartNotificationsDesc")}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("dailyReminder")}</Text>
          <View style={styles.settingItem}>
            <View style={styles.settingLeft}>
              <Text style={styles.settingTitle}>{t("enableReminder")}</Text>
              <Text style={styles.settingDesc}>{t("reminderDesc")}</Text>
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
                <Text style={styles.settingTitle}>{t("reminderTime")}</Text>
                <Text style={styles.settingDesc}>{t("reminderTimeDesc")}</Text>
              </View>
              <TouchableOpacity
                style={styles.timeButton}
                onPress={() => setShowTimePicker(true)}
              >
                <Ionicons name="time-outline" size={18} color={colors.icon} />
                <Text style={styles.timeText}>
                  {settings.dailyReminderTime.hour}:{settings.dailyReminderTime.minute.toString().padStart(2, "0")}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("inactivityWarning")}</Text>
          <View style={styles.settingItem}>
            <View style={styles.settingLeft}>
              <Text style={styles.settingTitle}>{t("enableWarning")}</Text>
              <Text style={styles.settingDesc}>
                {t("inactivityWarningDesc")}
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
          <Text style={styles.sectionTitle}>{t("budgetWarning")}</Text>
          <View style={styles.settingItem}>
            <View style={styles.settingLeft}>
              <Text style={styles.settingTitle}>{t("enableWarning")}</Text>
              <Text style={styles.settingDesc}>{t("budgetWarningDesc")}</Text>
            </View>
            <Switch
              value={settings.enableBudget}
              onValueChange={() => handleToggle("enableBudget")}
              color="#667eea"
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("weeklyReport")}</Text>
          <View style={styles.settingItem}>
            <View style={styles.settingLeft}>
              <Text style={styles.settingTitle}>{t("enableReport")}</Text>
              <Text style={styles.settingDesc}>{t("weeklyReportDesc")}</Text>
            </View>
            <Switch
              value={settings.enableWeekly}
              onValueChange={() => handleToggle("enableWeekly")}
              color="#667eea"
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Funny Notifications</Text>

          <View style={styles.settingItem}>
            <View style={styles.settingLeft}>
              <Text style={styles.settingTitle}>Bật chế độ hài hước</Text>
              <Text style={styles.settingDesc}>
                Sử dụng thông báo hài hước và sinh động thay vì thông báo thông thường.
              </Text>
            </View>
            <Switch
              value={settings.enableFunnyMode}
              onValueChange={handleFunnyModeToggle}
              color="#667eea"
            />
          </View>

          {settings.enableFunnyMode && (
            <>
              <View style={styles.settingItem}>
                <View style={styles.settingLeft}>
                  <Text style={styles.settingTitle}>Chủ đề thông báo</Text>
                  <Text style={styles.settingDesc}>
                    Chọn loại thông báo hài hước hoặc để ngẫu nhiên.
                  </Text>
                </View>
              </View>

              <View style={styles.themeSelector}>
                {[
                  { key: 'random', label: '🎲 Ngẫu nhiên' },
                  { key: 'tingting', label: '🔔 TingTing' },
                  { key: 'survival', label: '🍜 Survival' },
                  { key: 'drama', label: '💔 Drama' },
                  { key: 'reminder', label: '🧠 Reminder' },
                ].map((theme) => (
                  <TouchableOpacity
                    key={theme.key}
                    style={[
                      styles.themeButton,
                      settings.funnyTheme === theme.key && { backgroundColor: '#667eea' },
                      { borderColor: colors.divider }
                    ]}
                    onPress={() => handleFunnyThemeChange(theme.key as any)}
                  >
                    <Text style={[
                      styles.themeButtonText,
                      settings.funnyTheme === theme.key && { color: '#fff' },
                      { color: colors.text }
                    ]}>
                      {theme.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={styles.previewButton}
                onPress={handlePreviewFunny}
                activeOpacity={0.7}
              >
                <Ionicons name="eye" size={20} color="#fff" />
                <Text style={styles.previewButtonText}>Xem trước thông báo</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.sampleButton}
                onPress={handleSendFunnySamples}
                activeOpacity={0.7}
              >
                <Ionicons name="flask" size={20} color={colors.primary} />
                <Text style={[styles.sampleButtonText, { color: colors.primary }]}>
                  Gửi 5 mẫu để test
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Test Notifications</Text>
          <TouchableOpacity
            style={styles.testButton}
            onPress={testAllNotifications}
            activeOpacity={0.7}
          >
            <Ionicons name="notifications" size={20} color="#fff" />
            <Text style={styles.testButtonText}>Gửi tất cả thông báo</Text>
          </TouchableOpacity>
          <Text style={styles.testButtonDesc}>
            💰 Ưu tiên 6 Funny kaching.wav trước, sau đó tùy chế độ hài hước:\n• Tắt: +6 Funny +7 thường = 19 TB\n• Bật: +6 Funny +12 Funny bổ sung = 24 TB funny!
          </Text>
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
            <Text style={styles.pickerTitle}>{t("selectTime")}</Text>

            <View style={{ alignItems: "center", marginBottom: 8 }}>
              <TimeWheelPicker
                initialHour={selectedHour}
                initialMinute={selectedMinute}
                onHourChange={(h) => setSelectedHour(h)}
                onMinuteChange={(m) => setSelectedMinute(m)}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setShowTimePicker(false)}
              >
                <Text style={styles.buttonText}>{t("cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton]}
                onPress={handleTimeConfirm}
              >
                <Text style={[styles.buttonText, styles.confirmButtonText]}>
                  {t("confirm")}
                </Text>
              </TouchableOpacity>
            </View>
          </Modal>
        </Portal>
      )}
      <NotificationPrePermission
        visible={showPrePermission}
        onConfirm={handlePrePermissionConfirm}
        onCancel={handlePrePermissionCancel}
      />
      <NotificationPreview
        visible={showPreview}
        notification={previewNotification}
        onClose={() => setShowPreview(false)}
        onSend={() => setShowPreview(false)}
      />
    </SafeAreaView>
  );
}
