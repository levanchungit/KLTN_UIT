// app/setting/export-import.tsx
import { useTheme } from "@/app/providers/ThemeProvider";
import { db } from "@/db";
import { useI18n } from "@/i18n/I18nProvider";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { readAsStringAsync, writeAsStringAsync } from "expo-file-system";
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
          t.occurred_at,
          c.name as category_name,
          a.name as account_name
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        LEFT JOIN accounts a ON t.account_id = a.id
        WHERE t.user_id = 'u_demo'
        ORDER BY t.occurred_at DESC`
      );

      if (transactions.length === 0) {
        Alert.alert(t("error"), "Không có giao dịch để xuất");
        return;
      }

      // CSV header (removed ID field - same as transactions tab)
      const csvHeader = "Số tiền,Loại,Danh mục,Ghi chú,Ngày\n";

      // CSV rows
      const csvRows = transactions
        .map((tx: any) => {
          const dateObj = new Date(tx.occurred_at * 1000);
          const date = `${String(dateObj.getDate()).padStart(2, "0")}/${String(
            dateObj.getMonth() + 1
          ).padStart(2, "0")}/${dateObj.getFullYear()} ${String(
            dateObj.getHours()
          ).padStart(2, "0")}:${String(dateObj.getMinutes()).padStart(2, "0")}`;
          const type = tx.type === "income" ? "Thu nhập" : "Chi tiêu";
          const amount = tx.amount.toString(); // Export as plain number without formatting
          const category = (tx.category_name || "").replace(/"/g, '""');
          const note = (tx.note || "").replace(/"/g, '""');
          return `${amount},"${type}","${category}","${note}","${date}"`;
        })
        .join("\n");

      const csvContent = csvHeader + csvRows;

      // Save to file using temp directory
      const fileName = `giao_dich_${new Date().getTime()}.csv`;
      const fileUri = `${getCacheDir()}${fileName}`;

      await writeAsStringAsync(fileUri, csvContent);

      // Share file
      const isAvailable = await isAvailableAsync();
      if (isAvailable) {
        await shareAsync(fileUri, {
          mimeType: "text/csv",
          dialogTitle: "Xuất giao dịch",
          UTI: "public.comma-separated-values-text",
        });
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
    try {
      setLoading(true);

      // Pick CSV file - accept multiple MIME types for better compatibility
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*", // Accept all files, user will select CSV manually
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        setLoading(false);
        return;
      }

      const fileUri = result.assets[0].uri;
      const fileName = result.assets[0].name || "";

      // Check if file is CSV
      if (!fileName.toLowerCase().endsWith(".csv")) {
        Alert.alert(t("error"), "Vui lòng chọn file CSV");
        setLoading(false);
        return;
      }

      console.log("Selected file:", fileUri);

      // Read file content
      const csvContent = await readAsStringAsync(fileUri);
      console.log("CSV content length:", csvContent.length);

      // Parse CSV
      const lines = csvContent.split("\n").filter((line) => line.trim());

      if (lines.length < 2) {
        Alert.alert(t("error"), "File CSV trống hoặc không hợp lệ");
        return;
      }

      // Skip header line
      const dataLines = lines.slice(1);

      let imported = 0;
      let failed = 0;

      for (const line of dataLines) {
        try {
          // Parse CSV line (handle quoted values)
          const values: string[] = [];
          let currentValue = "";
          let inQuotes = false;

          for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === "," && !inQuotes) {
              values.push(currentValue.trim());
              currentValue = "";
            } else {
              currentValue += char;
            }
          }
          values.push(currentValue.trim());

          if (values.length < 5) continue;

          // Extract values: Số tiền,Loại,Danh mục,Ghi chú,Ngày
          const amount = parseFloat(values[0].replace(/[^0-9.-]/g, ""));
          const type = values[1].includes("Thu") ? "income" : "expense";
          const categoryName = values[2].replace(/"/g, "");
          const note = values[3].replace(/"/g, "");
          const dateStr = values[4].replace(/"/g, "");

          if (isNaN(amount)) {
            failed++;
            continue;
          }

          // Parse date: DD/MM/YYYY HH:mm
          const dateParts = dateStr.match(
            /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/
          );
          let occurredAt: number;

          if (dateParts) {
            const [, day, month, year, hour, minute] = dateParts;
            const date = new Date(
              parseInt(year),
              parseInt(month) - 1,
              parseInt(day),
              parseInt(hour),
              parseInt(minute)
            );
            occurredAt = Math.floor(date.getTime() / 1000);
          } else {
            occurredAt = Math.floor(Date.now() / 1000);
          }

          // Find or use default category
          const categories = await db.getAllAsync<{ id: string; name: string }>(
            `SELECT id, name FROM categories WHERE type = ? LIMIT 10`,
            [type] as any
          );

          let categoryId = null;
          if (categoryName) {
            const matchedCat = categories.find(
              (c) => c.name.toLowerCase() === categoryName.toLowerCase()
            );
            categoryId = matchedCat?.id || categories[0]?.id || null;
          } else {
            categoryId = categories[0]?.id || null;
          }

          // Get default account
          const account = await db.getFirstAsync<{ id: string }>(
            `SELECT id FROM accounts WHERE user_id = 'u_demo' LIMIT 1`
          );
          const accountId = account?.id || "acc_default";

          // Generate ID
          const id = `tx_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;

          // Insert transaction
          await db.runAsync(
            `INSERT INTO transactions (id, user_id, account_id, category_id, type, amount, note, occurred_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              "u_demo",
              accountId,
              categoryId,
              type,
              amount,
              note,
              occurredAt,
              occurredAt,
            ] as any
          );

          imported++;
        } catch (err) {
          console.error("Error importing line:", err);
          failed++;
        }
      }

      Alert.alert(
        t("success"),
        `Đã nhập ${imported} giao dịch thành công${
          failed > 0 ? `\n${failed} giao dịch bị lỗi` : ""
        }`
      );
    } catch (error) {
      console.error("Import error:", error);
      Alert.alert(t("error"), "Không thể nhập file CSV: " + error);
    } finally {
      setLoading(false);
    }
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
