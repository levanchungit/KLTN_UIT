import { db, openDb } from "@/db";
import { getCurrentUserId } from "@/utils/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { saveNotification, sendLocalNotification, playNotificationSound } from "./notificationService";
import funnyNotifications, { FunnyNotification } from "@/data/funnyNotifications";

const NOTIFICATION_LOG_KEY = "@notification_log";
const NOTIFICATION_SETTINGS_KEY = "@notification_settings";

type NotificationLog = {
  id: string;
  type: string;
  sentAt: number; // unix timestamp
  metadata?: any;
};

type NotificationSettings = {
  dailyReminderTime: { hour: number; minute: number };
  enableDaily: boolean;
  enableInactivity: boolean;
  enableBudget: boolean;
  enableWeekly: boolean;
  enableFunnyMode: boolean;
  funnyTheme: 'random' | 'tingting' | 'survival' | 'drama' | 'reminder';
};

const DEFAULT_SETTINGS: NotificationSettings = {
  dailyReminderTime: { hour: 19, minute: 0 },
  enableDaily: true,
  enableInactivity: true,
  enableBudget: true,
  enableWeekly: true,
  enableFunnyMode: false,
  funnyTheme: 'random',
};

// ===== Notification Log Management =====

async function getNotificationLog(userId?: string): Promise<NotificationLog[]> {
  if (!userId) {
    userId = await getCurrentUserId();
  }
  const key = `${NOTIFICATION_LOG_KEY}_${userId}`;
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function logNotification(type: string, metadata?: any, userId?: string) {
  if (!userId) {
    userId = await getCurrentUserId();
  }
  const key = `${NOTIFICATION_LOG_KEY}_${userId}`;
  const log = await getNotificationLog(userId);
  const now = Date.now();
  log.push({
    id: `${now}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    sentAt: now,
    metadata,
  });
  // Keep only last 100 entries
  const trimmed = log.slice(-100);
  await AsyncStorage.setItem(key, JSON.stringify(trimmed));
}

async function getSettings(userId?: string): Promise<NotificationSettings> {
  if (!userId) {
    userId = await getCurrentUserId();
  }
  const key = `${NOTIFICATION_SETTINGS_KEY}_${userId}`;
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function updateSettings(
  partial: Partial<NotificationSettings>,
  userId?: string
): Promise<void> {
  if (!userId) {
    userId = await getCurrentUserId();
  }
  const key = `${NOTIFICATION_SETTINGS_KEY}_${userId}`;
  const current = await getSettings(userId);
  const updated = { ...current, ...partial };
  await AsyncStorage.setItem(key, JSON.stringify(updated));
}

// ===== Anti-spam Rules =====

async function canSendNotification(
  type: string,
  userId?: string
): Promise<boolean> {
  if (!userId) {
    userId = await getCurrentUserId();
  }
  const log = await getNotificationLog(userId);
  const now = Date.now();
  const last24h = log.filter((n) => now - n.sentAt < 24 * 60 * 60 * 1000);

  // Rule 1: Max 3 notifications per day
  if (last24h.length >= 3) {
    console.log("Anti-spam: Max 3/day reached");
    return false;
  }

  // Rule 2: At least 1 hour between notifications
  if (last24h.length > 0) {
    const lastSent = Math.max(...last24h.map((n) => n.sentAt));
    if (now - lastSent < 60 * 60 * 1000) {
      console.log("Anti-spam: Need 1h gap");
      return false;
    }
  }

  return true;
}

async function sendSmartNotification(
  type: string,
  title: string,
  message: string,
  metadata?: any,
  options?: {
    bypassAntiSpam?: boolean;
    uiType?: "reminder" | "warning" | "info" | "success" | "error";
  },
  userId?: string
) {
  if (!userId) {
    userId = await getCurrentUserId();
  }
  if (!options?.bypassAntiSpam) {
    if (!(await canSendNotification(type, userId))) {
      console.log(`Skipped notification (anti-spam): ${type}`);
      return;
    }
  }

  await saveNotification(
    {
      title,
      message,
      type: options?.uiType ?? "reminder",
    },
    userId
  );
  await logNotification(type, metadata, userId);

  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body: message, sound: true },
      trigger: null,
    });
  } catch (err) {
    console.error("Error scheduling notification:", err);
  }
}

// Immediate budget notification that ignores anti-spam limits
async function sendBudgetNotificationImmediate(
  type: string,
  title: string,
  message: string,
  metadata?: any,
  userId?: string
) {
  if (!userId) {
    userId = await getCurrentUserId();
  }

  const settings = await getSettings(userId);

  // Use funny notification if enabled, otherwise use regular
  if (settings.enableFunnyMode) {
    return sendFunnyNotification({
      type: settings.funnyTheme === 'random' ? 'survival' : settings.funnyTheme,
      bypassAntiSpam: true,
    });
  } else {
    return sendSmartNotification(
      type,
      title,
      message,
      metadata,
      {
        bypassAntiSpam: true,
        uiType: "warning",
      },
      userId
    );
  }
}

// ===== 1) Daily Reminder =====

export async function checkDailyReminder() {
  const userId = await getCurrentUserId();
  const settings = await getSettings(userId);
  if (!settings.enableDaily) return;

  await openDb();

  // Check if user has recorded any transaction today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartSec = Math.floor(todayStart.getTime() / 1000);
  const nowSec = Math.floor(Date.now() / 1000);

  const todayTx = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM transactions 
     WHERE user_id=? AND occurred_at >= ? AND occurred_at <= ?`,
    [userId, todayStartSec, nowSec] as any
  );

  if ((todayTx?.count ?? 0) > 0) {
    // User already recorded transaction today, skipping daily reminder
    return;
  }

  // Check if already sent daily reminder today
  const log = await getNotificationLog(userId);
  const todaySent = log.find(
    (n) => n.type === "daily" && n.sentAt >= todayStart.getTime()
  );

  if (todaySent) {
    // Daily reminder already sent today
    return;
  }

  // Use funny notification if enabled, otherwise use regular
  if (settings.enableFunnyMode) {
    await sendFunnyNotification({
      type: settings.funnyTheme === 'random' ? undefined : settings.funnyTheme,
    });
  } else {
    await sendSmartNotification(
      "daily",
      "Nhắc nhở chi tiêu 💸",
      "Đừng quên ghi chi tiêu hôm nay nha!",
      undefined,
      undefined,
      userId
    );
  }
}

// ===== 2) Inactivity Reminder =====

export async function checkInactivityReminder() {
  const userId = await getCurrentUserId();
  const settings = await getSettings(userId);
  if (!settings.enableInactivity) return;

  await openDb();

  const nowSec = Math.floor(Date.now() / 1000);
  const lastTx = await db.getFirstAsync<{ occurred_at: number }>(
    `SELECT occurred_at FROM transactions 
     WHERE user_id=? ORDER BY occurred_at DESC LIMIT 1`,
    [userId] as any
  );

  if (!lastTx) return;

  const daysSinceLastTx = (nowSec - lastTx.occurred_at) / 86400;

  const log = await getNotificationLog(userId);
  const last24h = log.filter(
    (n) => Date.now() - n.sentAt < 24 * 60 * 60 * 1000
  );

  // Don't send if any notification sent in last 24h
  if (last24h.length > 0) {
    // Inactivity: Skip due to recent notification
    return;
  }

  // 3 days inactive → send once
  if (daysSinceLastTx >= 3 && daysSinceLastTx < 7) {
    const sent3day = log.find(
      (n) =>
        n.type === "inactivity_3d" &&
        Date.now() - n.sentAt < 7 * 24 * 60 * 60 * 1000
    );
    if (!sent3day) {
      if (settings.enableFunnyMode) {
        await sendFunnyNotification({
          type: settings.funnyTheme === 'random' ? 'survival' : settings.funnyTheme,
        });
      } else {
        await sendSmartNotification(
          "inactivity_3d",
          "Bạn ổn chứ? 🤔",
          "Đã 3 ngày bạn chưa ghi chi tiêu. Hãy cập nhật để theo dõi tốt hơn nhé!",
          undefined,
          undefined,
          userId
        );
      }
    }
  }

  // 7 days inactive → send once
  if (daysSinceLastTx >= 7) {
    const sent7day = log.find(
      (n) =>
        n.type === "inactivity_7d" &&
        Date.now() - n.sentAt < 7 * 24 * 60 * 60 * 1000
    );
    if (!sent7day) {
      if (settings.enableFunnyMode) {
        await sendFunnyNotification({
          type: settings.funnyTheme === 'random' ? 'survival' : settings.funnyTheme,
        });
      } else {
        await sendSmartNotification(
          "inactivity_7d",
          "Chúng tôi nhớ bạn! 💙",
          "Đã 1 tuần rồi! Quay lại ghi chi tiêu để kiểm soát tài chính tốt hơn nhé.",
          undefined,
          undefined,
          userId
        );
      }
    }
  }
}

// ===== 3) Budget Alert =====

export async function checkBudgetAlert(categoryId: string, amount: number) {
  const userId = await getCurrentUserId();
  const settings = await getSettings(userId);
  if (!settings.enableBudget) return;

  await openDb();

  // Get active budget
  const nowSec = Math.floor(Date.now() / 1000);
  const budget = await db.getFirstAsync<{ id: string; start_date: number }>(
    `SELECT id, start_date FROM budgets
     WHERE user_id=? AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)
     ORDER BY start_date DESC LIMIT 1`,
    [userId, nowSec, nowSec] as any
  );

  if (!budget) return;

  // Get allocation for this category
  const alloc = await db.getFirstAsync<{
    allocated_amount: number;
    category_name: string;
  }>(
    `SELECT ba.allocated_amount, c.name as category_name
     FROM budget_allocations ba
     JOIN categories c ON c.id = ba.category_id
     WHERE ba.budget_id=? AND ba.category_id=?`,
    [budget.id, categoryId] as any
  );

  if (!alloc) return;

  // Calculate total spent in current budget period
  const spent = await db.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE user_id=? AND category_id=? AND occurred_at >= ? AND type='expense'`,
    [userId, categoryId, budget.start_date] as any
  );

  const totalSpent = (spent?.total ?? 0) + amount;
  const percent = (totalSpent / alloc.allocated_amount) * 100;

  // Send only the most severe threshold reached, immediately (no anti-spam)
  if (percent >= 100) {
    await sendBudgetNotificationImmediate(
      "budget_100",
      "Vượt ngân sách! 🔴",
      `Danh mục "${alloc.category_name}" đã vượt ngân sách!`,
      { categoryId, percent: 100 }
    );
    return;
  }
  if (percent >= 90) {
    await sendBudgetNotificationImmediate(
      "budget_90",
      "Gần vượt ngân sách! 🚨",
      `Danh mục "${alloc.category_name}" đã đạt 90% ngân sách!`,
      { categoryId, percent: 90 }
    );
    return;
  }
  if (percent >= 70) {
    await sendBudgetNotificationImmediate(
      "budget_70",
      "Cảnh báo ngân sách ⚠️",
      `Danh mục "${alloc.category_name}" đã đạt 70% ngân sách!`,
      { categoryId, percent: 70 }
    );
  }
}

// Trigger threshold notifications for all allocations in a budget immediately
export async function triggerBudgetAlertsForBudget(budgetId: string) {
  await openDb();
  // Get budget info
  const budget = await db.getFirstAsync<{ id: string; start_date: number }>(
    `SELECT id, start_date FROM budgets WHERE id=?`,
    [budgetId] as any
  );
  if (!budget) return;

  // Get allocations with category names
  const allocations = await db.getAllAsync<{
    category_id: string;
    allocated_amount: number;
    category_name: string;
  }>(
    `SELECT ba.category_id, ba.allocated_amount, c.name as category_name
     FROM budget_allocations ba
     JOIN categories c ON c.id = ba.category_id
     WHERE ba.budget_id=?`,
    [budget.id] as any
  );

  const userId = await getCurrentUserId();

  for (const alloc of allocations) {
    // Calculate spent since budget start
    const spent = await db.getFirstAsync<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
       WHERE user_id=? AND category_id=? AND occurred_at >= ? AND type='expense'`,
      [userId, alloc.category_id, budget.start_date] as any
    );
    const totalSpent = spent?.total ?? 0;
    const percent =
      alloc.allocated_amount > 0
        ? (totalSpent / alloc.allocated_amount) * 100
        : 0;

    if (percent >= 100) {
      await sendBudgetNotificationImmediate(
        "budget_100",
        "Vượt ngân sách! 🔴",
        `Danh mục "${alloc.category_name}" đã vượt ngân sách!`,
        { categoryId: alloc.category_id, percent: 100 }
      );
      continue;
    }
    if (percent >= 90) {
      await sendBudgetNotificationImmediate(
        "budget_90",
        "Gần vượt ngân sách! 🚨",
        `Danh mục "${alloc.category_name}" đã đạt 90% ngân sách!`,
        { categoryId: alloc.category_id, percent: 90 }
      );
      continue;
    }
    if (percent >= 70) {
      await sendBudgetNotificationImmediate(
        "budget_70",
        "Cảnh báo ngân sách ⚠️",
        `Danh mục "${alloc.category_name}" đã đạt 70% ngân sách!`,
        { categoryId: alloc.category_id, percent: 70 }
      );
    }
  }
}

