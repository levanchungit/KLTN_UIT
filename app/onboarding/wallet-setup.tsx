import { useTheme } from "@/app/providers/ThemeProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { useUser } from "@/context/userContext";
import { db, openDb } from "@/db";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function WalletSetup() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [name, setName] = useState(t("defaultWallet"));
  const [loading, setLoading] = useState(false);
  const { user } = useUser();

  const onCreate = async () => {
    if (!name.trim()) {
      Alert.alert(t("error"), t("walletNameError"));
      return;
    }
    setLoading(true);
    try {
      if (!user || !user.id) {
        router.replace("/auth/login");
        return;
      }
      await openDb();
      const id = `acc_${Math.random().toString(36).slice(2, 8)}`;
      await db.runAsync(
        `INSERT INTO accounts(id,user_id,name,icon,color,include_in_total,balance_cached,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        [
          id,
          user.id,
          name,
          "wallet",
          "#007AFF",
          1,
          0,
          Math.floor(Date.now() / 1000),
          null,
        ] as any
      );

      await AsyncStorage.setItem("onboarding_step", "wallet_done");
      router.push("/onboarding/categories-setup");
    } catch (e) {
      console.error(e);
      Alert.alert(t("error"), t("createWalletFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["top", "bottom"]}
    >
      <View style={styles.inner}>
        <Text style={[styles.title, { color: colors.text }]}>
          {t("setupFirstWallet")}
        </Text>
        <Text style={[styles.desc, { color: colors.subText }]}>
          {t("setupWalletDesc")}
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              borderColor: colors.divider,
              color: colors.text,
              backgroundColor: colors.card,
            },
          ]}
          value={name}
          onChangeText={setName}
          placeholderTextColor={colors.subText}
        />
        <TouchableOpacity
          style={styles.btn}
          onPress={onCreate}
          disabled={loading}
        >
          <Text style={styles.btnText}>
            {loading ? t("creatingWallet") : t("createWalletBtn")}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, padding: 24, justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 8 },
  desc: { marginBottom: 16 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  btn: {
    backgroundColor: "#16A34A",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700" },
});
