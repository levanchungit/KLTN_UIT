import { useUser } from "@/context/userContext";
import { syncAll } from "@/services/syncService";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";

export default function SyncScreen() {
  const { user } = useUser();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const doSync = async () => {
      try {
        if (!user) {
          // No user — go to login
          router.replace("/auth/login");
          return;
        }
        await syncAll(user.id);
        if (!mounted) return;
        Alert.alert("Đồng bộ", "Đồng bộ dữ liệu hoàn tất", [
          { text: "OK", onPress: () => router.replace("/(tabs)") },
        ]);
      } catch (err: any) {
        console.error("Sync failed", err);
        Alert.alert("Lỗi đồng bộ", err?.message || "Đồng bộ thất bại", [
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
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#007AFF" animating={loading} />
      <Text style={styles.text}>
        {loading ? "Đang đồng bộ..." : "Hoàn tất"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
  },
  text: {
    marginTop: 12,
    fontSize: 16,
    color: "#333",
  },
});
