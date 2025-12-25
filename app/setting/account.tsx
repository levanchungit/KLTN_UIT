import { useTheme } from "@/app/providers/ThemeProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function AccountSettings() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("accountSettings")}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Menu Items */}
      <View style={styles.list}>
        <TouchableOpacity
          style={styles.item}
          activeOpacity={0.7}
          onPress={() => router.push("/setting/language")}
        >
          <View style={styles.itemLeft}>
            <Ionicons name="language" size={24} color={colors.icon} />
            <Text style={styles.itemTitle}>{t("language")}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.subText} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.item}
          activeOpacity={0.7}
          onPress={() => router.push("/setting/export-import")}
        >
          <View style={styles.itemLeft}>
            <MaterialCommunityIcons
              name="file-export-outline"
              size={24}
              color={colors.icon}
            />
            <Text style={styles.itemTitle}>{t("exportImportCSV")}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.subText} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
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
    list: {
      marginTop: 16,
      paddingHorizontal: 16,
    },
    item: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: c.card,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      elevation: 1,
      shadowColor: "#000",
      shadowOpacity: 0.04,
      shadowOffset: { width: 0, height: 1 },
      shadowRadius: 2,
    },
    itemLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    itemTitle: {
      fontSize: 16,
      fontWeight: "500",
      color: c.text,
    },
  });
