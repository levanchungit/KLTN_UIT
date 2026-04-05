import { useTheme } from "@/app/providers/ThemeProvider";
import { useI18n } from "@/i18n/I18nProvider";
import {
  deleteTransfer,
  listAccounts,
  listTransfers,
  transferBetweenWallets,
  type Account,
} from "@/repos/accountRepo";
import { formatMoney } from "@/utils/format";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Swipeable from "react-native-gesture-handler/Swipeable";
import { Modal, Portal } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// ── Helpers ──────────────────────────────────────────────────────────────────
const formatNumberInput = (value: string): string => {
  const cleaned = value.replace(/[^\d]/g, "");
  return cleaned.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

const parseAmount = (value: string): number => {
  const raw = value.replace(/\./g, "");
  const n = parseInt(raw, 10);
  return isNaN(n) ? 0 : n;
};

const fmtDate = (date: Date): string => {
  const d = date.getDate().toString().padStart(2, "0");
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
};

type TransferRecord = {
  id: string;
  amount: number;
  note: string | null;
  occurred_at: number;
  from_account_name: string;
  to_account_name: string | null;
};

type Tab = "form" | "history";

// ── Component ─────────────────────────────────────────────────────────────────
export default function WalletTransferScreen() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(
    () => makeStyles(colors, insets.bottom),
    [colors, insets.bottom]
  );
  const params = useLocalSearchParams();

  // tabs
  const [activeTab, setActiveTab] = useState<Tab>((params.tab as Tab) || "form");

  // wallets
  const [wallets, setWallets] = useState<Account[]>([]);

  // form state
  const [fromWallet, setFromWallet] = useState<Account | null>(null);
  const [toWallet, setToWallet] = useState<Account | null>(null);
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [transferDate] = useState<Date>(new Date());
  const [submitting, setSubmitting] = useState(false);

  // picker modal
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<"from" | "to">("from");

  // history
  const [history, setHistory] = useState<TransferRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // swap animation
  const swapAnim = React.useRef(new Animated.Value(0)).current;

  // ── Load data ─────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    try {
      const ws = await listAccounts();
      setWallets(ws);
      if (ws.length >= 2) {
        setFromWallet((prev) => {
          // Nếu đã chọn ví, tìm lại object mới nhất từ DB để cập nhật balance
          if (prev) return ws.find((w) => w.id === prev.id) ?? ws[0];
          return ws[0];
        });
        setToWallet((prev) => {
          if (prev) return ws.find((w) => w.id === prev.id) ?? ws[1];
          return ws[1];
        });
      }
    } catch (e) {
      console.error(e);
    }
    // load history
    setHistoryLoading(true);
    try {
      const h = await listTransfers();
      setHistory(h as TransferRecord[]);
    } catch (e) {
      console.error(e);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [loadAll])
  );

  // ── Swap wallets ──────────────────────────────────────────────────────────
  const handleSwap = () => {
    Animated.sequence([
      Animated.timing(swapAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(swapAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
    setFromWallet(toWallet);
    setToWallet(fromWallet);
  };

  // ── Open picker ───────────────────────────────────────────────────────────
  const openPicker = (target: "from" | "to") => {
    setPickerTarget(target);
    setPickerVisible(true);
  };

  const handlePickWallet = (wallet: Account) => {
    if (pickerTarget === "from") {
      if (wallet.id === toWallet?.id) {
        setToWallet(fromWallet);
      }
      setFromWallet(wallet);
    } else {
      if (wallet.id === fromWallet?.id) {
        setFromWallet(toWallet);
      }
      setToWallet(wallet);
    }
    setPickerVisible(false);
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleTransfer = async () => {
    if (wallets.length < 2) {
      Alert.alert(t("error"), t("needAtLeast2Wallets"));
      return;
    }
    if (!fromWallet || !toWallet) return;
    if (fromWallet.id === toWallet.id) {
      Alert.alert(t("error"), t("sameAccountError"));
      return;
    }
    const amount = parseAmount(amountText);
    if (amount <= 0) {
      Alert.alert(t("error"), t("enterTransferAmount"));
      return;
    }

    setSubmitting(true);
    try {
      await transferBetweenWallets({
        fromAccountId: fromWallet.id,
        toAccountId: toWallet.id,
        amount,
        note: note.trim() || undefined,
        occurredAt: transferDate,
      });
      // Refresh ngay lập tức để cập nhật balance mới
      await loadAll();
      Alert.alert(
        t("transferSuccess"),
        t("transferSuccessMsg", {
          amount: formatMoney(amount),
          from: fromWallet.name,
          to: toWallet.name,
        }),
        [
          {
            text: "OK",
            onPress: () => {
              setAmountText("");
              setNote("");
              setActiveTab("history");
            },
          },
        ]
      );
    } catch (err: any) {
      const code = err?.message ?? "";
      if (code === "INSUFFICIENT_BALANCE") {
        Alert.alert(t("error"), t("insufficientBalance"));
      } else if (code === "SAME_ACCOUNT") {
        Alert.alert(t("error"), t("sameAccountError"));
      } else {
        Alert.alert(t("error"), t("transferFailed"));
      }
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Delete Transfer ───────────────────────────────────────────────────────
  const handleDeleteTransfer = (id: string) => {
    Alert.alert(t("confirmDelete"), t("confirmDeleteMsg"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("delete"),
        style: "destructive",
        onPress: async () => {
          try {
            await deleteTransfer(id);
            loadAll();
          } catch (e) {
            console.error(e);
            Alert.alert(t("error"), t("transferFailed"));
          }
        },
      },
    ]);
  };

  const renderRightActions = (id: string) => {
    return (
      <TouchableOpacity
        style={styles.deleteAction}
        onPress={() => handleDeleteTransfer(id)}
      >
        <Ionicons name="trash-outline" size={24} color="#fff" />
      </TouchableOpacity>
    );
  };

  // ── Swap rotation ─────────────────────────────────────────────────────────
  const swapRotate = swapAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("walletTransfer")}</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "form" && styles.tabActive]}
          onPress={() => setActiveTab("form")}
        >
          <MaterialCommunityIcons
            name="swap-horizontal"
            size={16}
            color={activeTab === "form" ? "#fff" : colors.subText}
          />
          <Text
            style={[
              styles.tabText,
              activeTab === "form" && styles.tabTextActive,
            ]}
          >
            {t("doTransfer")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "history" && styles.tabActive]}
          onPress={() => setActiveTab("history")}
        >
          <Ionicons
            name="time-outline"
            size={16}
            color={activeTab === "history" ? "#fff" : colors.subText}
          />
          <Text
            style={[
              styles.tabText,
              activeTab === "history" && styles.tabTextActive,
            ]}
          >
            {t("transferHistory")}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Form Tab ── */}
      {activeTab === "form" && (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.formScroll}
            keyboardShouldPersistTaps="handled"
          >
            {wallets.length < 2 && (
              <View style={styles.warningCard}>
                <Ionicons name="warning-outline" size={20} color="#F59E0B" />
                <Text style={styles.warningText}>
                  {t("needAtLeast2Wallets")}
                </Text>
              </View>
            )}

            {/* Wallet selector cards */}
            <View style={styles.walletSelectorContainer}>
              {/* From wallet */}
              <TouchableOpacity
                style={[styles.walletCard, styles.fromCard]}
                onPress={() => openPicker("from")}
                activeOpacity={0.8}
              >
                <View style={styles.walletCardHeader}>
                  <View style={[styles.walletIcon, { backgroundColor: "#EF4444" }]}>
                    <MaterialCommunityIcons name="wallet-outline" size={18} color="#fff" />
                  </View>
                  <Text style={styles.walletCardLabel}>{t("transferFrom")}</Text>
                  <Ionicons name="chevron-down" size={16} color="rgba(255,255,255,0.8)" />
                </View>
                <Text style={styles.walletCardName} numberOfLines={1}>
                  {fromWallet?.name ?? t("selectFromWallet")}
                </Text>
                {fromWallet && (
                  <Text style={styles.walletCardBalance}>
                    {formatMoney(fromWallet.balance_cached ?? 0)}
                  </Text>
                )}
              </TouchableOpacity>

              {/* Swap button */}
              <Animated.View style={{ transform: [{ rotate: swapRotate }] }}>
                <TouchableOpacity style={styles.swapBtn} onPress={handleSwap}>
                  <MaterialCommunityIcons
                    name="swap-vertical"
                    size={22}
                    color="#fff"
                  />
                </TouchableOpacity>
              </Animated.View>

              {/* To wallet */}
              <TouchableOpacity
                style={[styles.walletCard, styles.toCard]}
                onPress={() => openPicker("to")}
                activeOpacity={0.8}
              >
                <View style={styles.walletCardHeader}>
                  <View style={[styles.walletIcon, { backgroundColor: "#10B981" }]}>
                    <MaterialCommunityIcons name="wallet-outline" size={18} color="#fff" />
                  </View>
                  <Text style={styles.walletCardLabel}>{t("transferTo")}</Text>
                  <Ionicons name="chevron-down" size={16} color="rgba(255,255,255,0.8)" />
                </View>
                <Text style={styles.walletCardName} numberOfLines={1}>
                  {toWallet?.name ?? t("selectToWallet")}
                </Text>
                {toWallet && (
                  <Text style={styles.walletCardBalance}>
                    {formatMoney(toWallet.balance_cached ?? 0)}
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Amount input */}
            <View style={styles.section}>
              <Text style={[styles.label, { color: colors.subText }]}>
                {t("transferAmount")}
              </Text>
              <View style={[styles.amountRow, { borderColor: colors.divider, backgroundColor: colors.card }]}>
                <TextInput
                  style={[styles.amountInput, { color: colors.text }]}
                  value={amountText}
                  onChangeText={(v) => setAmountText(formatNumberInput(v))}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={colors.subText}
                />
                <Text style={[styles.currencyLabel, { color: colors.subText }]}>VND</Text>
              </View>
            </View>

            {/* Date */}
            <View style={styles.section}>
              <Text style={[styles.label, { color: colors.subText }]}>
                {t("transferDate")}
              </Text>
              <View style={[styles.dateRow, { backgroundColor: colors.card, borderColor: colors.divider }]}>
                <Ionicons name="calendar-outline" size={18} color={colors.subText} />
                <Text style={[styles.dateText, { color: colors.text }]}>
                  {fmtDate(transferDate)}
                </Text>
              </View>
            </View>

            {/* Note */}
            <View style={styles.section}>
              <Text style={[styles.label, { color: colors.subText }]}>
                {t("transferNote")}
              </Text>
              <TextInput
                style={[
                  styles.noteInput,
                  { color: colors.text, backgroundColor: colors.card, borderColor: colors.divider },
                ]}
                value={note}
                onChangeText={setNote}
                placeholder={t("transferNote")}
                placeholderTextColor={colors.subText}
                multiline
                numberOfLines={3}
              />
            </View>
          </ScrollView>

          {/* Submit button */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[
                styles.transferBtn,
                (submitting || wallets.length < 2) && styles.transferBtnDisabled,
              ]}
              onPress={handleTransfer}
              disabled={submitting || wallets.length < 2}
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons
                name="swap-horizontal"
                size={20}
                color="#fff"
              />
              <Text style={styles.transferBtnText}>
                {submitting ? "..." : t("doTransfer")}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* ── History Tab ── */}
      {activeTab === "history" && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.historyScroll}
        >
          {historyLoading && (
            <Text style={[styles.emptyText, { color: colors.subText }]}>
              {t("loading")}
            </Text>
          )}
          {!historyLoading && history.length === 0 && (
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons
                name="swap-horizontal"
                size={56}
                color={colors.divider}
              />
              <Text style={[styles.emptyText, { color: colors.subText }]}>
                {t("noTransferHistory")}
              </Text>
            </View>
          )}
          {history.map((item) => {
            const date = new Date(item.occurred_at * 1000);
            return (
              <Swipeable
                key={item.id}
                renderRightActions={() => renderRightActions(item.id)}
                overshootRight={false}
              >
                <View
                  style={[styles.historyItem, { backgroundColor: colors.card, borderColor: colors.divider }]}
                >
                  <View style={styles.historyIconBox}>
                    <MaterialCommunityIcons
                      name="swap-horizontal"
                      size={22}
                      color="#6366F1"
                    />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <View style={styles.historyRow}>
                      <Text style={[styles.historyWallet, { color: colors.text }]} numberOfLines={1}>
                        {item.from_account_name}
                      </Text>
                      <Ionicons name="arrow-forward" size={14} color={colors.subText} style={{ marginHorizontal: 4 }} />
                      <Text style={[styles.historyWallet, { color: colors.text }]} numberOfLines={1}>
                        {item.to_account_name ?? "—"}
                      </Text>
                    </View>
                    {item.note ? (
                      <Text style={[styles.historyNote, { color: colors.subText }]} numberOfLines={1}>
                        {item.note}
                      </Text>
                    ) : null}
                    <Text style={[styles.historyDate, { color: colors.subText }]}>
                      {fmtDate(date)}
                    </Text>
                  </View>
                  <Text style={styles.historyAmount}>
                    -{formatMoney(item.amount)}
                  </Text>
                </View>
              </Swipeable>
            );
          })}
        </ScrollView>
      )}

      {/* ── Wallet Picker Modal ── */}
      <Portal>
        <Modal
          style={{ margin: 0 }}
          visible={pickerVisible}
          onDismiss={() => setPickerVisible(false)}
        >
          <View style={[styles.pickerModal, { backgroundColor: colors.card }]}>
            <View style={styles.pickerHandle} />
            <Text style={[styles.pickerTitle, { color: colors.text }]}>
              {pickerTarget === "from" ? t("selectFromWallet") : t("selectToWallet")}
            </Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {wallets.map((w) => {
                const isSelected =
                  pickerTarget === "from"
                    ? w.id === fromWallet?.id
                    : w.id === toWallet?.id;
                const isOther =
                  pickerTarget === "from"
                    ? w.id === toWallet?.id
                    : w.id === fromWallet?.id;
                return (
                  <TouchableOpacity
                    key={w.id}
                    style={[
                      styles.pickerItem,
                      { borderColor: colors.divider },
                      isSelected && styles.pickerItemSelected,
                    ]}
                    onPress={() => handlePickWallet(w)}
                  >
                    <View style={[styles.pickerIcon, { backgroundColor: isSelected ? "#6366F1" : colors.divider }]}>
                      <MaterialCommunityIcons
                        name="wallet"
                        size={18}
                        color={isSelected ? "#fff" : colors.icon}
                      />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={[styles.pickerWalletName, { color: colors.text }]}>
                        {w.name}
                        {isOther && (
                          <Text style={{ color: colors.subText, fontSize: 12 }}> ({pickerTarget === "from" ? t("transferTo") : t("transferFrom")})</Text>
                        )}
                      </Text>
                      <Text style={[styles.pickerBalance, { color: colors.subText }]}>
                        {formatMoney(w.balance_cached ?? 0)}
                      </Text>
                    </View>
                    {isSelected && (
                      <Ionicons name="checkmark-circle" size={22} color="#6366F1" />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              style={[styles.pickerCancelBtn, { borderColor: colors.divider }]}
              onPress={() => setPickerVisible(false)}
            >
              <Text style={[styles.pickerCancelText, { color: colors.text }]}>
                {t("cancel")}
              </Text>
            </TouchableOpacity>
          </View>
        </Modal>
      </Portal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const makeStyles = (c: any, bottomInset: number) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },

    // Header
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: c.divider,
    },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 18, fontWeight: "700", color: c.text },

    // Tabs
    tabBar: {
      flexDirection: "row",
      marginHorizontal: 16,
      marginTop: 16,
      marginBottom: 4,
      backgroundColor: c.card,
      borderRadius: 14,
      padding: 4,
      borderWidth: 1,
      borderColor: c.divider,
    },
    tab: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 10,
      borderRadius: 10,
      gap: 6,
    },
    tabActive: {
      backgroundColor: "#6366F1",
    },
    tabText: { fontSize: 13, fontWeight: "600", color: c.subText },
    tabTextActive: { color: "#fff" },

    // Form
    formScroll: {
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 24,
    },

    warningCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "#FEF3C7",
      borderRadius: 12,
      padding: 12,
      marginBottom: 16,
      gap: 8,
    },
    warningText: { fontSize: 13, color: "#92400E", flex: 1 },

    // Wallet selector
    walletSelectorContainer: {
      alignItems: "center",
      marginBottom: 20,
      gap: 8,
    },
    walletCard: {
      width: "100%",
      borderRadius: 16,
      padding: 16,
    },
    fromCard: {
      backgroundColor: "#EF4444",
    },
    toCard: {
      backgroundColor: "#10B981",
    },
    walletCardHeader: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 8,
      gap: 8,
    },
    walletIcon: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    walletCardLabel: {
      flex: 1,
      fontSize: 12,
      fontWeight: "600",
      color: "rgba(255,255,255,0.85)",
      letterSpacing: 0.5,
      textTransform: "uppercase",
    },
    walletCardName: {
      fontSize: 20,
      fontWeight: "700",
      color: "#fff",
      marginBottom: 4,
    },
    walletCardBalance: {
      fontSize: 13,
      color: "rgba(255,255,255,0.8)",
    },

    swapBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: "#6366F1",
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#6366F1",
      shadowOpacity: 0.4,
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 8,
      elevation: 6,
    },

    // Sections
    section: { marginBottom: 16 },
    label: { fontSize: 12, fontWeight: "600", marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" },

    amountRow: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 12,
      borderWidth: 1,
      paddingHorizontal: 16,
    },
    amountInput: {
      flex: 1,
      fontSize: 28,
      fontWeight: "700",
      paddingVertical: 14,
    },
    currencyLabel: { fontSize: 14, fontWeight: "600", marginLeft: 8 },

    dateRow: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 12,
      borderWidth: 1,
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 10,
    },
    dateText: { fontSize: 15, fontWeight: "500" },

    noteInput: {
      borderRadius: 12,
      borderWidth: 1,
      paddingHorizontal: 16,
      paddingVertical: 12,
      fontSize: 14,
      minHeight: 80,
      textAlignVertical: "top",
    },

    // Footer
    footer: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: bottomInset + 12,
      borderTopWidth: 1,
      borderTopColor: c.divider,
      backgroundColor: c.background,
    },
    transferBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#6366F1",
      paddingVertical: 16,
      borderRadius: 14,
      gap: 8,
      shadowColor: "#6366F1",
      shadowOpacity: 0.35,
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 10,
      elevation: 6,
    },
    transferBtnDisabled: { opacity: 0.5 },
    transferBtnText: { fontSize: 16, fontWeight: "700", color: "#fff" },

    // History
    historyScroll: {
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 40,
    },
    emptyContainer: {
      alignItems: "center",
      paddingTop: 60,
      gap: 12,
    },
    emptyText: {
      fontSize: 15,
      textAlign: "center",
    },
    historyItem: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 14,
      padding: 14,
      marginBottom: 10,
      borderWidth: 1,
    },
    historyIconBox: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: "#EEF2FF",
      alignItems: "center",
      justifyContent: "center",
    },
    historyRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 2,
      flexShrink: 1,
    },
    historyWallet: { fontSize: 14, fontWeight: "600", flexShrink: 1 },
    historyNote: { fontSize: 12, marginBottom: 2 },
    historyDate: { fontSize: 11 },
    historyAmount: {
      fontSize: 15,
      fontWeight: "700",
      color: "#EF4444",
      marginLeft: 8,
    },
    deleteAction: {
      backgroundColor: "#EF4444",
      justifyContent: "center",
      alignItems: "center",
      width: 72,
      marginBottom: 10,
      marginRight: 4,
      borderRadius: 14,
    },

    // Picker modal
    pickerModal: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingTop: 12,
      paddingHorizontal: 16,
      paddingBottom: 32,
    },
    pickerHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: "#CBD5E1",
      alignSelf: "center",
      marginBottom: 16,
    },
    pickerTitle: {
      fontSize: 16,
      fontWeight: "700",
      marginBottom: 12,
    },
    pickerItem: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 14,
      borderBottomWidth: 1,
    },
    pickerItemSelected: {
      backgroundColor: "#EEF2FF",
      borderRadius: 10,
      paddingHorizontal: 8,
      marginHorizontal: -8,
    },
    pickerIcon: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
    },
    pickerWalletName: { fontSize: 15, fontWeight: "600" },
    pickerBalance: { fontSize: 13, marginTop: 2 },
    pickerCancelBtn: {
      marginTop: 12,
      paddingVertical: 14,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: "center",
    },
    pickerCancelText: { fontSize: 15, fontWeight: "600" },
  });
