import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";

const BIOMETRIC_ENABLED_KEY = "@biometric_enabled";

/**
 * Kiểm tra thiết bị có hỗ trợ xác thực sinh trắc học hay không
 */
export async function isBiometricSupported(): Promise<boolean> {
  try {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    return compatible && enrolled;
  } catch {
    return false;
  }
}

/**
 * Lấy loại sinh trắc học khả dụng (vân tay, khuôn mặt, mống mắt)
 */
export async function getBiometricType(): Promise<string> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();

    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      return Platform.OS === "ios" ? "Touch ID" : "Vân tay";
    }
    if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
      return "Mống mắt";
    }

    return "Sinh trắc học";
  } catch {
    return "Sinh trắc học";
  }
}

/**
 * Kiểm tra người dùng đã bật khoá sinh trắc học chưa
 */
export async function isBiometricEnabled(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
    return value === "true";
  } catch {
    return false;
  }
}

/**
 * Bật/tắt khoá sinh trắc học
 */
export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, enabled.toString());
  } catch (err) {
    console.error("Lưu tuỳ chọn sinh trắc học thất bại:", err);
  }
}

/**
 * Xác thực người dùng bằng sinh trắc học
 * Trả về { success: boolean, cancelled: boolean }
 */
export async function authenticateWithBiometric(
  promptMessage?: string
): Promise<{ success: boolean; cancelled: boolean }> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: promptMessage || "Xác thực để tiếp tục",
      fallbackLabel: "Nhập mật khẩu",
      cancelLabel: "Huỷ",
      disableDeviceFallback: false,
    });

    return {
      success: result.success,
      cancelled: !result.success && result.error === "user_cancel",
    };
  } catch (err) {
    console.error("Lỗi xác thực sinh trắc học:", err);
    return { success: false, cancelled: false };
  }
}

/**
 * Yêu cầu mở khoá sinh trắc học nếu đã bật
 * Trả về { success: boolean, cancelled: boolean }
 */
export async function requestBiometricUnlock(
  promptMessage?: string
): Promise<{ success: boolean; cancelled: boolean }> {
  const enabled = await isBiometricEnabled();

  if (!enabled) {
    // Yêu cầu sinh trắc học: nếu chưa bật thì thất bại
    return { success: false, cancelled: false };
  }

  const supported = await isBiometricSupported();

  if (!supported) {
    console.warn("Thiết bị không hỗ trợ sinh trắc học");
    return { success: false, cancelled: false }; // Thất bại nếu không hỗ trợ
  }

  return await authenticateWithBiometric(promptMessage);
}
