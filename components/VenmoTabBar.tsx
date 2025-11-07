// components/VenmoTabBar.tsx
import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { router } from "expo-router";
import React, { useMemo } from "react";
import { Dimensions, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import AIBotIcon from "./AIBotIcon";

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
          height: BAR_H,
          paddingBottom: insets.bottom ? insets.bottom - 2 : 8,
        }}
      >
        {/* 2 items bên trái */}
        <View
          style={{
            flexDirection: "row",
            flex: 1,
            justifyContent: "space-around",
            paddingLeft: 8,
          }}
        >
          {routes.slice(0, 2).map((route) => {
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
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 3,
                  minWidth: 60,
                }}
              >
                {typeof options.tabBarIcon === "function" ? (
                  (options.tabBarIcon as any)({
                    focused: isFocused,
                    color,
                    size,
                  })
                ) : (
                  <Ionicons name="ellipse-outline" size={size} color={color} />
                )}
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 11,
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

        {/* Khoảng trống cho nút giữa */}
        <View style={{ width: BTN_R * 2 + 24 }} />

        {/* 2 items bên phải */}
        <View
          style={{
            flexDirection: "row",
            flex: 1,
            justifyContent: "space-around",
            paddingRight: 8,
          }}
        >
          {routes.slice(2, 4).map((route) => {
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
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 3,
                  minWidth: 60,
                }}
              >
                {typeof options.tabBarIcon === "function" ? (
                  (options.tabBarIcon as any)({
                    focused: isFocused,
                    color,
                    size,
                  })
                ) : (
                  <Ionicons name="ellipse-outline" size={size} color={color} />
                )}
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 11,
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
      </View>

      {/* Nút giữa - AI Chatbot Signature */}
      <TouchableOpacity
        onPress={() => router.push("/chatbox")}
        activeOpacity={0.85}
        style={{
          position: "absolute",
          left: width / 2 - BTN_R,
          bottom: insets.bottom * 1.6,
          width: BTN_R * 2,
          height: BTN_R * 2,
          justifyContent: "center",
          alignItems: "center",
          shadowColor: "#4285F4",
          shadowOpacity: 0.6,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 8 },
          elevation: 20,
        }}
      >
        {/* Glow background layer */}
        <View
          style={{
            position: "absolute",
            width: BTN_R * 2 + 10,
            height: BTN_R * 2 + 10,
            borderRadius: (BTN_R * 2 + 10) / 2,
            backgroundColor: "#4285F4",
            opacity: 0.15,
          }}
        />
        <AIBotIcon size={52} />
      </TouchableOpacity>
    </View>
  );
}