// ===== 4) Weekly Insight =====

export async function checkWeeklyInsight() {
  const userId = await getCurrentUserId();
  const settings = await getSettings(userId);
  if (!settings.enableWeekly) return;

  await openDb();

  // Calculate this week and last week spending
  const now = new Date();
  const thisWeekStart = new Date(now);
  thisWeekStart.setDate(now.getDate() - now.getDay()); // Sunday
  thisWeekStart.setHours(0, 0, 0, 0);

  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const thisWeekSec = Math.floor(thisWeekStart.getTime() / 1000);
  const lastWeekSec = Math.floor(lastWeekStart.getTime() / 1000);
  const nowSec = Math.floor(Date.now() / 1000);

  const thisWeek = await db.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE user_id=? AND type='expense' AND occurred_at >= ? AND occurred_at < ?`,
    [userId, thisWeekSec, nowSec] as any
  );

  const lastWeek = await db.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE user_id=? AND type='expense' AND occurred_at >= ? AND occurred_at < ?`,
    [userId, lastWeekSec, thisWeekSec] as any
  );

  const thisTotal = thisWeek?.total ?? 0;
  const lastTotal = lastWeek?.total ?? 0;

  if (lastTotal === 0) return;

  const changePercent = Math.abs(((thisTotal - lastTotal) / lastTotal) * 100);

  if (changePercent < 10) {
    // Weekly spending change < 10%, skipping insight
    return;
  }

  // Check if already sent this week
  const log = await getNotificationLog(userId);
  const thisWeekSent = log.find(
    (n) => n.type === "weekly" && n.sentAt >= thisWeekStart.getTime()
  );

  if (thisWeekSent) {
    // Weekly insight already sent this week
    return;
  }

  const trend = thisTotal > lastTotal ? "tăng" : "giảm";
  const emoji = thisTotal > lastTotal ? "📈" : "📉";

  // Use funny notification if enabled, otherwise use regular
  if (settings.enableFunnyMode) {
    await sendFunnyNotification({
      type: settings.funnyTheme === 'random' ? undefined : settings.funnyTheme,
    });
  } else {
    await sendSmartNotification(
      "weekly",
      `Báo cáo tuần ${emoji}`,
      `Chi tiêu tuần này ${trend} ${Math.round(
        changePercent
      )}% so với tuần trước!`,
      undefined,
      undefined,
      userId
    );
  }
}

