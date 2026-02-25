import { useTheme } from "@/app/providers/ThemeProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { useUser } from "@/context/userContext";
import { syncAll } from "@/services/syncService";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";

export default function SyncScreen() {
  const { user } = useUser();
  const { colors } = useTheme();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const doSync = async () => {
      try {
        if (!user) {
          router.replace("/auth/login");
          return;
        }
        await syncAll(user.id);
        if (!mounted) return;
        Alert.alert(t("syncTitle"), t("syncComplete"), [
          { text: "OK", onPress: () => router.replace("/(tabs)") },
        ]);
      } catch (err: any) {
        console.error("Sync failed", err);
        Alert.alert(t("syncErrorTitle"), err?.message || t("syncFailed"), [
          { text: "OK", onPress: () => router.replace("/(tabs)") },
        ]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    doSync();
    return () => {
      mounted = false;
    };
  }, [user]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color="#007AFF" animating={loading} />
      <Text style={[styles.text, { color: colors.text }]}>
        {loading ? t("syncingData") : t("syncDone")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  text: {
    marginTop: 12,
    fontSize: 16,
  },
});
