// components/VenmoTabBar.tsx
import { useTheme } from "@/app/providers/ThemeProvider";
import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { Dimensions, Text, TouchableOpacity, View } from "react-native";
import { Modal, Portal } from "react-native-paper";
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
  const { colors } = useTheme();
  const [showMenu, setShowMenu] = useState(false);

  // Chỉ lấy 4 tab chính theo data của bạn
  const mainRouteNames = new Set([
    "index",
    "transactions",
    "budget",
    "setting",
  ]);
  const routes = state.routes.filter((r) => mainRouteNames.has(r.name));

  // Kích thước bar + notch
  // Reduce overall bar height for a more compact design
  const EXTRA_BOTTOM_SPACE = 4; // minimal visual breathing room
  const BAR_H = 56 + insets.bottom + EXTRA_BOTTOM_SPACE;
  const BTN_R = 30; // bán kính nút giữa (giữ như bạn muốn)

  const d = useMemo(() => {
    const c = width / 2;

    // Perfect Venmo-style oval: wider horizontally, moderate depth
    const horizontalRadius = BTN_R + 12; // wider oval (44px from center)
    const verticalRadius = BTN_R + 12; // shallower depth (36px)

    const left = c - horizontalRadius;
    const right = c + horizontalRadius;

    // Use Bezier curves with precise control points for perfect circular appearance
    // Based on the approximation: control offset = radius * 0.5522847498 (circle constant)
    const hControl = horizontalRadius * 0.5522847498;
    const vControl = verticalRadius * 0.5522847498;

    return [
      `M0 0`,
      `H${left}`,
      // First half of oval: left edge down to bottom center
      `C ${left} ${vControl}, ${
        c - hControl
      } ${verticalRadius}, ${c} ${verticalRadius}`,
      // Second half of oval: bottom center up to right edge
      `C ${c + hControl} ${verticalRadius}, ${right} ${vControl}, ${right} 0`,
      `H${width}`,
      `V${BAR_H}`,
      `H0`,
      `Z`,
    ].join(" ");
  }, [width, BAR_H, BTN_R]);

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
          // Compact padding for tab items
          paddingBottom: (insets.bottom || 6) + 2,
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
        onPress={() => setShowMenu(true)}
        activeOpacity={0.85}
        style={{
          position: "absolute",
          left: width / 2 - BTN_R,
          // Position so 50% of button is above bar edge, 50% below (cut in half)
          bottom: BAR_H - BTN_R,
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

      {/* Menu Modal */}
      <Portal>
        <Modal
          visible={showMenu}
          onDismiss={() => setShowMenu(false)}
          contentContainerStyle={{
            marginHorizontal: 24,
            borderRadius: 16,
            backgroundColor: colors.card,
            padding: 8,
            alignSelf: "center",
            width: 280,
            maxWidth: "90%",
          }}
        >
          <TouchableOpacity
            onPress={() => {
              setShowMenu(false);
              router.push("/chatbox");
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              padding: 16,
              borderRadius: 12,
              gap: 12,
            }}
            activeOpacity={0.7}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: "#E0F2FE",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="chatbubbles" size={20} color="#0284C7" />
            </View>
            <Text
              style={{
                fontSize: 16,
                fontWeight: "600",
                color: colors.text,
                flex: 1,
              }}
            >
              ChatboxAI
            </Text>
          </TouchableOpacity>

          <View
            style={{
              height: 1,
              backgroundColor: colors.divider,
              marginVertical: 4,
            }}
          />

          <TouchableOpacity
            onPress={() => {
              setShowMenu(false);
              router.push("/add-transaction");
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              padding: 16,
              borderRadius: 12,
              gap: 12,
            }}
            activeOpacity={0.7}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: "#FEF3C7",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="add-circle" size={20} color="#F59E0B" />
            </View>
            <Text
              style={{
                fontSize: 16,
                fontWeight: "600",
                color: colors.text,
                flex: 1,
              }}
            >
              Tạo giao dịch thủ công
            </Text>
          </TouchableOpacity>
        </Modal>
      </Portal>
    </View>
  );
}
