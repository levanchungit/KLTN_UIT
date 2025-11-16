// app/notifications.tsx
import { useTheme } from "@/app/providers/ThemeProvider";
import { useI18n } from "@/i18n/I18nProvider";
import {
  AppNotification,
  clearAllNotifications,
  deleteNotification,
  getAllNotifications,
  markAllAsRead,
  markAsRead,
  requestNotificationPermissions,
  subscribeToNotifications,
} from "@/services/notificationService";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

function groupByDate(notifications: AppNotification[]) {
  const groups: { [key: string]: AppNotification[] } = {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  notifications.forEach((notif) => {
    const notifDate = new Date(notif.date);
    notifDate.setHours(0, 0, 0, 0);

    let key: string;
    if (notifDate.getTime() === today.getTime()) {
      key = "Hôm nay";
    } else if (notifDate.getTime() === yesterday.getTime()) {
      key = "Hôm qua";
    } else {
      key = notifDate.toLocaleDateString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    }

    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(notif);
  });

  return groups;
}

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  // Ask permissions once when screen mounts
  useEffect(() => {
    requestNotificationPermissions().catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    const items = await getAllNotifications();
    setNotifications(items);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      const unsub = subscribeToNotifications(() => {
        load();
      });
      return () => unsub();
    }, [load])
  );

  const unreadCount = notifications.filter((n) => !n.read).length;

  const onMarkOne = async (id: string) => {
    await markAsRead(id);
    await load();
  };

  const onMarkAll = async () => {
    await markAllAsRead();
    await load();
  };

  const onDeleteOne = async (id: string) => {
    await deleteNotification(id);
    await load();
  };

  const onClearAll = async () => {
    await clearAllNotifications();
    await load();
  };

  const groupedNotifications = groupByDate(notifications);

  const getIcon = (type: AppNotification["type"]) => {
    switch (type) {
      case "success":
        return "checkmark-circle";
      case "warning":
        return "warning";
      case "error":
        return "alert-circle";
      default:
        return "information-circle";
    }
  };

  const getIconColor = (type: AppNotification["type"]) => {
    switch (type) {
      case "success":
        return "#10B981";
      case "warning":
        return "#F59E0B";
      case "error":
        return "#EF4444";
      default:
        return "#3B82F6";
    }
  };

  const getIconBg = (type: AppNotification["type"]) => {
    switch (type) {
      case "success":
        return "#DCFCE7";
      case "warning":
        return "#FEF3C7";
      case "error":
        return "#FEE2E2";
      default:
        return "#DBEAFE";
    }
  };

  const formatTime = (date: Date | undefined) => {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
      return "--:--";
    }
    return date.toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    headerLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    headerRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    backButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.divider,
    },
    headerTitle: {
      fontSize: 20,
      fontWeight: "700",
      color: colors.text,
    },
    iconBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.divider,
    },
    sectionHeader: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: colors.card,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.subText,
    },
    notificationItem: {
      flexDirection: "row",
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      gap: 12,
    },
    notificationItemUnread: {
      backgroundColor: colors.card,
    },
    iconContainer: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
    },
    notificationContent: {
      flex: 1,
    },
    notificationHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 4,
    },
    notificationTitle: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.text,
      flex: 1,
    },
    notificationTime: {
      fontSize: 12,
      color: colors.subText,
    },
    notificationMessage: {
      fontSize: 14,
      color: colors.subText,
      lineHeight: 20,
    },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: "#EF4444",
      marginTop: 6,
    },
    emptyState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 64,
    },
    emptyIcon: {
      marginBottom: 16,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 8,
    },
    emptyText: {
      fontSize: 14,
      color: colors.subText,
    },
  });

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={20} color={colors.icon} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {unreadCount > 0
              ? `${t("notifications")} (${unreadCount})`
              : t("notifications")}
          </Text>
        </View>
        <View style={styles.headerRight}>
          {unreadCount > 0 && (
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={onMarkAll}
              activeOpacity={0.7}
              accessibilityLabel={t("markAllRead")}
            >
              <Ionicons
                name="checkmark-done-outline"
                size={20}
                color={colors.icon}
              />
            </TouchableOpacity>
          )}
          {notifications.length > 0 && (
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={onClearAll}
              activeOpacity={0.7}
              accessibilityLabel={t("deleteAllNotifications")}
            >
              <Ionicons name="trash-outline" size={20} color={colors.icon} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Notifications List */}
      {notifications.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons
            name="notifications-off-outline"
            size={64}
            color={colors.divider}
            style={styles.emptyIcon}
          />
          <Text style={styles.emptyTitle}>{t("noNotifications")}</Text>
          <Text style={styles.emptyText}>{t("noNotificationsDesc")}</Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          {Object.entries(groupedNotifications).map(([dateLabel, notifs]) => (
            <View key={dateLabel}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{dateLabel}</Text>
              </View>
              {notifs.map((notif) => (
                <TouchableOpacity
                  key={notif.id}
                  style={[
                    styles.notificationItem,
                    !notif.read && styles.notificationItemUnread,
                  ]}
                  onPress={() => onMarkOne(notif.id)}
                  onLongPress={() => onDeleteOne(notif.id)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.iconContainer,
                      { backgroundColor: getIconBg(notif.type) },
                    ]}
                  >
                    <Ionicons
                      name={getIcon(notif.type)}
                      size={24}
                      color={getIconColor(notif.type)}
                    />
                  </View>
                  <View style={styles.notificationContent}>
                    <View style={styles.notificationHeader}>
                      <Text style={styles.notificationTitle}>
                        {notif.title}
                      </Text>
                      <Text style={styles.notificationTime}>
                        {formatTime(notif.date)}
                      </Text>
                    </View>
                    <Text style={styles.notificationMessage}>
                      {notif.message}
                    </Text>
                  </View>
                  {!notif.read && <View style={styles.unreadDot} />}
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
