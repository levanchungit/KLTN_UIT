import { useUser } from "@/context/userContext";
import { syncAll } from "@/services/syncService";
import syncState from "@/services/syncState";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

function fmtTime(sec: number | null) {
  if (!sec) return "Chưa đồng bộ";
  const d = new Date(sec * 1000);
  return d.toLocaleString();
}

export default function SyncStatus() {
  const [state, setState] = useState(syncState.getSyncState());
  const { user } = useUser();

  useEffect(() => {
    const unsub = syncState.subscribe((s) => setState(s));
    return unsub;
  }, []);

  const onManual = async () => {
    try {
      await syncAll(user?.id);
    } catch (e) {
      // syncState will reflect error
    }
  };

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={styles.box}>
        {state.status === "syncing" ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.statusText}>
            {state.status === "idle" ? "Đã đồng bộ" : "Lỗi đồng bộ"}
          </Text>
        )}
        <Text style={styles.timeText}>{fmtTime(state.lastSyncedAt)}</Text>
        <TouchableOpacity style={styles.btn} onPress={onManual}>
          <Text style={styles.btnText}>Đồng bộ</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 36,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 1000,
    elevation: 1000,
  },
  box: {
    backgroundColor: "#111827cc",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  statusText: {
    color: "#fff",
    fontSize: 13,
    marginRight: 8,
  },
  timeText: {
    color: "#d1d5db",
    fontSize: 11,
    marginRight: 12,
  },
  btn: {
    backgroundColor: "#06b6d4",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  btnText: {
    color: "#03263b",
    fontWeight: "600",
    fontSize: 13,
  },
});
