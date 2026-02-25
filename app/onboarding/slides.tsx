import { useTheme } from "@/app/providers/ThemeProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import {
  Dimensions,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

const { width, height } = Dimensions.get("window");

const slideKeys = [
  {
    key: "s1",
    titleKey: "manageExpenses",
    descKey: "manageExpensesDesc",
    image: require("../../assets/images/slide1.jpg"),
  },
  {
    key: "s2",
    titleKey: "smartBudgetTitle",
    descKey: "smartBudgetDesc",
    image: require("../../assets/images/slide2.jpg"),
  },
  {
    key: "s3",
    titleKey: "saveReminders",
    descKey: "saveRemindersDesc",
    image: require("../../assets/images/slide3.jpg"),
  },
  {
    key: "s4",
    titleKey: "visualAnalysis",
    descKey: "visualAnalysisDesc",
    image: require("../../assets/images/slide4.jpg"),
  },
  {
    key: "s5",
    titleKey: "aiAssistantTitle",
    descKey: "aiAssistantDesc",
    image: require("../../assets/images/slide5.jpg"),
  },
];

export default function Slides() {
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView | null>(null);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useI18n();

  const onNext = () => {
    if (index < slideKeys.length - 1) {
      const nextIndex = index + 1;
      scrollRef.current?.scrollTo({ x: nextIndex * width, animated: true });
      setIndex(nextIndex);
    } else {
      router.replace("/auth/login");
    }
  };

  const onMomentum = (e: any) => {
    const x = e.nativeEvent.contentOffset.x;
    const idx = Math.round(x / width);
    setIndex(idx);
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["top", "bottom"]}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentum}
      >
        {slideKeys.map((s) => (
          <View key={s.key} style={[styles.slide, { width }]}>
            <View style={styles.topText}>
              <Text style={[styles.slideTitle, { color: colors.text }]}>
                {t(s.titleKey)}
              </Text>
              <Text style={[styles.slideDesc, { color: colors.subText }]}>
                {t(s.descKey)}
              </Text>
            </View>

            <View style={styles.imageWrap}>
              <Image
                source={s.image}
                style={styles.image}
                resizeMode="contain"
              />
            </View>
          </View>
        ))}
      </ScrollView>

      <View
        style={[styles.footer, { paddingBottom: 12 }]}
        pointerEvents="box-none"
      >
        <View style={styles.pager}>
          {slideKeys.map((_, idx) => (
            <View
              key={idx}
              style={[
                styles.dot,
                { backgroundColor: colors.divider },
                idx === index && [
                  styles.dotActive,
                  { backgroundColor: colors.text },
                ],
              ]}
            />
          ))}
        </View>

        <TouchableOpacity
          style={[styles.arrow, { marginBottom: 12 }]}
          onPress={onNext}
          accessibilityLabel="Next slide"
        >
          <Ionicons name="arrow-forward" size={22} color="#fff" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  slide: {
    height,
    justifyContent: "flex-start",
    alignItems: "center",
    paddingTop: 16,
  },
  topText: { paddingHorizontal: 24, alignItems: "center" },
  imageWrap: { justifyContent: "center", alignItems: "center", marginTop: 4 },
  image: { width: width * 0.9, height: height * 0.52 },
  textWrap: {
    paddingTop: 12,
    marginBottom: 40,
    left: 24,
    right: 24,
    alignItems: "center",
  },
  slideTitle: {
    fontSize: 32,
    fontWeight: "800",
    textAlign: "center",
  },
  slideDesc: {
    fontSize: 17,
    marginTop: 6,
    textAlign: "center",
    lineHeight: 22,
  },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 24,
    right: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pager: { flexDirection: "row" },
  dot: {
    width: 10,
    height: 4,
    borderRadius: 4,
    marginHorizontal: 6,
  },
  dotActive: {
    width: 32,
    height: 6,
    borderRadius: 4,
  },
  arrow: {
    backgroundColor: "#256D7B",
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  arrowText: { color: "#fff", fontSize: 28, lineHeight: 28 },
});
