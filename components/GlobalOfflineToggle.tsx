import { useNetworkManager } from "@/context/NetworkManagerContext";
import { MaterialIcons } from "@expo/vector-icons";
import Constants from "expo-constants";
import React, { useEffect, useState } from "react";
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function GlobalOfflineToggle() {
  const { isOfflineMode, toggleOfflineMode, networkState } = useNetworkManager();
  const insets = useSafeAreaInsets();
  const [slideAnim] = useState(new Animated.Value(-50));

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 50,
      friction: 7,
    }).start();
  }, []);

  // Base offset plus safe-area. We support two modes:
  // - Default: place just below safe area (don't overlap status bar)
  // - For certain devices (e.g. Realme C65) place the pill *over* the notch
  //   by reducing the top so it visually sits inside the system status area.
  const baseOffset = Platform.OS === "android" ? 6 : 8;
  const deviceModelRaw =
    (Constants.platform?.android?.model || Constants.deviceName || "").toString().toLowerCase();

  // Decide a compact paddingTop for the banner so overall height stays small.
  // We compute bannerPaddingTop = max(0, insets.top - overlap), where overlap is
  // how many pixels we want the banner to intrude into the system/status area.
  let bannerPaddingTop = insets.top ?? 0;
  try {
    if (deviceModelRaw.includes("realme c65") || deviceModelRaw.includes("c65")) {
      // Intrude 10px into the notch for Realme C65 (smaller total height)
      bannerPaddingTop = Math.max(0, (insets.top ?? 0) - 10);
    } else if (deviceModelRaw.includes("realme")) {
      // Slight intrusion for other Realme devices
      bannerPaddingTop = Math.max(0, (insets.top ?? 0) - 6);
    } else {
      // Default: don't intrude, keep under the safe area
      bannerPaddingTop = insets.top ?? 0;
    }
  } catch (e) {
    bannerPaddingTop = insets.top ?? 0;
  }

  return (
    <Animated.View
      style={[
        styles.bannerContainer,
        { transform: [{ translateY: slideAnim }], top: 0 },
      ]}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        style={[
          styles.banner,
          { backgroundColor: isOfflineMode ? "#EF4444" : "#22C55E", marginTop: bannerPaddingTop },
        ]}
        onPress={toggleOfflineMode}
        activeOpacity={0.8}
      >
        <MaterialIcons
          name={networkState.isConnected ? "wifi" : "wifi-off"}
          size={12}
          color="white"
          style={{ marginRight: 6 }}
        />
        <Text style={styles.bannerText}>
          {isOfflineMode ? "OFFLINE MODE" : "ONLINE MODE"}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bannerContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 9999,
    elevation: 9999,
  },
  banner: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 4,
    paddingHorizontal: 12,
    // small shadow similar to status bar overlay
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 4,
  },
  bannerText: {
    color: "white",
    fontSize: 12,
    fontWeight: "600",
  },
});