# Rollback / Cleanup Steps

Nếu cần revert module chatbot và quay lại `chatbox.tsx`, thực hiện:

1. Tắt feature flag: `await setChatbotEnabled(false)` (see `featureFlag.ts`) hoặc set AsyncStorage key `feature_chatbot_enabled_v1` = "0".
2. Xóa/ignore route `chatbot` trong `app/_layout.tsx` (remove `<Stack.Screen name="chatbot" />`).
3. Xoá thư mục `services/chatbot/` hoặc move ra nơi khác để lưu trữ.
4. Xoá model files tại `FileSystem.documentDirectory + 'chatbot_model/'` nếu muốn giải phóng bộ nhớ.
5. Rebuild app và kiểm tra `chatbox.tsx` hoạt động bình thường.

Ghi chú: trước khi xóa model, backup metadata (`modelPersistence.loadMetadata()`) để có thể restore nếu cần.

