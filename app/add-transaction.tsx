import { useTheme } from "@/app/providers/ThemeProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { listAccounts } from "@/repos/accountRepo";
import { listCategories, type Category } from "@/repos/categoryRepo";
import {
  addExpense,
  addIncome,
  deleteTx,
  getTxById,
  updateTransaction,
} from "@/repos/transactionRepo";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
} from "react-native";
import CalendarPicker from "react-native-calendar-picker";
import { Modal, Portal } from "react-native-paper";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

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
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams();
  const txId = params.id as string | undefined;
  const isEditMode = !!txId;

  const [type, setType] = useState<TransactionType>("expense");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [loading, setLoading] = useState(false);

  // ── Calculator state ──────────────────────────────────────────────────────
  const [showCalc, setShowCalc] = useState(false);
  // expression: biểu thức đang xây dựng, hiển thị ở dòng nhỏ trên
  const [calcExpr, setCalcExpr] = useState("");
  // calcResult: kết quả sau khi bấm "=", hiển thị dòng to đậm dưới, null khi chưa có
  const [calcResult, setCalcResult] = useState<string | null>(null);
  const calcSlideAnim = React.useRef(new Animated.Value(300)).current;

  useEffect(() => {
    loadInitialData();
  }, [txId, type]);

  // If launched with text param (from widget), try to parse amount and note
  useEffect(() => {
    const textParam = params.text as string | undefined;
    if (textParam && !isEditMode) {
      const trimmed = textParam.trim();
      // Try to match a leading number like "50 cafe" or "1,000.50 taxi"
      const m = trimmed.match(/^([0-9.,]+)\s*(.*)$/);
      if (m) {
        const rawNum = m[1];
        const rest = m[2] || "";
        // Normalize number: remove thousand separators (commas)
        const normalized = rawNum.replace(/,/g, "");
        const n = parseFloat(normalized);
        if (!isNaN(n)) {
          setAmount(String(n));
        }
        if (rest) setNote(rest.trim());
      } else {
        setNote(trimmed);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.text]);

  // Removed duplicated loadCategories useEffect, bundled in loadInitialData
  const loadInitialData = async () => {
    setLoading(true);
    try {
      const accs = await listAccounts();
      setAccounts(accs);
      const cats = await listCategories({ type });
      setCategories(cats);

      let currentCat = selectedCategory;
      let currentAcc = selectedAccount;

      if (isEditMode && txId) {
        const tx = await getTxById(txId);
        if (tx) {
          setType(tx.type as TransactionType);
          setAmount(tx.amount.toLocaleString("vi-VN"));
          setNote(tx.note || "");
          setSelectedDate(new Date(tx.occurred_at * 1000));
          currentCat = cats.find((c) => c.id === tx.category_id) || null;
          currentAcc = accs.find((a: any) => a.id === tx.account_id) || null;
        }
      }
      
      setSelectedCategory(currentCat || cats[0] || null);
      setSelectedAccount(currentAcc || accs.find((a: any) => a.include_in_total === 1) || accs[0] || null);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
    }
  };

  // ── Calculator helpers ────────────────────────────────────────────────────
  const openCalc = () => {
    const raw = amount.replace(/[^0-9]/g, "");
    // Nếu đã có số tiền, nạp vào làm dòng biểu thức
    setCalcExpr(raw || "");
    setCalcResult(null);
    setShowCalc(true);
    Animated.spring(calcSlideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 70,
      friction: 12,
    }).start();
  };

  const closeCalc = () => {
    Animated.timing(calcSlideAnim, {
      toValue: 300,
      duration: 180,
      useNativeDriver: true,
    }).start(() => setShowCalc(false));
  };

  const applyCalcResult = () => {
    // Ưu tiên lấy kết quả sau =, nếu chưa có thì nhập thẳng
    const val = calcResult ?? calcExpr;
    const num = parseFloat(val.replace(/[^0-9.]/g, ""));
    if (!isNaN(num) && num > 0) {
      setAmount(Math.round(num).toLocaleString("vi-VN"));
    }
    closeCalc();
  };

  const isOperator = (ch: string) => ["+", "-", "×", "÷", "%"].includes(ch);

  const handleCalcKey = (key: string) => {
    Vibration.vibrate(15);

    // ─ CLEAR ─
    if (key === "C") {
      setCalcExpr("");
      setCalcResult(null);
      return;
    }

    // ─ BACKSPACE ─
    if (key === "⌫") {
      if (calcResult !== null) {
        // Khi đang ở trạng thái kết quả, backspace xoá bỏ kết quả và đưa về cương
        setCalcExpr("");
        setCalcResult(null);
      } else {
        setCalcExpr((p) => p.slice(0, -1));
      }
      return;
    }

    // ─ EQUALS ─
    if (key === "=") {
      // Nếu đã có kết quả → bấm = lần 2: gán vào input và đóng
      if (calcResult !== null && calcResult !== "Lỗi") {
        applyCalcResult();
        return;
      }
      const expr = calcExpr.trim();
      if (!expr) return;
      try {
        const normalized = expr
          .replace(/×/g, "*")
          .replace(/÷/g, "/")
          .replace(/%/g, "/100");
        // eslint-disable-next-line no-new-func
        const raw = Function(`"use strict"; return (${normalized})`)();
        if (typeof raw === "number" && isFinite(raw)) {
          setCalcResult(String(Math.round(raw * 1000) / 1000));
        } else {
          setCalcResult("Lỗi");
        }
      } catch {
        setCalcResult("Lỗi");
      }
      return;
    }

    // ─ +/- Toggle sign ─
    if (key === "+/-") {
      if (calcResult !== null) {
        const n = parseFloat(calcResult);
        if (!isNaN(n)) {
          const toggled = String(-n);
          setCalcResult(toggled);
          setCalcExpr(toggled);
        }
      } else {
        // Toggle dấu số cuối cùng trong biểu thức
        setCalcExpr((p) => {
          const parts = p.split(/([+\-×÷%])/);
          const last = parts[parts.length - 1];
          if (!last) return p;
          const n = parseFloat(last);
          if (isNaN(n)) return p;
          parts[parts.length - 1] = String(-n);
          return parts.join("");
        });
      }
      return;
    }

    // ─ Sau khi có kết quả (= đã bấm) ─
    if (calcResult !== null) {
      if (isOperator(key)) {
        // Tiếp tục tính từ kết quả
        setCalcExpr(calcResult + key);
        setCalcResult(null);
      } else {
        // Bắt đầu biểu thức mới
        setCalcExpr(key);
        setCalcResult(null);
      }
      return;
    }

    // ─ Không cho nhập nhiều dấu chấm thập phân ─
    if (key === ".") {
      // Tìm số cuối cùng sau operator
      const parts = calcExpr.split(/[+\-×÷%]/);
      const lastNum = parts[parts.length - 1];
      if (lastNum.includes(".")) return;
    }

    // ─ Không cho 2 operator liền nhau ─
    if (isOperator(key)) {
      const last = calcExpr[calcExpr.length - 1];
      if (!calcExpr || isOperator(last)) {
        // Thay operator cuối bằng operator mới
        if (isOperator(last)) {
          setCalcExpr((p) => p.slice(0, -1) + key);
        } else if (!calcExpr) {
          // Bắt đầu với operator (ví dụ dấu trừ âm)
          if (key === "-") setCalcExpr("-");
        }
        return;
      }
    }

    setCalcExpr((p) => p + key);
  };

  // Format biểu thức để hiển thị đập (thêm khoảng cách quanh operator)
  const formatExprDisplay = (expr: string) =>
    expr.replace(/([+\-×÷%])/g, " $1 ").trim();

  const calcKeys = [
    ["C", "+/-", "%", "÷"],
    ["7", "8", "9", "×"],
    ["4", "5", "6", "-"],
    ["1", "2", "3", "+"],
    [".", "0", "⌫", "="],
  ];


  const formatDate = (date: Date) => {
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const year = date.getFullYear();

    // Format: "12 thg 8, 2024" (giống dashboard)
    return `${day} thg ${month}, ${year}`;
  };

  const handleSave = async () => {
    // Parse formatted amount (remove commas)
    const parsedAmount = parseFloat(amount.replace(/[^0-9]/g, ""));
    if (!amount || parsedAmount <= 0) {
      Alert.alert(t("error"), t("enterValidAmount"));
      return;
    }

    if (!selectedCategory) {
      Alert.alert(t("error"), t("selectCategory"));
      return;
    }

    try {
      if (!selectedAccount) {
        Alert.alert(t("error"), t("accountNotFound"));
        return;
      }

      if (isEditMode && txId) {
        // Update existing transaction
        await updateTransaction({
          id: txId,
          accountId: selectedAccount.id,
          categoryId: selectedCategory.id,
          type,
          amount: parsedAmount,
          note: note.trim(),
          when: selectedDate,
        });
      } else {
        // Create new transaction
        const txData = {
          accountId: selectedAccount.id,
          categoryId: selectedCategory.id,
          amount: parsedAmount,
          note: note.trim(),
          when: selectedDate,
          updatedAt: new Date(),
        };

        if (type === "expense") {
          await addExpense(txData as any);
        } else {
          await addIncome(txData as any);
        }
        Alert.alert(t("success"), t("transactionAdded"));
      }

      router.back();
    } catch (error) {
      console.error("Error saving transaction:", error);
      Alert.alert(t("error"), t("cannotSaveTransaction"));
    }
  };

  const handleDelete = async () => {
    if (!txId) return;

    Alert.alert(t("confirmDelete"), t("confirmDeleteTransaction"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("deleteTransaction"),
        style: "destructive",
        onPress: async () => {
          try {
            await deleteTx(txId);
            Alert.alert(t("success"), t("transactionDeleted"));
            router.back();
          } catch (error) {
            console.error("Error deleting transaction:", error);
            Alert.alert(t("error"), t("cannotDeleteTransaction"));
          }
        },
      },
    ]);
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
    walletPill: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.divider,
      marginRight: 10,
      gap: 6,
    },
    walletPillSelected: {
      backgroundColor: mode === "dark" ? "#1E3A8A" : "#EFF6FF",
      borderColor: "#1D4ED8",
    },
    walletPillText: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.text,
    },
    walletPillTextSelected: {
      color: "#1D4ED8",
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
    buttonContainer: {
      flexDirection: "row",
      gap: 12,
      marginHorizontal: 16,
      marginVertical: 20,
    },
    saveButton: {
      flex: 1,
      backgroundColor: "#1D4ED8",
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: "center",
    },
    saveButtonSmall: {
      flex: 2,
    },
    deleteButton: {
      flex: 1,
      backgroundColor: "#EF4444",
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "center",
      gap: 6,
    },
    deleteButtonText: {
      fontSize: 16,
      fontWeight: "700",
      color: "#fff",
    },
    saveButtonText: {
      fontSize: 16,
      fontWeight: "700",
      color: "#fff",
    },
    // Calculator styles
    calcOverlay: {
      position: "absolute" as const,
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
      zIndex: 999,
    },
    calcSheet: {
      backgroundColor: mode === "dark" ? "#1F2937" : "#F9FAFB",
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingTop: 12,
      paddingBottom: Math.max(insets.bottom, 16),
      paddingHorizontal: 16,
    },
    calcHandle: {
      width: 40, height: 4,
      backgroundColor: mode === "dark" ? "#4B5563" : "#D1D5DB",
      borderRadius: 2,
      alignSelf: "center" as const,
      marginBottom: 12,
    },
    calcDisplayBox: {
      alignItems: "flex-end" as const,
      paddingHorizontal: 8,
      paddingVertical: 12,
      minHeight: 80,
      justifyContent: "flex-end" as const,
    },
    calcExprText: {
      fontSize: 18,
      color: mode === "dark" ? "#9CA3AF" : "#6B7280",
      marginBottom: 4,
    },
    calcResultText: {
      fontSize: 42,
      fontWeight: "700" as const,
      color: colors.text,
    },
    calcRow: {
      flexDirection: "row" as const,
      gap: 10,
      marginBottom: 10,
    },
    calcKey: {
      flex: 1,
      aspectRatio: 1,
      borderRadius: 16,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      backgroundColor: mode === "dark" ? "#374151" : "#fff",
      shadowColor: "#000",
      shadowOpacity: 0.06,
      shadowOffset: { width: 0, height: 2 },
      shadowRadius: 4,
      elevation: 2,
    },
    calcKeyOp: {
      backgroundColor: mode === "dark" ? "#4B5563" : "#E5E7EB",
    },
    calcKeyEquals: {
      backgroundColor: "#F59E0B",
    },
    calcKeyText: {
      fontSize: 22,
      fontWeight: "600" as const,
      color: colors.text,
    },
    calcKeyTextOp: {
      color: "#10B981",
    },
    calcKeyTextEquals: {
      color: "#fff",
      fontSize: 26,
    },
    confirmBtn: {
      backgroundColor: "#10B981",
      borderRadius: 16,
      paddingVertical: 14,
      alignItems: "center" as const,
      marginTop: 4,
      flexDirection: "row" as const,
      justifyContent: "center" as const,
      gap: 8,
    },
    confirmBtnText: {
      color: "#fff",
      fontSize: 17,
      fontWeight: "700" as const,
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
          {isEditMode ? t("editTransaction") : t("addTransaction")}
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
              {t("expense")}
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1, position: "relative" }}>
              <TextInput
                style={[styles.input, { paddingRight: 40 }]}
                placeholder={t("enterAmount")}
                placeholderTextColor={colors.subText}
                value={amount}
                onChangeText={(text) => {
                  // Format with commas
                  const num = text.replace(/[^0-9]/g, "");
                  if (num) {
                    const formatted = parseInt(num).toLocaleString("vi-VN");
                    setAmount(formatted);
                  } else {
                    setAmount("");
                  }
                }}
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
            {/* Nút máy tính */}
            <TouchableOpacity
              onPress={openCalc}
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.divider,
                alignItems: "center",
                justifyContent: "center",
              }}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="calculator-variant-outline" size={24} color="#10B981" />
            </TouchableOpacity>
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

        {/* Account Selection */}
        <View style={styles.section}>
          <Text style={styles.label}>{t("walletName")}</Text>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false} 
            contentContainerStyle={{ paddingVertical: 4 }}
          >
            {accounts.map(acc => {
              const isSelected = selectedAccount?.id === acc.id;
              return (
                <TouchableOpacity
                  key={acc.id}
                  style={[
                    styles.walletPill,
                    isSelected && styles.walletPillSelected
                  ]}
                  onPress={() => setSelectedAccount(acc)}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.walletPillText, 
                    isSelected && styles.walletPillTextSelected
                  ]}>
                    {acc.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
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

      {/* Action Buttons */}
      <View style={styles.buttonContainer}>
        {isEditMode && (
          <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
            <MaterialCommunityIcons
              name="delete-outline"
              size={20}
              color="#fff"
            />
            <Text style={styles.deleteButtonText}>Xóa</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.saveButton, isEditMode && styles.saveButtonSmall]}
          onPress={handleSave}
        >
          <Text style={styles.saveButtonText}>{t("save")}</Text>
        </TouchableOpacity>
      </View>

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

      {/* ── Calculator Bottom Sheet ── */}
      {showCalc && (
        <View style={styles.calcOverlay}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeCalc} />
          <Animated.View
            style={[
              styles.calcSheet,
              { transform: [{ translateY: calcSlideAnim }] },
            ]}
          >
            <View style={styles.calcHandle} />

            {/* Display */}
            <View style={styles.calcDisplayBox}>
              {/* Dòng trên: biểu thức đang nhập */}
              <Text style={styles.calcExprText} numberOfLines={2} adjustsFontSizeToFit>
                {calcExpr ? formatExprDisplay(calcExpr) : " "}
              </Text>
              {/* Dòng dưới to đậm: chỉ hiển sau khi bấm = */}
              {calcResult !== null ? (
                <Text style={styles.calcResultText} numberOfLines={1} adjustsFontSizeToFit>
                  {calcResult === "Lỗi"
                    ? "Lỗi"
                    : Number(calcResult).toLocaleString("vi-VN")}
                </Text>
              ) : (
                // Chưa bấm → hiển số đang nhập được format (chỉ khi là số thuần, không có operator)
                <Text style={[styles.calcResultText, { color: calcExpr && !calcExpr.match(/[+\-×÷%]/) ? colors.text : colors.subText }]} numberOfLines={1} adjustsFontSizeToFit>
                  {calcExpr && !calcExpr.match(/[+\-×÷%]/)
                    ? Number(calcExpr).toLocaleString("vi-VN")
                    : "0"}
                </Text>
              )}
            </View>

            {/* Keys */}
            {calcKeys.map((row, ri) => (
              <View key={ri} style={styles.calcRow}>
                {row.map((key) => {
                  const isOp = ["+", "-", "×", "÷", "%", "+/-", "C", "⌫"].includes(key);
                  const isEq = key === "=";
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[
                        styles.calcKey,
                        isOp && styles.calcKeyOp,
                        isEq && styles.calcKeyEquals,
                      ]}
                      onPress={() => handleCalcKey(key)}
                      activeOpacity={0.75}
                    >
                      {key === "⌫" ? (
                        <MaterialCommunityIcons
                          name="backspace-outline"
                          size={22}
                          color="#10B981"
                        />
                      ) : (
                        <Text
                          style={[
                            styles.calcKeyText,
                            isOp && styles.calcKeyTextOp,
                            isEq && styles.calcKeyTextEquals,
                          ]}
                        >
                          {key}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}

            {/* Hint: bấm = lần 2 để xác nhận */}
            {calcResult !== null && calcResult !== "Lỗi" && (
              <Text style={{ textAlign: "center", color: colors.subText, fontSize: 12, marginTop: 2, marginBottom: 4 }}>
                Bấm <Text style={{ color: "#F59E0B", fontWeight: "700" }}>=</Text> lần nữa để xác nhận
              </Text>
            )}
          </Animated.View>
        </View>
      )}
    </SafeAreaView>
  );
}
