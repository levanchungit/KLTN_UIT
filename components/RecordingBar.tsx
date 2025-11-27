import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Animated, Text, TouchableOpacity, View } from "react-native";

type RecordingBarProps = {
  isRecording: boolean;
  duration: number;
  colors: any;
  mode: "light" | "dark";
  spokenText: string; // text nhận từ speech
  onCancel: () => void;
  onSend: () => void;
  level?: number; // realtime audio level 0..1
};

function RecordingBar({
  isRecording,
  duration,
  colors,
  mode,
  spokenText,
  onCancel,
  onSend,
  level,
}: RecordingBarProps) {
  const NUM_BARS = 18;
  const progress = React.useRef(new Animated.Value(0)).current;
  const peaks = React.useRef(
    Array.from({ length: NUM_BARS }, () => 0.2 + Math.random() * 0.8)
  ).current;
  const animRef = React.useRef<Animated.CompositeAnimation | null>(null);
  const meter = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (typeof level === "number") {
      Animated.timing(meter, {
        toValue: Math.max(0, Math.min(1, level)),
        duration: 120,
        useNativeDriver: true,
      }).start();
    }
  }, [level, meter]);

  React.useEffect(() => {
    // keep the original gentle animation as fallback when no level provided
    if (isRecording && typeof level !== "number") {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(progress, {
            toValue: 1,
            duration: 700,
            useNativeDriver: true,
          }),
          Animated.timing(progress, {
            toValue: 0,
            duration: 700,
            useNativeDriver: true,
          }),
        ])
      );
      animRef.current = anim;
      anim.start();
    } else {
      progress.setValue(0);
      animRef.current?.stop();
      animRef.current = null;
    }
    return () => {
      animRef.current?.stop();
      animRef.current = null;
    };
  }, [isRecording, progress, level]);

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  if (!isRecording && !spokenText) return null;

  return (
    <View
      style={{
        paddingHorizontal: 12,
        marginHorizontal: 16,
        marginBottom: 8,
        height: 40,
        borderRadius: 999,
        backgroundColor: mode === "dark" ? "#111827" : "#111827",
        flexDirection: "row",
        alignItems: "center",
      }}
    >
      {/* nút + bên trái (optional) */}
      <TouchableOpacity
        style={{
          width: 28,
          height: 28,
          borderRadius: 999,
          alignItems: "center",
          justifyContent: "center",
          marginRight: 8,
        }}
      >
        <Ionicons name="add" size={18} color="#9CA3AF" />
      </TouchableOpacity>

      {/* line + waveform + thời gian + text preview */}
      <View style={{ flex: 1, justifyContent: "center" }}>
        {/* dashed line */}
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: 1,
            backgroundColor: "#374151",
            opacity: 0.8,
          }}
        />

        {/* waveform centered */}
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: 18,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View
            style={{
              width: "80%",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              height: 18,
            }}
          >
            {Array.from({ length: NUM_BARS }).map((_, i) => {
              const source = typeof level === "number" ? meter : progress;
              const scaleY = source.interpolate
                ? source.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.25, peaks[i]],
                  })
                : 1;

              return (
                <Animated.View
                  key={i}
                  style={{
                    flex: 1,
                    marginHorizontal: 1,
                    borderRadius: 999,
                    backgroundColor: mode === "dark" ? "#60A5FA" : "#3B82F6",
                    transform: [{ scaleY }],
                    height: 12,
                  }}
                />
              );
            })}
          </View>
        </View>

        {/* thời lượng + preview text bên trái */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Text
            style={{
              color: "#9CA3AF",
              fontSize: 12,
              fontVariant: ["tabular-nums"],
            }}
          >
            {formatDuration(duration)}
          </Text>
          {spokenText ? (
            <Text
              numberOfLines={1}
              style={{ color: "#D1D5DB", fontSize: 12, flex: 1 }}
            >
              {spokenText}
            </Text>
          ) : (
            <Text style={{ color: "#6B7280", fontSize: 12, flex: 1 }}>
              Đang nghe...
            </Text>
          )}
        </View>
      </View>

      {/* nút X & ✓ */}
      <TouchableOpacity
        style={{
          marginLeft: 8,
          width: 28,
          height: 28,
          justifyContent: "center",
          alignItems: "center",
        }}
        onPress={onCancel}
      >
        <Ionicons name="close" size={18} color="#F97373" />
      </TouchableOpacity>

      <TouchableOpacity
        style={{
          marginLeft: 4,
          width: 28,
          height: 28,
          justifyContent: "center",
          alignItems: "center",
        }}
        onPress={onSend}
      >
        <Ionicons name="checkmark" size={18} color="#22C55E" />
      </TouchableOpacity>
    </View>
  );
}
export default RecordingBar;
