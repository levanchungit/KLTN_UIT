// app/notifications.tsx
import { useTheme } from "@/app/providers/ThemeProvider";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Notification = {
  id: string;
  title: string;
  message: string;
  date: Date;
  read: boolean;
  type: "info" | "success" | "warning" | "error";
};

// Mock data - will be replaced with real push notifications later
const mockNotifications: Notification[] = [
  {
    id: "1",
    title: "Ngân sách sắp vượt mức",
    message: "Bạn đã chi tiêu 85% ngân sách tháng này",
    date: new Date(),
    read: false,
    type: "warning",
  },
  {
    id: "2",
    title: "Giao dịch mới",
    message: "Đã thêm giao dịch: Cà phê sáng 45,000đ",
    date: new Date(Date.now() - 86400000), // Yesterday
    read: false,
    type: "success",
  },
  {
    id: "3",
    title: "Nhắc nhở",
    message: "Bạn chưa ghi lại chi tiêu hôm nay",
    date: new Date(Date.now() - 86400000),
    read: true,
    type: "info",
  },
  {
    id: "4",
    title: "Thu nhập mới",
    message: "Đã thêm thu nhập: Lương tháng 10 15,000,000đ",
    date: new Date(Date.now() - 172800000), // 2 days ago
    read: true,
    type: "success",
  },
  {
    id: "5",
    title: "Vượt ngân sách",
    message: "Danh mục Ăn uống đã vượt 120% ngân sách",
    date: new Date(Date.now() - 259200000), // 3 days ago
    read: true,
    type: "error",
  },
];

function groupByDate(notifications: Notification[]) {
  const groups: { [key: string]: Notification[] } = {};
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
  const [notifications, setNotifications] =
    useState<Notification[]>(mockNotifications);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAsRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const groupedNotifications = groupByDate(notifications);

  const getIcon = (type: Notification["type"]) => {
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

  const getIconColor = (type: Notification["type"]) => {
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

  const getIconBg = (type: Notification["type"]) => {
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

  const formatTime = (date: Date) => {
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
    markAllButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
      backgroundColor: "#667eea",
    },
    markAllText: {
      fontSize: 13,
      fontWeight: "600",
      color: "#fff",
    },
    unreadBadge: {
      marginLeft: 8,
      backgroundColor: "#EF4444",
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 10,
    },
    unreadBadgeText: {
      fontSize: 12,
      fontWeight: "700",
      color: "#fff",
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
          <Text style={styles.headerTitle}>Thông báo</Text>
          {unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
            </View>
          )}
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity
            style={styles.markAllButton}
            onPress={markAllAsRead}
            activeOpacity={0.7}
          >
            <Text style={styles.markAllText}>Đánh dấu đã đọc</Text>
          </TouchableOpacity>
        )}
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
          <Text style={styles.emptyTitle}>Chưa có thông báo</Text>
          <Text style={styles.emptyText}>Các thông báo sẽ xuất hiện ở đây</Text>
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
                  onPress={() => markAsRead(notif.id)}
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
