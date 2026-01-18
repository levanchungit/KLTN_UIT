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

const slides = [
  {
    key: "s1",
    title: "Quản lý chi tiêu",
    desc: "Ghi chép, phân loại và theo dõi chi tiêu hàng ngày.",
    image: require("../../assets/images/slide1.jpg"),
  },
  {
    key: "s2",
    title: "Ngân sách thông minh",
    desc: "Tạo ngân sách và theo dõi tiến độ tự động.",
    image: require("../../assets/images/slide2.jpg"),
  },
  {
    key: "s3",
    title: "Nhắc nhở tiết kiệm",
    desc: "Nhắc nhở hàng ngày để bạn không quên mục tiêu tài chính.",
    image: require("../../assets/images/slide3.jpg"),
  },
  {
    key: "s4",
    title: "Phân tích trực quan",
    desc: "Biểu đồ và báo cáo giúp bạn hiểu rõ hơn thói quen chi tiêu.",
    image: require("../../assets/images/slide4.jpg"),
  },
  {
    key: "s5",
    title: "Trợ lý AI",
    desc: "Dùng chatbotAI để tạo giao dịch bằng văn bản và gợi ý phân loại.",
    image: require("../../assets/images/slide5.jpg"),
  },
];

export default function Slides() {
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView | null>(null);
  const insets = useSafeAreaInsets();

  const onNext = () => {
    if (index < slides.length - 1) {
      const nextIndex = index + 1;
      scrollRef.current?.scrollTo({ x: nextIndex * width, animated: true });
      setIndex(nextIndex);
    } else {
      // After the last slide, go to the login screen
      router.replace("/auth/login");
    }
  };

  const onMomentum = (e: any) => {
    const x = e.nativeEvent.contentOffset.x;
    const idx = Math.round(x / width);
    setIndex(idx);
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentum}
      >
        {slides.map((s) => (
          <View key={s.key} style={[styles.slide, { width }]}>
            <View style={styles.topText}>
              <Text style={styles.slideTitle}>{s.title}</Text>
              <Text style={styles.slideDesc}>{s.desc}</Text>
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
          {slides.map((_, idx) => (
            <View
              key={idx}
              style={[styles.dot, idx === index && styles.dotActive]}
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
  container: { flex: 1, backgroundColor: "#fafafa" },
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
    color: "#111827",
    fontSize: 32,
    fontWeight: "800",
    textAlign: "center",
  },
  slideDesc: {
    color: "#6B7280",
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
    backgroundColor: "#D1D5DB",
    marginHorizontal: 6,
  },
  dotActive: {
    backgroundColor: "#111827",
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
