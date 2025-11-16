// app/setting/language.tsx
import { useTheme } from "@/app/providers/ThemeProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Language = {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
};

const LANGUAGES: Language[] = [
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt", flag: "🇻🇳" },
  { code: "en", name: "English", nativeName: "English", flag: "🇺🇸" },
];

export default function LanguageSettings() {
  const { colors } = useTheme();
  const { t, lang, setLanguage } = useI18n();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(lang);

  const handleSelectLanguage = (code: string) => {
    setLanguage(code as any);
    setSelectedLanguage(code);
    Alert.alert(t("success"), t("infoLanguage"));
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("language")}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Language List */}
      <View style={styles.list}>
        <Text style={styles.sectionTitle}>{t("selectLanguage")}</Text>
        {LANGUAGES.map((lang) => (
          <TouchableOpacity
            key={lang.code}
            style={[
              styles.item,
              selectedLanguage === lang.code && styles.itemSelected,
            ]}
            activeOpacity={0.7}
            onPress={() => handleSelectLanguage(lang.code)}
          >
            <View style={styles.itemLeft}>
              <Text style={styles.flag}>{lang.flag}</Text>
              <View>
                <Text style={styles.langName}>{lang.nativeName}</Text>
                <Text style={styles.langNameEn}>{lang.name}</Text>
              </View>
            </View>
            {selectedLanguage === lang.code && (
              <Ionicons name="checkmark-circle" size={24} color="#10B981" />
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* Info */}
      <View style={styles.infoBox}>
        <Ionicons
          name="information-circle-outline"
          size={20}
          color={colors.subText}
        />
        <Text style={styles.infoText}>{t("infoLanguage")}</Text>
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
    sectionTitle: {
      fontSize: 14,
      fontWeight: "600",
      color: c.subText,
      marginBottom: 12,
      marginLeft: 4,
    },
    item: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: c.card,
      borderRadius: 12,
      padding: 16,
      marginBottom: 10,
      borderWidth: 2,
      borderColor: "transparent",
    },
    itemSelected: {
      borderColor: "#10B981",
      backgroundColor: c.card,
    },
    itemLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    flag: {
      fontSize: 32,
    },
    langName: {
      fontSize: 16,
      fontWeight: "600",
      color: c.text,
    },
    langNameEn: {
      fontSize: 13,
      color: c.subText,
      marginTop: 2,
    },
    infoBox: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: c.card,
      padding: 12,
      marginHorizontal: 16,
      marginTop: 16,
      borderRadius: 8,
      borderLeftWidth: 3,
      borderLeftColor: "#3B82F6",
    },
    infoText: {
      flex: 1,
      fontSize: 13,
      color: c.subText,
      lineHeight: 18,
    },
  });
