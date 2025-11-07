// app/setting/export-import.tsx
import { useTheme } from "@/app/providers/ThemeProvider";
import { db } from "@/db";
import { useI18n } from "@/i18n/I18nProvider";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { writeAsStringAsync } from "expo-file-system";
import { router } from "expo-router";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

// Helper to get cache directory path
const getCacheDir = () => {
  // Platform-specific cache directory
  return require("expo-file-system").cacheDirectory || "";
};

export default function ExportImportSettings() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const [loading, setLoading] = useState(false);

  const exportTransactionsToCSV = async () => {
    try {
      setLoading(true);

      // Get all transactions with category and account info
      const transactions = await db.getAllAsync<any>(
        `SELECT 
          t.id,
          t.amount,
          t.type,
          t.note,
          t.date,
          c.name as category_name,
          a.name as account_name
        FROM transactions t
        LEFT JOIN categories c ON t.categoryId = c.id
        LEFT JOIN accounts a ON t.accountId = a.id
        ORDER BY t.date DESC`
      );

      // Create CSV content
      // For simplicity keep Vietnamese CSV headers for now; could localize if needed
      const headers = "ID,Số tiền,Loại,Danh mục,Tài khoản,Ghi chú,Ngày\n";
      const rows = transactions
        .map((t: any) =>
          [
            t.id,
            t.amount,
            t.type === "income" ? "income" : "expense",
            t.category_name || "",
            t.account_name || "",
            `"${(t.note || "").replace(/"/g, '""')}"`,
            t.date,
          ].join(",")
        )
        .join("\n");

      const csvContent = headers + rows;

      // Save to file using temp directory
      const fileName = `transactions_${new Date().toISOString().split("T")[0]}.csv`;
      // Use a simple path that works
      const fileUri = `${getCacheDir()}${fileName}`;

      await writeAsStringAsync(fileUri, csvContent);

      // Share file
      const isAvailable = await isAvailableAsync();
      if (isAvailable) {
        await shareAsync(fileUri);
        Alert.alert(
          t("success"),
          t("exportSuccess", { count: transactions.length })
        );
      } else {
        Alert.alert(t("error"), t("shareFail"));
      }
    } catch (error) {
      console.error("Export error:", error);
      Alert.alert(t("error"), t("exportFail"));
    } finally {
      setLoading(false);
    }
  };

  const importTransactionsFromCSV = async () => {
    Alert.alert(t("warning"), t("importFeaturePending"));
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("exportImportCSV")}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Content */}
      <View style={styles.content}>
        {/* Export Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialCommunityIcons
              name="file-export-outline"
              size={24}
              color="#10B981"
            />
            <Text style={styles.sectionTitle}>{t("exportData")}</Text>
          </View>
          <Text style={styles.sectionDesc}>{t("exportDesc")}</Text>
          <TouchableOpacity
            style={[styles.button, styles.exportButton]}
            onPress={exportTransactionsToCSV}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="download-outline" size={20} color="#fff" />
                <Text style={styles.buttonText}>{t("exportCSVFile")}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Import Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialCommunityIcons
              name="file-import-outline"
              size={24}
              color="#3B82F6"
            />
            <Text style={styles.sectionTitle}>{t("importData")}</Text>
          </View>
          <Text style={styles.sectionDesc}>{t("importDesc")}</Text>
          <TouchableOpacity
            style={[styles.button, styles.importButton]}
            onPress={importTransactionsFromCSV}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
                <Text style={styles.buttonText}>{t("importCSVFile")}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Warning */}
        <View style={styles.warningBox}>
          <Ionicons name="warning-outline" size={20} color="#F59E0B" />
          <Text style={styles.warningText}>{t("warningImport")}</Text>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (c: {
  background: string;
  card: string;
  text: string;
  subText: string;
  divider: string;
  icon: string;
}) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 16,
      backgroundColor: c.card,
      borderBottomWidth: 1,
      borderBottomColor: c.divider,
    },
    backBtn: {
      width: 40,
      height: 40,
      justifyContent: "center",
      alignItems: "center",
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: c.text,
    },
    content: {
      padding: 16,
    },
    section: {
      backgroundColor: c.card,
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 8,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: c.text,
    },
    sectionDesc: {
      fontSize: 14,
      color: c.subText,
      lineHeight: 20,
      marginBottom: 16,
    },
    button: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 14,
      borderRadius: 10,
      elevation: 2,
      shadowColor: "#000",
      shadowOpacity: 0.1,
      shadowOffset: { width: 0, height: 2 },
      shadowRadius: 4,
    },
    exportButton: {
      backgroundColor: "#10B981",
    },
    importButton: {
      backgroundColor: "#3B82F6",
    },
    buttonText: {
      fontSize: 16,
      fontWeight: "600",
      color: "#fff",
    },
    warningBox: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      backgroundColor: "#FEF3C7",
      padding: 14,
      borderRadius: 10,
      borderLeftWidth: 4,
      borderLeftColor: "#F59E0B",
    },
    warningText: {
      flex: 1,
      fontSize: 13,
      color: "#92400E",
      lineHeight: 18,
    },
  });
