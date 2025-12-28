import { useTheme } from "@/app/providers/ThemeProvider";
import { useI18n } from "@/i18n/I18nProvider";
import {
  createAccount,
  deleteAccount,
  listAccounts,
  updateAccount,
  type Account,
} from "@/repos/accountRepo";
import { formatMoney } from "@/utils/format";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Modal, Portal } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const formatNumberForInput = (amount: number) => {
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  const formatted = absAmount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return isNegative ? `-${formatted}` : formatted;
};

const formatInputValue = (value: string) => {
  // Allow negative sign at the beginning
  const cleaned = value.replace(/[^\d-]/g, "");
  // Ensure only one negative sign at the beginning
  const hasNegative = cleaned.startsWith("-");
  const numericPart = cleaned.replace(/-/g, "");
  // Format with dots
  const formatted = numericPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return hasNegative ? `-${formatted}` : formatted;
};

export default function WalletsScreen() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(
    () => makeStyles(colors, insets.bottom),
    [colors, insets.bottom]
  );

  const [wallets, setWallets] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingWallet, setEditingWallet] = useState<Account | null>(null);
  const [formName, setFormName] = useState("");
  const [formBalance, setFormBalance] = useState("");

  const loadWallets = useCallback(async () => {
    setLoading(true);
    try {
      const ws = await listAccounts();
      setWallets(ws);
    } catch (error) {
      console.error("Error loading wallets:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadWallets();
    }, [loadWallets])
  );

  const handleAdd = () => {
    setEditingWallet(null);
    setFormName("");
    setFormBalance("");
    setModalVisible(true);
  };

  const handleEdit = (wallet: Account) => {
    setEditingWallet(wallet);
    setFormName(wallet.name);
    setFormBalance(formatNumberForInput(wallet.balance_cached || 0));
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      Alert.alert(t("error"), t("enterWalletName"));
      return;
    }
    try {
      if (editingWallet) {
        await updateAccount(editingWallet.id, {
          name: formName,
          balance:
            parseFloat(formBalance.replace(/\./g, "").replace(",", ".")) || 0,
        });
      } else {
        await createAccount({
          name: formName,
          balance:
            parseFloat(formBalance.replace(/\./g, "").replace(",", ".")) || 0,
          includeInTotal: true,
        });
      }
      setModalVisible(false);
      loadWallets();
    } catch (error) {
      Alert.alert(t("error"), t("cannotSaveWallet"));
      console.error(error);
    }
  };

  const handleBalanceChange = (value: string) => {
    const formattedValue = formatInputValue(value);
    setFormBalance(formattedValue);
  };

  const handleDelete = (wallet: Account) => {
    const isDefault =
      wallet.created_at === Math.min(...wallets.map((w) => w.created_at || 0));
    if (isDefault) {
      Alert.alert(t("error"), t("cannotDeleteDefaultWallet"));
      return;
    }
    Alert.alert(t("confirm"), t("confirmDeleteWallet", { name: wallet.name }), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("deleteWallet"),
        style: "destructive",
        onPress: async () => {
          try {
            await deleteAccount(wallet.id);
            loadWallets();
          } catch (deleteError) {
            Alert.alert(t("error"), t("cannotDeleteWallet"));
            console.error(deleteError);
          }
        },
      },
    ]);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("manageWallets")}</Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView
        style={styles.list}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {loading && (
          <Text style={[styles.emptyText, { color: colors.subText }]}>
            {t("loading")}
          </Text>
        )}
        {!loading && wallets.length === 0 && (
          <Text style={[styles.emptyText, { color: colors.subText }]}>
            {t("noWallets")}
          </Text>
        )}
        {wallets.map((wallet) => {
          // Ví có created_at sớm nhất là mặc định
          const isDefault =
            wallet.created_at ===
            Math.min(...wallets.map((w) => w.created_at || 0));
          return (
            <View key={wallet.id} style={styles.item}>
              <View style={styles.iconBox}>
                <MaterialCommunityIcons
                  name="wallet"
                  size={24}
                  color={colors.icon}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    marginBottom: 2,
                  }}
                >
                  <Text style={styles.itemName}>{wallet.name}</Text>
                  {isDefault && (
                    <View style={styles.defaultTag}>
                      <Text style={styles.defaultTagText}>{t("default")}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.itemType}>
                  {t("balance")}: {formatMoney(wallet.balance_cached || 0)}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => handleEdit(wallet)}
                style={styles.actionBtn}
              >
                <Ionicons name="create-outline" size={20} color={colors.icon} />
              </TouchableOpacity>
              {!isDefault && (
                <TouchableOpacity
                  onPress={() => handleDelete(wallet)}
                  style={styles.actionBtn}
                >
                  <Ionicons name="trash-outline" size={20} color="#EF4444" />
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </ScrollView>
      <View style={styles.addButtonContainer}>
        <TouchableOpacity style={styles.addButton} onPress={handleAdd}>
          <Ionicons name="add" size={24} color="#fff" />
          <Text style={styles.addButtonText}>{t("addWallet")}</Text>
        </TouchableOpacity>
      </View>
      <Portal>
        <Modal
          style={{ margin: 0 }}
          visible={modalVisible}
          onDismiss={() => setModalVisible(false)}
        >
          <KeyboardAvoidingView
            behavior="position"
            keyboardVerticalOffset={Platform.OS === "ios" ? 60 : 250}
            style={[styles.modal]}
          >
            <View style={styles.modalContent}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {editingWallet ? t("editWalletTitle") : t("addWallet")}
              </Text>
              <Text style={[styles.label, { color: colors.text }]}>
                {t("walletName")}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    color: colors.text,
                    borderColor: colors.divider,
                  },
                ]}
                placeholder={t("walletName")}
                placeholderTextColor={colors.subText}
                value={formName}
                onChangeText={setFormName}
              />
              <Text style={[styles.label, { color: colors.text }]}>
                {t("balance")}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    color: colors.text,
                    borderColor: colors.divider,
                  },
                ]}
                placeholder={t("balance")}
                placeholderTextColor={colors.subText}
                value={formBalance}
                onChangeText={handleBalanceChange}
                keyboardType="default"
              />
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.btnCancel, { borderColor: colors.divider }]}
                  onPress={() => setModalVisible(false)}
                >
                  <Text style={{ color: colors.text }}>{t("cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnSave} onPress={handleSave}>
                  <Text style={{ color: "#fff", fontWeight: "600" }}>
                    {t("save")}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </Portal>
    </View>
  );
}

