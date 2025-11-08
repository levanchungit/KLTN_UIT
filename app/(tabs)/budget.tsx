import { useTheme } from "@/app/providers/ThemeProvider";
import React from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function Budget() {
  const { colors } = useTheme();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Text style={styles.title}>Ngân sách</Text>
        <Text style={styles.subtitle}>Tính năng đang phát triển...</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: {
  background: string;
  card: string;
  text: string;
  subText: string;
  divider: string;
  icon: string;
}) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    title: { fontSize: 24, fontWeight: "700", color: c.text, marginBottom: 8 },
    subtitle: { fontSize: 16, color: c.subText },
  });
