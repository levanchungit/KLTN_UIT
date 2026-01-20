import { getCurrentUserId } from "@/utils/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Audio } from "expo-av";
import { Platform } from "react-native";
import { Asset } from "expo-asset";

const NOTIFICATIONS_KEY = "@notifications";

export type NotificationType =
  | "reminder"
  | "info"
  | "warning"
  | "success"
  | "error";

export interface StoredNotification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  timestamp: number;
  isRead: boolean;
}

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  date: Date;
  read: boolean;
}

// Lightweight subscription system to notify UI about changes
type NotificationSubscriber = () => void;
const notificationSubscribers = new Set<NotificationSubscriber>();
function notifySubscribers() {
  notificationSubscribers.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}
export function subscribeToNotifications(fn: NotificationSubscriber) {
  notificationSubscribers.add(fn);
  return () => notificationSubscribers.delete(fn);
}

// Configure notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// THÊM: Listener để lưu notification khi nhận được
export function setupNotificationListener() {
  // Khi app đang mở và nhận notification
  const subscription = Notifications.addNotificationReceivedListener(
    async (notification) => {
      const { title, body, data } = notification.request.content;

      // Check if this is a daily check notification
      if (data?.type === "daily_check") {
        const { checkDailyReminder } = await import(
          "@/services/smartNotificationService"
        );
        await checkDailyReminder();
        return; // Don't save this internal notification
      }

      await saveNotification({
        title: title || "Thông báo",
        message: body || "",
        type: "reminder",
      });
      // saveNotification already persists; notify UI
      notifySubscribers();
    }
  );

  // Khi user tap vào notification
  const responseSubscription =
    Notifications.addNotificationResponseReceivedListener(async (response) => {
      const { title, body } = response.notification.request.content;
      // Notification đã được lưu ở listener trên, chỉ cần đánh dấu đã đọc nếu cần
    });

  return () => {
    subscription.remove();
    responseSubscription.remove();
  };
}

// Request permissions
export async function requestNotificationPermissions(): Promise<boolean> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    return false;
  }

  // Setup Android notification channel
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Thông báo chung",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  }

  return true;
}

// Get Expo Push Token
export async function getExpoPushToken(): Promise<string | null> {
  try {
    // Skip remote push token retrieval on Android when running in Expo Go
    if (Platform.OS === "android" && Constants.appOwnership === "expo") {
      console.warn(
        "expo-notifications: Skipping getExpoPushTokenAsync on Expo Go (Android). Use a development build for remote push."
      );
      return null;
    }
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    return token;
  } catch (error) {
    console.error("Error getting push token:", error);
    return null;
  }
}

// Save notification to storage
export async function saveNotification(
  notification: Omit<StoredNotification, "id" | "timestamp" | "isRead">,
  userId?: string
): Promise<void> {
  if (!userId) {
    userId = (await getCurrentUserId()) || undefined;
  }
  const key = `${NOTIFICATIONS_KEY}_${userId}`;
  try {
    const data = await AsyncStorage.getItem(key);
    const stored: StoredNotification[] = data ? JSON.parse(data) : [];
    const newNotif: StoredNotification = {
      ...notification,
      id: Date.now().toString(),
      timestamp: Date.now(),
      isRead: false,
    };
    stored.unshift(newNotif);
    await AsyncStorage.setItem(key, JSON.stringify(stored));
    notifySubscribers();
  } catch (error) {
    console.error("Error saving notification:", error);
  }
}

// Get all notifications
export async function getAllNotifications(
  userId?: string
): Promise<AppNotification[]> {
  if (!userId) {
    userId = (await getCurrentUserId()) || undefined;
  }
  const key = `${NOTIFICATIONS_KEY}_${userId}`;
  try {
    const data = await AsyncStorage.getItem(key);
    const stored: StoredNotification[] = data ? JSON.parse(data) : [];
    return stored.map((n) => ({
      id: n.id,
      title: n.title,
      message: n.message,
      type: n.type,
      date: new Date(n.timestamp),
      read: n.isRead,
    }));
  } catch (error) {
    console.error("Error loading notifications:", error);
    return [];
  }
}

// Get unread count
export async function getUnreadCount(userId?: string): Promise<number> {
  try {
    const notifications = await getAllNotifications(userId);
    return notifications.filter((n) => !n.read).length;
  } catch (error) {
    return 0;
  }
}

// Mark as read
export async function markAsRead(id: string, userId?: string): Promise<void> {
  if (!userId) {
    userId = (await getCurrentUserId()) || undefined;
  }
  const key = `${NOTIFICATIONS_KEY}_${userId}`;
  try {
    const data = await AsyncStorage.getItem(key);
    const stored: StoredNotification[] = data ? JSON.parse(data) : [];
    const updated = stored.map((n) =>
      n.id === id ? { ...n, isRead: true } : n
    );
    await AsyncStorage.setItem(key, JSON.stringify(updated));
    notifySubscribers();
  } catch (error) {
    console.error("Error marking as read:", error);
  }
}