// ===== Background Task Scheduler =====

export async function initSmartNotifications() {
  // Initializing smart notifications...

  const userId = await getCurrentUserId();
  // Schedule daily reminder
  const settings = await getSettings(userId);
  if (settings.enableDaily) {
    await Notifications.cancelAllScheduledNotificationsAsync();
    await Notifications.scheduleNotificationAsync({
      content: {
        // nhắc nhở kiểm tra chi tiêu hàng ngày
        title: "Nhắc nhở chi tiêu 💸",
        body: "Đừng quên ghi chi tiêu hôm nay nha!",
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: settings.dailyReminderTime.hour,
        minute: settings.dailyReminderTime.minute,
        repeats: true,
      } as any,
    });
  }

  // Check inactivity and weekly on app open
  checkInactivityReminder().catch(console.error);

  // Check weekly insight if it's Sunday evening
  const now = new Date();
  if (now.getDay() === 0 && now.getHours() === 20) {
    checkWeeklyInsight().catch(console.error);
  }
}

// ===== Funny Notifications =====

// Select a funny notification based on type and time preferences
export function selectFunnyNotification(options?: {
  type?: FunnyNotification['type'];
  timeOfDay?: Date;
}): FunnyNotification | null {
  const now = options?.timeOfDay || new Date();
  const hour = now.getHours();
  const dayOfMonth = now.getDate();

  // Filter by type if specified
  let candidates = options?.type
    ? funnyNotifications.filter(n => n.type === options.type)
    : funnyNotifications;

  if (candidates.length === 0) return null;

  // Apply time-based preferences (boost certain types at specific times)
  const timePreferences: Record<string, FunnyNotification['type'][]> = {
    // Lunch time (12-13) - prefer food/survival notifications
    'lunch': ['survival', 'tingting'],
    // Evening (21-22) - prefer drama/summary notifications
    'evening': ['drama', 'reminder'],
    // Mid/end month (15, 30) - prefer salary/tingting notifications
    'month_end': ['tingting', 'survival']
  };

  let preferredTypes: FunnyNotification['type'][] = [];
  if (hour >= 12 && hour <= 13) {
    preferredTypes = timePreferences.lunch;
  } else if (hour >= 21 && hour <= 22) {
    preferredTypes = timePreferences.evening;
  } else if (dayOfMonth === 15 || dayOfMonth >= 28) {
    preferredTypes = timePreferences.month_end;
  }

  // Boost weight for preferred types
  const weightedCandidates = candidates.map(notification => ({
    ...notification,
    effectiveWeight: preferredTypes.includes(notification.type)
      ? (notification.weight || 1) * 2
      : (notification.weight || 1)
  }));

  // Select randomly based on weights
  const totalWeight = weightedCandidates.reduce((sum, n) => sum + n.effectiveWeight, 0);
  let random = Math.random() * totalWeight;

  for (const candidate of weightedCandidates) {
    random -= candidate.effectiveWeight;
    if (random <= 0) {
      return candidate;
    }
  }

  // Fallback to first candidate
  return candidates[0];
}