const makeStyles = (c: any, bottomInset: number) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
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
    list: { flex: 1, paddingHorizontal: 16, marginTop: 16 },
    emptyText: {
      textAlign: "center",
      marginTop: 40,
      fontSize: 16,
    },
    item: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.card,
      padding: 16,
      borderRadius: 12,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: c.divider,
    },
    iconBox: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.divider,
    },
    itemName: { fontSize: 16, fontWeight: "600", color: c.text },
    itemType: { fontSize: 13, color: c.subText, marginTop: 2 },
    actionBtn: { padding: 8 },
    addButtonContainer: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: bottomInset,
      backgroundColor: c.background,
      borderTopWidth: 1,
      borderTopColor: c.divider,
    },
    addButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#3B82F6",
      paddingVertical: 14,
      borderRadius: 12,
      gap: 8,
    },
    addButtonText: {
      color: "#fff",
      fontSize: 16,
      fontWeight: "600",
    },
    modal: {
      margin: 0,
      justifyContent: "center",
      paddingTop: 50,
    },
    modalContent: {
      borderRadius: 24,
      paddingHorizontal: 20,
      paddingTop: 16,
      backgroundColor: c.card,
      marginHorizontal: 20,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: "700",
      marginBottom: 12,
      textAlign: "center",
    },
    label: {
      fontSize: 13,
      fontWeight: "600",
      marginTop: 10,
      marginBottom: 6,
    },
    input: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 9,
      fontSize: 14,
      marginBottom: 10,
    },
    modalActions: {
      flexDirection: "row",
      gap: 10,
      marginTop: 16,
      paddingBottom: 12,
    },
    btnCancel: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: "center",
      borderWidth: 1,
    },
    btnSave: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#3B82F6",
    },
    defaultTag: {
      marginLeft: 8,
      paddingHorizontal: 6,
      paddingVertical: 2,
      backgroundColor: "#3B82F6",
      borderRadius: 4,
    },
    defaultTagText: {
      fontSize: 10,
      fontWeight: "600",
      color: "#fff",
    },
  });
