import { useTheme } from "@/app/providers/ThemeProvider";
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

export default function Budget() {
  const { colors } = useTheme();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.title}>Ngân sách</Text>
        <Text style={styles.subtitle}>Tính năng đang phát triển...</Text>
      </ScrollView>
    </View>
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
