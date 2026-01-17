import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "feature_chatbot_enabled_v1";

// Mặc định bật trong dev; có thể tắt trên device bằng lưu giá trị '0'
export async function isChatbotEnabled(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v === null) {
      return true;
    }
    return v !== "0";
  } catch (e) {
    return true;
  }
}

export async function setChatbotEnabled(enabled: boolean) {
  try {
    await AsyncStorage.setItem(KEY, enabled ? "1" : "0");
  } catch (e) {
    // ignore
  }
}

