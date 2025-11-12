import { useTheme } from "@/app/providers/ThemeProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { listAccounts } from "@/repos/accountRepo";
import { listCategories, type Category } from "@/repos/categoryRepo";
import {
  addExpense,
  addIncome,
  getTxById,
  updateTransaction,
} from "@/repos/transactionRepo";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import CalendarPicker from "react-native-calendar-picker";
import { Modal, Portal } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";

type TransactionType = "expense" | "income";

// Vietnamese calendar constants (giống dashboard)
const VI_MONTHS = [
  "tháng 1",
  "tháng 2",
  "tháng 3",
  "tháng 4",
  "tháng 5",
  "tháng 6",
  "tháng 7",
  "tháng 8",
  "tháng 9",
  "tháng 10",
  "tháng 11",
  "tháng 12",
];
const VI_WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

export default function AddTransactionScreen() {
  const { colors, mode } = useTheme();
  const { t } = useI18n();
  const params = useLocalSearchParams();
  const txId = params.id as string | undefined;
  const isEditMode = !!txId;

  const [type, setType] = useState<TransactionType>("expense");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(
    null
  );
  const [categories, setCategories] = useState<Category[]>([]);
  const [showCalendar, setShowCalendar] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isEditMode && txId) {
      loadTransaction();
    }
  }, [txId]);

  useEffect(() => {
    loadCategories();
  }, [type]);

  const loadTransaction = async () => {
    if (!txId) return;
    setLoading(true);
    try {
      const tx = await getTxById(txId);
      if (tx) {
        setType(tx.type as TransactionType);
        setAmount(String(tx.amount));
        setNote(tx.note || "");
        setSelectedDate(new Date(tx.occurred_at * 1000));
        // Category will be set after loadCategories
      }
    } catch (error) {
      console.error("Error loading transaction:", error);
      Alert.alert("Lỗi", "Không thể tải giao dịch");
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    const cats = await listCategories({ type });
    setCategories(cats);

    // If editing, find and set the category from transaction
    if (isEditMode && txId) {
      const tx = await getTxById(txId);
      if (tx && tx.category_id) {
        const cat = cats.find((c) => c.id === tx.category_id);
        if (cat) {
          setSelectedCategory(cat);
        }
      }
    } else {
      // Auto-select first category for new transaction
      if (cats.length > 0 && !selectedCategory) {
        setSelectedCategory(cats[0]);
      }
    }
  };

  const formatDate = (date: Date) => {
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const year = date.getFullYear();

    // Format: "12 thg 8, 2024" (giống dashboard)
    return `${day} thg ${month}, ${year}`;
  };

  const handleSave = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      Alert.alert(t("error"), "Vui lòng nhập số tiền hợp lệ");
      return;
    }

    if (!selectedCategory) {
      Alert.alert(t("error"), "Vui lòng chọn danh mục");
      return;
    }

    try {
      const accounts = await listAccounts();
      const defaultAccount =
        accounts.find((a: any) => a.include_in_total === 1) || accounts[0];

      if (!defaultAccount) {
        Alert.alert(t("error"), "Không tìm thấy tài khoản");
        return;
      }

      if (isEditMode && txId) {
        // Update existing transaction
        await updateTransaction({
          id: txId,
          accountId: defaultAccount.id,
          categoryId: selectedCategory.id,
          type,
          amount: parseFloat(amount),
          note: note.trim(),
          when: selectedDate,
        });
        Alert.alert("Thành công", "Đã cập nhật giao dịch");
      } else {
        // Create new transaction
        const txData = {
          accountId: defaultAccount.id,
          categoryId: selectedCategory.id,
          amount: parseFloat(amount),
          note: note.trim(),
          when: selectedDate,
          updatedAt: new Date(),
        };

        if (type === "expense") {
          await addExpense(txData as any);
        } else {
          await addIncome(txData as any);
        }
        Alert.alert("Thành công", "Đã thêm giao dịch");
      }

      router.back();
    } catch (error) {
      console.error("Error saving transaction:", error);
      Alert.alert(t("error"), "Không thể lưu giao dịch");
    }
  };

  const getCategoryIcon = (iconName: string | null | undefined) => {
    if (!iconName) return "help-circle-outline";

    // Remove prefix if exists
    if (iconName.startsWith("mc:")) {
      return iconName.replace("mc:", "");
    }
    if (iconName.startsWith("mi:")) {
      const iconMap: Record<string, string> = {
        "directions-car": "car",
        "flight-takeoff": "airplane-takeoff",
        assignment: "file-document-outline",
        pets: "paw",
        "credit-card": "credit-card-outline",
      };
      const miName = iconName.replace("mi:", "");
      return iconMap[miName] || "help-circle-outline";
    }

    return iconName;
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
      backgroundColor: colors.card,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.text,
    },
    closeButton: {
      padding: 4,
    },
    content: {
      flex: 1,
    },
    typeToggle: {
      flexDirection: "row",
      marginHorizontal: 16,
      marginTop: 16,
      marginBottom: 24,
      borderRadius: 12,
      backgroundColor: colors.card,
      padding: 4,
    },
    typeButton: {
      flex: 1,
      paddingVertical: 12,
      alignItems: "center",
      borderRadius: 10,
    },
    typeButtonActive: {
      backgroundColor: "#1D4ED8",
    },
    typeButtonText: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.subText,
    },
    typeButtonTextActive: {
      color: "#fff",
    },
    section: {
      marginBottom: 20,
      paddingHorizontal: 16,
    },
    label: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.text,
      marginBottom: 12,
    },
    dateRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.card,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    dateText: {
      fontSize: 15,
      color: colors.text,
      fontWeight: "500",
    },
    input: {
      backgroundColor: colors.card,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 15,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    categoryGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 16,
      justifyContent: "space-between",
    },
    categoryItem: {
      width: "30%",
      minWidth: 90,
      aspectRatio: 1,
      backgroundColor: colors.card,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      borderWidth: 2,
      borderColor: "transparent",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    categoryItemSelected: {
      borderColor: "#1D4ED8",
      backgroundColor: mode === "dark" ? "#1E3A8A" : "#EFF6FF",
      shadowColor: "#1D4ED8",
      shadowOpacity: 0.2,
      shadowRadius: 4,
      elevation: 3,
    },
    categoryIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
    },
    categoryName: {
      fontSize: 11,
      fontWeight: "600",
      color: colors.text,
      textAlign: "center",
      paddingHorizontal: 4,
    },
    editButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 4,
      marginBottom: 12,
    },
    editButtonText: {
      fontSize: 14,
      fontWeight: "600",
      color: "#1D4ED8",
    },
    saveButton: {
      marginHorizontal: 16,
      marginVertical: 20,
      backgroundColor: "#1D4ED8",
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: "center",
    },
    saveButtonText: {
      fontSize: 16,
      fontWeight: "700",
      color: "#fff",
    },
  });

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={() => router.back()}
        >
          <MaterialCommunityIcons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isEditMode ? "Chỉnh sửa giao dịch" : t("addTransaction")}
        </Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView style={styles.content}>
        {/* Type Toggle */}
        <View style={styles.typeToggle}>
          <TouchableOpacity
            style={[
              styles.typeButton,
              type === "expense" && styles.typeButtonActive,
            ]}
            onPress={() => {
              setType("expense");
              setSelectedCategory(null);
            }}
          >
            <Text
              style={[
                styles.typeButtonText,
                type === "expense" && styles.typeButtonTextActive,
              ]}
            >
              {t("expenditure")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.typeButton,
              type === "income" && styles.typeButtonActive,
            ]}
            onPress={() => {
              setType("income");
              setSelectedCategory(null);
            }}
          >
            <Text
              style={[
                styles.typeButtonText,
                type === "income" && styles.typeButtonTextActive,
              ]}
            >
              {t("revenue")}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Time */}
        <View style={styles.section}>
          <Text style={styles.label}>{t("time")}</Text>
          <TouchableOpacity
            style={styles.dateRow}
            onPress={() => setShowCalendar(true)}
          >
            <MaterialCommunityIcons
              name="chevron-left"
              size={20}
              color={colors.text}
              onPress={() => {
                const newDate = new Date(selectedDate);
                newDate.setDate(newDate.getDate() - 1);
                setSelectedDate(newDate);
              }}
            />
            <Text style={styles.dateText}>{formatDate(selectedDate)}</Text>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={colors.text}
              onPress={() => {
                const newDate = new Date(selectedDate);
                newDate.setDate(newDate.getDate() + 1);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                newDate.setHours(0, 0, 0, 0);
                if (newDate <= today) {
                  setSelectedDate(newDate);
                }
              }}
            />
          </TouchableOpacity>
        </View>

        {/* Amount */}
        <View style={styles.section}>
          <Text style={styles.label}>{t("amount")}</Text>
          <View style={{ position: "relative" }}>
            <TextInput
              style={[styles.input, { paddingRight: 40 }]}
              placeholder={t("enterAmount")}
              placeholderTextColor={colors.subText}
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
            />
            <Text
              style={{
                position: "absolute",
                right: 16,
                top: 14,
                fontSize: 15,
                color: colors.subText,
                fontWeight: "500",
              }}
            >
              đ
            </Text>
          </View>
        </View>

        {/* Note */}
        <View style={styles.section}>
          <Text style={styles.label}>{t("note")}</Text>
          <TextInput
            style={[styles.input, { minHeight: 60 }]}
            placeholder={t("enterNotes")}
            placeholderTextColor={colors.subText}
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        {/* Category */}
        <View style={styles.section}>
          <View style={styles.editButton}>
            <Text style={styles.label}>{t("category")}</Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              onPress={() => router.push("/setting/categories")}
            >
              <Text style={styles.editButtonText}>{t("editCategory")}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.categoryGrid}>
            {categories.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.categoryItem,
                  selectedCategory?.id === cat.id &&
                    styles.categoryItemSelected,
                ]}
                onPress={() => setSelectedCategory(cat)}
              >
                <View
                  style={[
                    styles.categoryIcon,
                    {
                      backgroundColor:
                        selectedCategory?.id === cat.id
                          ? "#1D4ED8"
                          : cat.color ||
                            (mode === "dark" ? colors.background : "#F3F4F6"),
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={getCategoryIcon(cat.icon) as any}
                    size={24}
                    color={
                      selectedCategory?.id === cat.id
                        ? "#fff"
                        : cat.color
                        ? "#fff"
                        : colors.text
                    }
                  />
                </View>
                <Text
                  style={styles.categoryName}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  {cat.name}
                </Text>
              </TouchableOpacity>
            ))}
            {/* Spacer để fill khoảng trống khi số item không chia hết cho 3 */}
            {categories.length % 3 === 2 && (
              <View
                style={[
                  styles.categoryItem,
                  { opacity: 0, pointerEvents: "none" },
                ]}
              />
            )}
          </View>
        </View>
      </ScrollView>

      {/* Save Button */}
      <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
        <Text style={styles.saveButtonText}>{t("save")}</Text>
      </TouchableOpacity>

      {/* Calendar Modal - Giống Dashboard */}
      <Portal>
        <Modal
          visible={showCalendar}
          onDismiss={() => setShowCalendar(false)}
          contentContainerStyle={{
            marginHorizontal: 24,
            borderRadius: 16,
            backgroundColor: colors.card,
            padding: 12,
            alignSelf: "center",
            width: 360,
            maxWidth: "95%",
          }}
        >
          <CalendarPicker
            selectedStartDate={selectedDate}
            onDateChange={(date: any) => {
              setSelectedDate(date instanceof Date ? date : new Date(date));
            }}
            minDate={new Date(1970, 0, 1)}
            maxDate={new Date()}
            weekdays={VI_WEEKDAYS}
            months={VI_MONTHS}
            previousTitle="‹"
            nextTitle="›"
            todayBackgroundColor="#E6F7FF"
            selectedDayColor="#10B981"
            selectedDayTextColor="#fff"
            textStyle={{ color: colors.text }}
          />
          <View
            style={{
              flexDirection: "row",
              justifyContent: "flex-end",
              marginTop: 8,
            }}
          >
            <TouchableOpacity
              onPress={() => setShowCalendar(false)}
              style={{ padding: 10 }}
            >
              <Text style={{ color: "#10B981", fontWeight: "600" }}>Huỷ</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setShowCalendar(false);
              }}
              style={{ padding: 10 }}
            >
              <Text style={{ color: "#10B981", fontWeight: "700" }}>Xong</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      </Portal>
    </SafeAreaView>
  );
}
