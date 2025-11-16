import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function ChatboxIntro() {
  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.inner}>
        <Text style={styles.title}>Trợ lý AI</Text>
        <Text style={styles.desc}>
          Bạn có thể tạo giao dịch bằng cách nhập câu chữ, AI sẽ gợi ý phân
          loại.
        </Text>
        <TouchableOpacity
          style={styles.btn}
          onPress={() => router.push("/chatbox?onboarding=1")}
        >
          <Text style={styles.btnText}>Mở Chatbox AI (Demo)</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.skip}
          onPress={() => router.push("/onboarding/reminder-setup")}
        >
          <Text style={{ color: "#16A34A" }}>Bỏ qua</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  inner: { flex: 1, padding: 24, justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 8 },
  desc: { color: "#666", marginBottom: 20 },
  btn: {
    backgroundColor: "#16A34A",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700" },
  skip: { marginTop: 12, alignItems: "center" },
});
