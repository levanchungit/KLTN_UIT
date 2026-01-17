import { useTheme } from "@/app/providers/ThemeProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { logCorrection, logPrediction } from "@/repos/mlRepo";
import { transactionClassifier } from "@/services/chatbot/transactionClassifier";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  InteractionManager,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Msg = {
  role: "user" | "bot";
  text: string;
  sampleId?: string | null;
  suggestedCategoryId?: string | null;
  suggestedCategoryName?: string | null;
};

export default function Chatbot() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [messages, setMessages] = useState<Msg[]>([
    { role: "bot", text: t("chatWelcome") },
  ]);
  const [input, setInput] = useState("");
  const [isInitializing, setIsInitializing] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const flatRef = useRef<FlatList>(null);

  useEffect(() => {
    // Initialize classifier once on mount
    const initClassifier = async () => {
      try {
        await transactionClassifier.initialize();
      } catch (e) {
        console.warn("Failed to initialize classifier:", e);
      } finally {
        setIsInitializing(false);
      }
    };
    initClassifier();
  }, []);

  useEffect(() => {
    // Auto-scroll when messages change
    requestAnimationFrame(() => {
      flatRef.current?.scrollToEnd({ animated: true });
    });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isInitializing || isProcessing) return;

    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setIsProcessing(true);

    // Defer heavy TensorFlow operations to avoid blocking UI
    InteractionManager.runAfterInteractions(async () => {
      try {
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

          const displayName = pred.categoryName ?? pred.categoryId;
          setMessages((m) => [
            ...m,
            {
              role: "bot",
              text: `Đề xuất danh mục: ${displayName} (độ tin cậy ${(pred.confidence * 100).toFixed(
                0
              )}%) — bấm để chấp nhận`,
              sampleId,
              suggestedCategoryId: pred.categoryId,
              suggestedCategoryName: displayName,
            },
          ]);
        } else {
          setMessages((m) => [...m, { role: "bot", text: t("chatReplyPlaceholder") }]);
        }
      } catch (e) {
        setMessages((m) => [...m, { role: "bot", text: t("chatReplyPlaceholder") }]);
      } finally {
        setIsProcessing(false);
      }
    });
  }, [input, t, isInitializing, isProcessing]);

  const acceptSuggestion = useCallback(
    async (sampleId?: string | null, suggestedCategoryId?: string | null) => {
      if (!sampleId || !suggestedCategoryId) return;

      // Immediate UI feedback
      setMessages((m) => [...m, { role: "bot", text: "Cám ơn — đã ghi nhận lựa chọn của bạn." }]);

      // Defer heavy operations to background
      InteractionManager.runAfterInteractions(async () => {
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
      });
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
            { backgroundColor: isUser ? (colors as any).primary : (colors as any).card },
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

        <View style={[styles.inputRow, { borderTopColor: (colors as any).border }]}>
          <TextInput
            placeholder={t("chatPlaceholder") || "Nhập tin nhắn..."}
            placeholderTextColor={(colors as any).muted}
            value={input}
            onChangeText={setInput}
            style={[styles.input, { color: colors.text }]}
            multiline
          />
          <TouchableOpacity
            onPress={handleSend}
            style={[styles.sendButton, (isInitializing || isProcessing) && styles.sendButtonDisabled]}
            disabled={isInitializing || isProcessing}
          >
            {isInitializing ? (
              <Text style={{ color: "#fff" }}>Đang khởi tạo...</Text>
            ) : isProcessing ? (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={{ color: "#fff", marginLeft: 8 }}>Đang xử lý...</Text>
              </View>
            ) : (
              <Text style={{ color: "#fff" }}>{t("send") || "Gửi"}</Text>
            )}
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
  sendButtonDisabled: {
    backgroundColor: "#9CA3AF",
  },
});

