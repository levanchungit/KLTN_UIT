import React, { useCallback, useEffect, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/app/providers/ThemeProvider";
import { transactionClassifier } from "@/services/chatbot/transactionClassifier";
import { logPrediction, logCorrection } from "@/repos/mlRepo";

type Msg = {
  role: "user" | "bot";
  text: string;
  sampleId?: string | null;
  suggestedCategoryId?: string | null;
};

export default function Chatbot() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [messages, setMessages] = useState<Msg[]>([
    { role: "bot", text: t("chatWelcome") },
  ]);
  const [input, setInput] = useState("");
  const flatRef = useRef<FlatList>(null);

  useEffect(() => {
    // Auto-scroll when messages change
    requestAnimationFrame(() => {
      flatRef.current?.scrollToEnd({ animated: true });
    });
  }, [messages]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    // Placeholder: enqueue processing (prediction, logging) later
    (async () => {
      try {
        await transactionClassifier.initialize();
        const pred = await transactionClassifier.predict(text);
        if (pred) {
          // Log prediction to ml repo and capture sample id
          let sampleId: string | null = null;
          try {
            sampleId = (await logPrediction({
              text,
              amount: null,
              io: "OUT",
              predictedCategoryId: pred.categoryId,
              confidence: pred.confidence,
            })) as unknown as string;
          } catch (e) {
            // ignore logging failures
          }

          setMessages((m) => [
            ...m,
            {
              role: "bot",
              text: `Đề xuất danh mục: ${pred.categoryId} (độ tin cậy ${(pred.confidence * 100).toFixed(
                0
              )}%) — bấm để chấp nhận`,
              sampleId,
              suggestedCategoryId: pred.categoryId,
            },
          ]);
        } else {
          setMessages((m) => [...m, { role: "bot", text: t("chatReplyPlaceholder") }]);
        }
      } catch (e) {
        setMessages((m) => [...m, { role: "bot", text: t("chatReplyPlaceholder") }]);
      }
    })();
  }, [input, t]);

  const acceptSuggestion = useCallback(
    async (sampleId?: string | null, suggestedCategoryId?: string | null) => {
      if (!sampleId || !suggestedCategoryId) return;
      try {
        await logCorrection({ id: sampleId, chosenCategoryId: suggestedCategoryId });
      } catch (e) {
        // ignore
      }
      try {
        await transactionClassifier.learnFromCorrection("accepted suggestion", suggestedCategoryId);
      } catch (e) {
        // ignore
      }
      setMessages((m) => [...m, { role: "bot", text: "Cám ơn — đã ghi nhận lựa chọn của bạn." }]);
    },
    []
  );

  const renderItem = useCallback(
    ({ item }: { item: Msg }) => {
      const isUser = item.role === "user";
      const bubble = (
        <View
          style={[
            styles.bubble,
            { alignSelf: isUser ? "flex-end" : "flex-start" },
            { backgroundColor: isUser ? colors.primary : colors.card },
          ]}
        >
          <Text style={{ color: isUser ? "#fff" : colors.text }}>{item.text}</Text>
        </View>
      );

      if (!isUser && item.sampleId) {
        return (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => acceptSuggestion(item.sampleId, item.suggestedCategoryId)}
          >
            {bubble}
          </TouchableOpacity>
        );
      }
      return bubble;
    },
    [colors, acceptSuggestion]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={(_, i) => String(i)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 16 }}
        />

        <View style={[styles.inputRow, { borderTopColor: colors.border }]}>
          <TextInput
            placeholder={t("chatPlaceholder") || "Nhập tin nhắn..."}
            placeholderTextColor={colors.muted}
            value={input}
            onChangeText={setInput}
            style={[styles.input, { color: colors.text }]}
            multiline
          />
          <TouchableOpacity onPress={handleSend} style={styles.sendButton}>
            <Text style={{ color: "#fff" }}>{t("send") || "Gửi"}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bubble: {
    padding: 12,
    borderRadius: 12,
    maxWidth: "80%",
  },
  inputRow: {
    flexDirection: "row",
    padding: 8,
    alignItems: "flex-end",
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "transparent",
  },
  sendButton: {
    marginLeft: 8,
    backgroundColor: "#16A34A",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
});

