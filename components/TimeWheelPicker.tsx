import React, { useEffect, useRef, useState } from "react";
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  View,
  Dimensions,
} from "react-native";
import { useTheme } from "@/app/providers/ThemeProvider";

type TimeWheelPickerProps = {
  initialHour: number;
  initialMinute: number;
  onHourChange: (hour: number) => void;
  onMinuteChange: (minute: number) => void;
};

const ITEM_HEIGHT = 56;
const VISIBLE_COUNT = 5;
const VISIBLE_HEIGHT = ITEM_HEIGHT * VISIBLE_COUNT;
const COLUMN_WIDTH = 96;
const COLON_WIDTH = 32;
const COLUMN_GAP = 12;
const OVERLAY_WIDTH = COLUMN_WIDTH * 2 + COLON_WIDTH + COLUMN_GAP * 2;
const LABEL_HEIGHT = 22; // approx: fontSize(14) + marginBottom(8)

export default function TimeWheelPicker({
  initialHour,
  initialMinute,
  onHourChange,
  onMinuteChange,
}: TimeWheelPickerProps) {
  const { colors } = useTheme();
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 }, (_, i) => i);
  const windowWidth = Dimensions.get("window").width;

  const hourRef = useRef<FlatList<number> | null>(null);
  const minuteRef = useRef<FlatList<number> | null>(null);

  const [selectedHourIndex, setSelectedHourIndex] = useState<number>(initialHour);
  const [selectedMinuteIndex, setSelectedMinuteIndex] = useState<number>(initialMinute);

  useEffect(() => {
    // Ensure lists are scrolled to initial positions after mount and centered,
    // and sync internal index + parent callback.
    const t = setTimeout(() => {
      try {
        if (hourRef.current?.scrollToIndex) {
          hourRef.current.scrollToIndex({ index: initialHour, animated: false, viewPosition: 0.5 });
        } else {
          hourRef.current?.scrollToOffset({ offset: initialHour * ITEM_HEIGHT, animated: false });
        }
      } catch (e) {
        // ignore
      }
      try {
        if (minuteRef.current?.scrollToIndex) {
          minuteRef.current.scrollToIndex({ index: initialMinute, animated: false, viewPosition: 0.5 });
        } else {
          minuteRef.current?.scrollToOffset({ offset: initialMinute * ITEM_HEIGHT, animated: false });
        }
      } catch (e) {
        // ignore
      }

      // set internal selected indices and notify parent
      setSelectedHourIndex(initialHour);
      setSelectedMinuteIndex(initialMinute);
      onHourChange(initialHour);
      onMinuteChange(initialMinute);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onHourMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
    const bounded = Math.max(0, Math.min(hours.length - 1, index));
    setSelectedHourIndex(bounded);
    onHourChange(bounded);
    // snap
    hourRef.current?.scrollToOffset({ offset: bounded * ITEM_HEIGHT, animated: true });
  };

  const onMinuteMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
    const bounded = Math.max(0, Math.min(minutes.length - 1, index));
    setSelectedMinuteIndex(bounded);
    onMinuteChange(bounded);
    minuteRef.current?.scrollToOffset({ offset: bounded * ITEM_HEIGHT, animated: true });
  };

  const renderItem =
    (selectedIndex: number) =>
    ({ item, index }: { item: number; index: number }) => {
      const isCenter = index === selectedIndex;
      return (
        <View style={styles.itemContainer}>
          <Text
            style={[
              styles.itemText,
              isCenter
                ? { color: colors.text, fontSize: 28, fontWeight: "800", opacity: 1 }
                : { color: colors.subText, fontSize: 18, opacity: 0.35 },
            ]}
          >
            {item.toString().padStart(2, "0")}
          </Text>
        </View>
      );
    };

  const getItemLayout = (_: any, index: number) => ({
    length: ITEM_HEIGHT,
    offset: ITEM_HEIGHT * index,
    index,
  });

  return (
    <View style={styles.container}>
      <View style={styles.pickerArea}>
        <View style={[styles.column, { width: COLUMN_WIDTH }]}>
          <Text style={[styles.label, { color: colors.subText, textAlign: "center", marginBottom: 8 }]}>
            Giờ
          </Text>
          <FlatList
            ref={hourRef}
            data={hours}
            keyExtractor={(h) => `h-${h}`}
            showsVerticalScrollIndicator={false}
            snapToInterval={ITEM_HEIGHT}
            decelerationRate="fast"
            onMomentumScrollEnd={onHourMomentumEnd}
            onScroll={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
              if (idx !== selectedHourIndex) {
                setSelectedHourIndex(idx);
              }
            }}
            scrollEventThrottle={16}
            getItemLayout={getItemLayout}
            contentContainerStyle={{
              paddingTop: (VISIBLE_HEIGHT - ITEM_HEIGHT) / 2,
              paddingBottom: (VISIBLE_HEIGHT - ITEM_HEIGHT) / 2,
            }}
            style={{ height: VISIBLE_HEIGHT }}
            renderItem={renderItem(selectedHourIndex)}
          />
        </View>

        <View style={[styles.colon, { width: COLON_WIDTH, marginHorizontal: COLUMN_GAP, paddingTop: LABEL_HEIGHT }]}>
          <Text style={styles.colonText}>:</Text>
        </View>

        <View style={[styles.column, { width: COLUMN_WIDTH }]}>
          <Text style={[styles.label, { color: colors.subText, textAlign: "center", marginBottom: 8 }]}>
            Phút
          </Text>
          <FlatList
            ref={minuteRef}
            data={minutes}
            keyExtractor={(m) => `m-${m}`}
            showsVerticalScrollIndicator={false}
            snapToInterval={ITEM_HEIGHT}
            decelerationRate="fast"
            onMomentumScrollEnd={onMinuteMomentumEnd}
            onScroll={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
              if (idx !== selectedMinuteIndex) {
                setSelectedMinuteIndex(idx);
              }
            }}
            scrollEventThrottle={16}
            getItemLayout={getItemLayout}
            contentContainerStyle={{
              paddingTop: (VISIBLE_HEIGHT - ITEM_HEIGHT) / 2,
              paddingBottom: (VISIBLE_HEIGHT - ITEM_HEIGHT) / 2,
            }}
            style={{ height: VISIBLE_HEIGHT }}
            renderItem={renderItem(selectedMinuteIndex)}
          />
        </View>

        {/* center overlay inside picker area so it's aligned with lists */}
        <View
          pointerEvents="none"
          style={[
            styles.centerOverlay,
            {
              borderColor: colors.divider,
              top: LABEL_HEIGHT + (VISIBLE_HEIGHT - ITEM_HEIGHT) / 2,
              width: Math.min(OVERLAY_WIDTH, windowWidth - 80),
              alignSelf: "center",
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  column: {
    alignItems: "center",
    marginHorizontal: 0,
    width: COLUMN_WIDTH,
  },
  labelContainer: {
    width: COLUMN_WIDTH,
    alignItems: "center",
    justifyContent: "center",
  },
  labelCenter: {
    width: 32,
  },
  labelsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  pickerArea: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 14,
    marginBottom: 8,
  },
  itemContainer: {
    height: ITEM_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  itemText: {
    fontSize: 18,
    fontWeight: "600",
  },
  colon: {
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 6,
  },
  colonText: {
    fontSize: 32,
    fontWeight: "700",
  },
  centerOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    height: ITEM_HEIGHT,
    top: (VISIBLE_HEIGHT - ITEM_HEIGHT) / 2 + 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    backgroundColor: "transparent",
  },
});

