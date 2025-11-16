import { useTheme } from "@/app/providers/ThemeProvider";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button, Modal, Portal } from "react-native-paper";

interface Props {
  visible: boolean;
  title?: string;
  description?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function NotificationPrePermission({
  visible,
  title = "Cho phép nhận thông báo",
  description = "Ứng dụng sẽ gửi nhắc nhở để giúp bạn ghi chép chi tiêu đều đặn. Cho phép nhận thông báo để không bỏ lỡ các nhắc nhở quan trọng.",
  onConfirm,
  onCancel,
}: Props) {
  const { colors } = useTheme();

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onCancel}
        contentContainerStyle={[
          styles.container,
          { backgroundColor: colors.card },
        ]}
      >
        <View>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.desc, { color: colors.subText }]}>
            {description}
          </Text>

          <View style={styles.actions}>
            <Button mode="text" onPress={onCancel} compact>
              Không phải bây giờ
            </Button>
            <Button mode="contained" onPress={onConfirm} style={styles.confirm}>
              Cho phép
            </Button>
          </View>
        </View>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  container: {
    margin: 20,
    borderRadius: 12,
    padding: 18,
  },
  title: { fontSize: 18, fontWeight: "700", marginBottom: 8 },
  desc: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
  confirm: { marginLeft: 8 },
});
