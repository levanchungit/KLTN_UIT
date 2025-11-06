// components/VenmoTabBar.tsx
import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { router } from "expo-router";
import React, { useMemo } from "react";
import { Dimensions, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

const BAR_BG = "#ffffff";
const ACTIVE = "#1D4ED8";
const INACTIVE = "#6B7280";

export default function VenmoTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width } = Dimensions.get("window");

  // Chỉ lấy 4 tab chính theo data của bạn
  const mainRouteNames = new Set([
    "index",
    "transactions",
    "budget",
    "setting",
  ]);
  const routes = state.routes.filter((r) => mainRouteNames.has(r.name));

  // Kích thước bar + notch
  const BAR_H = 60 + insets.bottom;
  const BTN_R = 30; // bán kính nút giữa (giữ như bạn muốn)
  const NOTCH_H = 38; // ⬅️ độ sâu rãnh (giống bạn yêu cầu)
  const NOTCH_PAD = 10; // ⬅️ độ cong/độ nới vai hai bên

  const d = useMemo(() => {
    const c = width / 2;
    const left = c - (BTN_R + NOTCH_PAD);
    const right = c + (BTN_R + NOTCH_PAD);
    return [
      `M0 0`,
      `H${left}`,
      `C ${left + 8} 0, ${c - BTN_R} ${NOTCH_H}, ${c} ${NOTCH_H}`,
      `C ${c + BTN_R} ${NOTCH_H}, ${right - 8} 0, ${right} 0`,
      `H${width}`,
      `V${BAR_H}`,
      `H0`,
      `Z`,
    ].join(" ");
  }, [width, BAR_H, BTN_R, NOTCH_PAD, NOTCH_H]);

  const getIsFocused = (routeKey: string) =>
    state.index === state.routes.findIndex((r) => r.key === routeKey);

  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: BAR_H,
      }}
    >
      {/* Nền có rãnh */}
      <Svg width={width} height={BAR_H} style={{ position: "absolute" }}>
        <Path d={d} fill={BAR_BG} />
      </Svg>

      {/* Shadow của bar */}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: BAR_H,
          shadowColor: "#000",
          shadowOpacity: 0.06,
          shadowRadius: 6,
          elevation: 8,
        }}
      />

      {/* Các item trái & phải (đọc icon/title từ options bạn đã set) */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "space-between",
          height: BAR_H,
          paddingBottom: insets.bottom ? insets.bottom - 2 : 8,
          paddingHorizontal: 16,
        }}
      >
        {routes.map((route, idx) => {
          const isFocused = getIsFocused(route.key);
          const options = descriptors[route.key]?.options || {};
          const label =
            (options.tabBarLabel as string) ||
            (options.title as string) ||
            route.name;

          const color = isFocused ? ACTIVE : INACTIVE;
          const size = 24;

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name as never);
            }
          };

          return (
            <TouchableOpacity
              key={route.key}
              onPress={onPress}
              activeOpacity={0.85}
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
              }}
            >
              {typeof options.tabBarIcon === "function" ? (
                (options.tabBarIcon as any)({ focused: isFocused, color, size })
              ) : (
                <Ionicons name="ellipse-outline" size={size} color={color} />
              )}
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 12,
                  fontWeight: isFocused ? "700" : "500",
                  color,
                }}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Nút giữa */}
      <TouchableOpacity
        onPress={() => router.push("/chatbox")}
        activeOpacity={0.9}
        style={{
          position: "absolute",
          left: width / 2 - BTN_R,
          bottom: insets.bottom * 1.6,
          width: BTN_R * 2,
          height: BTN_R * 2,
          borderRadius: BTN_R,
          backgroundColor: "#2563EB",
          justifyContent: "center",
          alignItems: "center",
          borderWidth: 4,
          borderColor: BAR_BG,
          shadowColor: "#000",
          shadowOpacity: 0.15,
          shadowRadius: 8,
          elevation: 8,
        }}
      >
        {/* Đổi thành logo/app icon nếu muốn */}
        <Ionicons name="add" size={30} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}
