import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Modal, Portal } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/app/providers/ThemeProvider';
import { playNotificationSound, sendLocalNotification, soundExists } from '@/services/notificationService';
import { FunnyNotification } from '@/data/funnyNotifications';

interface NotificationPreviewProps {
  visible: boolean;
  notification: FunnyNotification | null;
  onClose: () => void;
  onSend?: () => void;
}

export default function NotificationPreview({
  visible,
  notification,
  onClose,
  onSend,
}: NotificationPreviewProps) {
  const { colors } = useTheme();
  const [isPlayingSound, setIsPlayingSound] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const handlePlaySound = async () => {
    if (!notification?.soundKey || isPlayingSound) return;

    setIsPlayingSound(true);
    try {
      await playNotificationSound(notification.soundKey);
    } catch (error) {
      console.error('Error playing sound:', error);
      Alert.alert('Lỗi', 'Không thể phát âm thanh');
    } finally {
      setIsPlayingSound(false);
    }
  };

  const handleSendNotification = async () => {
    if (!notification || isSending) return;

    setIsSending(true);
    try {
      await sendLocalNotification(
        {
          title: notification.title,
          message: notification.message,
          type: notification.type === 'survival' || notification.type === 'drama' ? 'warning' : 'reminder',
        },
        {
          image: notification.imageKey ? `assets/images/funny/${notification.imageKey}` : undefined,
          soundKey: notification.soundKey,
        }
      );

      onSend?.();
      onClose();
    } catch (error) {
      console.error('Error sending notification:', error);
      Alert.alert('Lỗi', 'Không thể gửi thông báo');
    } finally {
      setIsSending(false);
    }
  };

  const getTypeColor = (type: FunnyNotification['type']) => {
    switch (type) {
      case 'tingting': return '#10B981'; // green
      case 'survival': return '#F59E0B'; // amber
      case 'drama': return '#EF4444'; // red
      case 'reminder': return '#3B82F6'; // blue
      default: return colors.primary;
    }
  };

  const getTypeLabel = (type: FunnyNotification['type']) => {
    switch (type) {
      case 'tingting': return 'TingTing';
      case 'survival': return 'Survival';
      case 'drama': return 'Drama';
      case 'reminder': return 'Reminder';
      default: return type;
    }
  };

  if (!notification) return null;

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onClose}
        contentContainerStyle={[styles.modal, { backgroundColor: colors.card }]}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.typeBadge, { backgroundColor: getTypeColor(notification.type) }]}>
            <Text style={styles.typeText}>{getTypeLabel(notification.type)}</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Image */}
        {notification.imageKey && (
          <View style={styles.imageContainer}>
            <Image
              source={{ uri: `assets/images/funny/${notification.imageKey}` }}
              style={styles.image}
              resizeMode="contain"
              onError={() => console.warn(`Failed to load image: ${notification.imageKey}`)}
            />
          </View>
        )}

        {/* Content */}
        <View style={styles.content}>
          <Text style={[styles.title, { color: colors.text }]}>
            {notification.title}
          </Text>
          <Text style={[styles.message, { color: colors.subText }]}>
            {notification.message}
          </Text>
        </View>

        {/* Sound Preview */}
        {notification.soundKey && soundExists(notification.soundKey) && (
          <View style={styles.soundSection}>
            <Text style={[styles.soundLabel, { color: colors.subText }]}>
              Âm thanh: {notification.soundKey}
            </Text>
            <TouchableOpacity
              style={[styles.soundButton, { backgroundColor: colors.background }]}
              onPress={handlePlaySound}
              disabled={isPlayingSound}
            >
              {isPlayingSound ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Ionicons name="volume-high" size={20} color={colors.primary} />
                  <Text style={[styles.soundButtonText, { color: colors.primary }]}>
                    Phát thử âm thanh
                  </Text>
                </>
              )}
            </TouchableOpacity>
            <Text style={[styles.soundNote, { color: colors.subText }]}>
              💡 Preview phát ngay | Notification sẽ phát sound khi gửi
            </Text>
          </View>
        )}

        {/* Sound Not Available */}
        {notification.soundKey && !soundExists(notification.soundKey) && (
          <View style={styles.soundSection}>
            <Text style={[styles.soundLabel, { color: colors.subText }]}>
              Âm thanh: {notification.soundKey} (chưa có file)
            </Text>
          </View>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.cancelButton, { backgroundColor: colors.divider }]}
            onPress={onClose}
          >
            <Text style={[styles.cancelButtonText, { color: colors.text }]}>Đóng</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sendButton, { backgroundColor: '#667eea' }]}
            onPress={handleSendNotification}
            disabled={isSending}
          >
            {isSending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="notifications" size={20} color="#fff" />
                <Text style={styles.sendButtonText}>Gửi thông báo thật</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modal: {
    margin: 20,
    borderRadius: 16,
    padding: 20,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  typeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  typeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  closeButton: {
    padding: 4,
  },
  imageContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  image: {
    width: 120,
    height: 120,
    borderRadius: 8,
  },
  content: {
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    lineHeight: 24,
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
  },
  soundSection: {
    marginBottom: 20,
  },
  soundLabel: {
    fontSize: 12,
    marginBottom: 8,
    textAlign: 'center',
  },
  soundButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 8,
  },
  soundButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  soundNote: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  sendButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    gap: 8,
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});