// Send a funny notification (with optional bypass for testing/preview)
export async function sendFunnyNotification(options?: {
  type?: FunnyNotification['type'];
  bypassAntiSpam?: boolean;
  previewOnly?: boolean; // If true, only play sound without sending actual notification
}): Promise<void> {
  const selectedNotification = selectFunnyNotification({ type: options?.type });

  if (!selectedNotification) {
    console.warn("No funny notification available for the given criteria");
    return;
  }

  const userId = await getCurrentUserId();

  if (options?.previewOnly) {
    // Only play sound for preview
    await playNotificationSound(selectedNotification.soundKey);
    return;
  }

  // Check anti-spam unless bypassed
  if (!options?.bypassAntiSpam) {
    if (!(await canSendNotification(`funny_${selectedNotification.type}`, userId))) {
      console.log(`Skipped funny notification (anti-spam): ${selectedNotification.type}`);
      return;
    }
  }

  // Save to in-app notification storage
  await saveNotification(
    {
      title: selectedNotification.title,
      message: selectedNotification.message,
      type: selectedNotification.type === 'survival' || selectedNotification.type === 'drama' ? 'warning' : 'reminder',
    },
    userId
  );

  // Log the notification
  await logNotification(`funny_${selectedNotification.type}`, {
    imageKey: selectedNotification.imageKey,
    soundKey: selectedNotification.soundKey
  }, userId);

  // Send local notification with image and sound
  await sendLocalNotification(
    {
      title: selectedNotification.title,
      message: selectedNotification.message,
      type: selectedNotification.type === 'survival' || selectedNotification.type === 'drama' ? 'warning' : 'reminder',
    },
    {
      image: selectedNotification.imageKey ? `assets/images/funny/${selectedNotification.imageKey}` : undefined,
      soundKey: selectedNotification.soundKey
    }
  );
}

// Export settings for UI
export { getSettings };
