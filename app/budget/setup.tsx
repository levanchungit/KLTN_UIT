import { useTheme } from "@/app/providers/ThemeProvider";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

export default function BudgetSetupScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(
    () => makeStyles(colors, insets.bottom),
    [colors, insets.bottom]
  );

  const [income, setIncome] = useState("");
  const [desc, setDesc] = useState("");
  const [budgetName, setBudgetName] = useState("");
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">(
    "monthly"
  );
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    const incomeNum = parseFloat(income.replace(/[^0-9]/g, ""));
    if (!incomeNum || incomeNum <= 0) {
      alert("Vui lòng nhập thu nhập hợp lệ");
      return;
    }

    setLoading(true);
    try {
      // Navigate to suggest screen with params
      router.push({
        pathname: "/budget/suggest",
        params: {
          income: incomeNum.toString(),
          period,
          lifestyleDesc: desc || "",
          customBudgetName: budgetName || "",
        },
      });
    } catch (err) {
      console.error("handleCreate error:", err);
      alert("Có lỗi xảy ra, vui lòng thử lại");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <MaterialCommunityIcons
            name="arrow-left"
            size={24}
            color={colors.text}
          />
        </Pressable>
        <Text style={styles.headerTitle}>Thiết lập ngân sách</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
        keyboardVerticalOffset={0}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.infoCard}>
            Chúng tôi sẽ giúp bạn xây dựng kế hoạch thông minh theo quy tắc
            50/30/20 – 50% nhu cầu, 30% mong muốn, 20% tiết kiệm. Hãy cho biết
            thu nhập và lối sống của bạn.
          </Text>

          <Text style={styles.label}>Thu nhập (sau thuế)</Text>
          <View style={styles.inputBox}>
            <TextInput
              keyboardType="numeric"
              placeholder="vd: 10,000,000"
              placeholderTextColor={colors.subText}
              value={income}
              onChangeText={(text) => {
                // Format with commas
                const num = text.replace(/[^0-9]/g, "");
                if (num) {
                  const formatted = parseInt(num).toLocaleString("vi-VN");
                  setIncome(formatted);
                } else {
                  setIncome("");
                }
              }}
              style={styles.input}
            />
          </View>

          <Text style={styles.label}>Tên ngân sách (tùy chọn)</Text>
          <View style={styles.inputBox}>
            <TextInput
              placeholder="Để trống để tự động tạo tên"
              placeholderTextColor={colors.subText}
              value={budgetName}
              onChangeText={setBudgetName}
              style={styles.input}
            />
          </View>

          <Text style={styles.label}>Chu kỳ ngân sách</Text>
          <View style={styles.periodRow}>
            {(["daily", "weekly", "monthly"] as const).map((p) => (
              <Pressable
                key={p}
                onPress={() => setPeriod(p)}
                style={[
                  styles.periodButton,
                  period === p && styles.periodButtonActive,
                ]}
              >
                <Text
                  style={[
                    styles.periodButtonText,
                    period === p && styles.periodButtonTextActive,
                  ]}
                >
                  {p === "daily" && "Hằng ngày"}
                  {p === "weekly" && "Hằng tuần"}
                  {p === "monthly" && "Hằng tháng"}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Mô tả lối sống của bạn (tùy chọn)</Text>
          <View style={styles.lifestyleInputBox}>
            <TextInput
              multiline
              numberOfLines={6}
              placeholder="Ví dụ: thuê nhà 10 triệu, ăn ngoài 2 lần/tuần…"
              placeholderTextColor={colors.subText}
              value={desc}
              onChangeText={setDesc}
              style={styles.lifestyleInput}
              maxLength={500}
              textAlignVertical="top"
            />
          </View>
          <Text style={styles.helperText}>{desc.length}/500</Text>

          <Pressable
            style={[
              styles.createButton,
              loading && styles.createButtonDisabled,
            ]}
            onPress={handleCreate}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.createButtonText}>Tạo ngân sách của tôi</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (
  c: {
    background: string;
    card: string;
    text: string;
    subText: string;
    divider: string;
  },
  bottomInset: number
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: c.card,
      borderBottomWidth: 1,
      borderBottomColor: c.divider,
    },
    headerTitle: { fontSize: 18, fontWeight: "700", color: c.text },
    content: { padding: 16, paddingBottom: Math.max(bottomInset, 16) + 80 },
    infoCard: {
      backgroundColor: c.card,
      padding: 12,
      borderRadius: 12,
      fontSize: 13,
      lineHeight: 20,
      color: c.text,
      marginBottom: 16,
    },
    label: {
      fontSize: 14,
      fontWeight: "600",
      color: c.text,
      marginBottom: 8,
      marginTop: 16,
    },
    inputBox: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.divider,
      backgroundColor: c.card,
      paddingHorizontal: 12,
    },
    input: {
      fontSize: 15,
      color: c.text,
      paddingVertical: 12,
    },
    lifestyleInputBox: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.divider,
      backgroundColor: c.card,
      paddingHorizontal: 12,
      minHeight: 120,
    },
    lifestyleInput: {
      fontSize: 15,
      color: c.text,
      paddingVertical: 12,
      minHeight: 120,
      textAlignVertical: "top",
    },
    helperText: {
      fontSize: 12,
      color: c.subText,
      marginTop: 6,
      marginBottom: 4,
    },
    periodRow: {
      flexDirection: "row",
      gap: 8,
    },
    periodButton: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.divider,
      backgroundColor: c.card,
      alignItems: "center",
    },
    periodButtonActive: {
      borderColor: "#16A34A",
      backgroundColor: "#16A34A",
    },
    periodButtonText: {
      fontSize: 14,
      color: c.text,
    },
    periodButtonTextActive: {
      color: "#fff",
      fontWeight: "600",
    },
    createButton: {
      height: 48,
      borderRadius: 24,
      backgroundColor: "#16A34A",
      alignItems: "center",
      justifyContent: "center",
      marginTop: 32,
    },
    createButtonDisabled: {
      opacity: 0.5,
    },
    createButtonText: {
      color: "#fff",
      fontSize: 16,
      fontWeight: "600",
    },
  });
