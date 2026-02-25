import { useTheme } from "@/app/providers/ThemeProvider";
import { useAppTour } from "@/context/appTourContext";
import { useI18n } from "@/i18n/I18nProvider";
import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { router } from "expo-router";
import React, { useMemo, useRef, useState } from "react";
import { Dimensions, Text, TouchableOpacity, View } from "react-native";
import { Modal, Portal } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import Tooltip from "react-native-walkthrough-tooltip";
import AIBotIcon from "./AIBotIcon";

export default function VenmoTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width } = Dimensions.get("window");
  const { colors, mode } = useTheme();

  // Màu động cho tab bar
  const BAR_BG = colors.card;
  const ACTIVE = mode === "dark" ? "#60A5FA" : "#1D4ED8";
  const INACTIVE = mode === "dark" ? "#9CA3AF" : "#6B7280";
  const { t } = useI18n();
  const { shouldShowTour, currentStep, nextStep } = useAppTour();
  const [showMenu, setShowMenu] = useState(false);
  const aiBotRef = useRef<TouchableOpacity>(null);

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
        // Ensure tab bar appears above other content
        zIndex: 60,
        elevation: 16,
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
          shadowOpacity: 0.08,
          shadowRadius: 8,
          elevation: 12,
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
      <View
        style={{
          position: "absolute",
          left: width / 2 - BTN_R,
          bottom: BAR_H - BTN_R,
          width: BTN_R * 2,
          height: BTN_R * 2,
          zIndex: 100,
          elevation: 20,
        }}
      >
        <Tooltip
          isVisible={shouldShowTour && currentStep === 0}
          content={
            <View style={{ padding: 0 }}>
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: "700",
                  color: "#111",
                  marginBottom: 4,
                }}
              >
                🤖 Trợ lý AI
              </Text>
              <Text style={{ fontSize: 14, color: "#666"}}>
                Nhấn vào đây để mở menu AI. Bạn có thể chat với AI hoặc tạo giao
                dịch thủ công.
              </Text>
              <TouchableOpacity
                onPress={() => {
                  nextStep();
                  setShowMenu(true);
                }}
                style={{
                  backgroundColor: "#10B981",
                  paddingVertical: 4,
                  paddingHorizontal: 16,
                  borderRadius: 8,
                  alignItems: "center",
                  marginTop: 8,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "600" }}>Tiếp tục</Text>
              </TouchableOpacity>
            </View>
          }
          placement="top"
          onClose={() => nextStep()}
          contentStyle={{
            backgroundColor: "#fff",
            borderRadius: 12,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.25,
            shadowRadius: 8,
            elevation: 5,
          }}
        >
          <TouchableOpacity
            ref={aiBotRef}
            onPress={() => setShowMenu(true)}
            activeOpacity={0.85}
            style={{
              width: "100%",
              height: "100%",
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
        </Tooltip>
      </View>

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
          <Tooltip
            isVisible={shouldShowTour && currentStep === 1}
            content={
              <View style={{ padding: 8 }}>
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: "700",
                    color: "#111",
                    marginBottom: 8,
                  }}
                >
                  💬 Chat với AI
                </Text>
                <Text style={{ fontSize: 14, color: "#666", marginBottom: 12 }}>
                  Chọn "Chatbot AI" để trò chuyện với AI. AI sẽ giúp bạn tạo
                  giao dịch bằng giọng nói hoặc văn bản.
                </Text>
                <TouchableOpacity
                  onPress={() => {
                  nextStep();
                    setShowMenu(false);
                    router.push("/chatbot");
                  }}
                  style={{
                    backgroundColor: "#10B981",
                    paddingVertical: 8,
                    paddingHorizontal: 16,
                    borderRadius: 8,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "600" }}>
                    Tiếp tục
                  </Text>
                </TouchableOpacity>
              </View>
            }
            placement="top"
            onClose={() => nextStep()}
            contentStyle={{
              backgroundColor: "#fff",
              borderRadius: 12,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.25,
              shadowRadius: 8,
              elevation: 5,
            }}
            tooltipStyle={{ maxWidth: 280 }}
          >
            <TouchableOpacity
                onPress={() => {
                setShowMenu(false);
                router.push("/chatbot");
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
                {t("chatbotAI")}
              </Text>
            </TouchableOpacity>
          </Tooltip>

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
              {t("manualTransaction")}
            </Text>
          </TouchableOpacity>
        </Modal>
      </Portal>
    </View>
  );
}