// Mark all as read
export async function markAllAsRead(userId?: string): Promise<void> {
  if (!userId) {
    userId = (await getCurrentUserId()) || undefined;
  }
  const key = `${NOTIFICATIONS_KEY}_${userId}`;
  try {
    const data = await AsyncStorage.getItem(key);
    const stored: StoredNotification[] = data ? JSON.parse(data) : [];
    const updated = stored.map((n) => ({ ...n, isRead: true }));
    await AsyncStorage.setItem(key, JSON.stringify(updated));
    notifySubscribers();
  } catch (error) {
    console.error("Error marking all as read:", error);
  }
}

// Delete notification
export async function deleteNotification(
  id: string,
  userId?: string
): Promise<void> {
  if (!userId) {
    userId = (await getCurrentUserId()) || undefined;
  }
  const key = `${NOTIFICATIONS_KEY}_${userId}`;
  try {
    const data = await AsyncStorage.getItem(key);
    const stored: StoredNotification[] = data ? JSON.parse(data) : [];
    const filtered = stored.filter((n) => n.id !== id);
    await AsyncStorage.setItem(key, JSON.stringify(filtered));
    notifySubscribers();
  } catch (error) {
    console.error("Error deleting notification:", error);
  }
}

// Clear all notifications
export async function clearAllNotifications(userId?: string): Promise<void> {
  if (!userId) {
    userId = (await getCurrentUserId()) || undefined;
  }
  const key = `${NOTIFICATIONS_KEY}_${userId}`;
  try {
    await AsyncStorage.setItem(key, JSON.stringify([]));
    notifySubscribers();
  } catch (error) {
    console.error("Error clearing notifications:", error);
  }
}

// Send local notification (for testing) with optional image and sound
// Note: Custom notification sounds require platform-specific setup and may not work in Expo Go
export async function sendLocalNotification(
  notification: Omit<StoredNotification, "id" | "timestamp" | "isRead">,
  options?: {
    iconName?: string; // Ionicons name for SVG icon
    soundKey?: string;
  }
): Promise<void> {
  try {
    const content: any = {
      title: notification.title,
      body: notification.message,
      sound: true,
      data: {
        type: "funny_notification",
        iconName: options?.iconName,
        soundKey: options?.soundKey,
      },
    };

    // Set custom sound if soundKey exists and file is available
    if (options?.soundKey && soundExists(options.soundKey)) {
      // For Expo Notifications, sound should be filename without extension
      // The file should be placed in appropriate platform folders
      const soundName = options.soundKey.replace('.wav', '');
      content.sound = soundName;

      // Also play sound immediately when sending notification
      // This ensures sound plays even if notification sound doesn't work
      playNotificationSound(options.soundKey).catch(() => {
        // Failed to play notification sound - silently skip
      });
    }

    // No image attachments needed - using emojis and icons in title/message

    await Notifications.scheduleNotificationAsync({
      content,
      trigger: null, // Send immediately
    });
    // Notification sẽ được lưu tự động qua listener
  } catch (error) {
    console.error("Error sending local notification:", error);
  }
}

// Sound assets mapping - only include files that exist
const soundAssets: Record<string, any> = {
  // Available sound files
  'kaching.wav': require('../assets/sounds/kaching.wav'),
};

// Check if sound file exists
export function soundExists(soundKey?: string): boolean {
  return soundKey ? soundAssets.hasOwnProperty(soundKey) : false;
}

// Play sound for in-app preview (bypass notification system)
export async function playNotificationSound(soundKey?: string): Promise<void> {
  if (!soundKey) return;

  try {
    // Check if sound file exists in our mapping
    const soundModule = soundAssets[soundKey];

    if (!soundModule) {
      // Sound file not found - silently skip in production
      return;
    }

    // Load the asset
    const asset = Asset.fromModule(soundModule);
    await asset.downloadAsync();

    // Create and play the sound
    const { sound } = await Audio.Sound.createAsync(
      { uri: asset.localUri || asset.uri }
    );

    await sound.playAsync();

    // Clean up after playing (3 seconds should be enough for short sounds)
    setTimeout(() => {
      sound.unloadAsync().catch(() => {/* Ignore cleanup errors */});
    }, 3000);

  } catch (error) {
    console.warn("Error playing notification sound:", error);
    // Don't throw error, just log it for graceful fallback
  }
}

// Schedule daily reminder
export async function scheduleDailyReminder(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Nhắc nhở chi tiêu 💸",
        body: "Đừng quên ghi chi tiêu hôm nay nha!",
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: 20,
        minute: 0,
        repeats: true,
      } as any,
    });
  } catch (error) {
    console.error("Error scheduling daily reminder:", error);
  }
}
