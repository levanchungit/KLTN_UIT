// utils/biometric.ts - Biometric authentication utility
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";

const BIOMETRIC_ENABLED_KEY = "@biometric_enabled";

/**
 * Check if device supports biometric authentication
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
 * Get available biometric types (fingerprint, face, iris)
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
 * Check if biometric lock is enabled by user
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
 * Enable or disable biometric lock
 */
export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, enabled.toString());
  } catch (err) {
    console.error("Failed to save biometric preference:", err);
  }
}

/**
 * Authenticate user with biometrics
 * Returns true if successful, false otherwise
 */
export async function authenticateWithBiometric(
  promptMessage?: string
): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: promptMessage || "Xác thực để tiếp tục",
      fallbackLabel: "Nhập mật khẩu",
      cancelLabel: "Huỷ",
      disableDeviceFallback: false,
    });

    return result.success;
  } catch (err) {
    console.error("Biometric authentication error:", err);
    return false;
  }
}

/**
 * Request biometric unlock if enabled
 * Returns true if unlocked (or not required), false if failed/cancelled
 */
export async function requestBiometricUnlock(
  promptMessage?: string
): Promise<boolean> {
  const enabled = await isBiometricEnabled();

  if (!enabled) {
    return true; // Not required
  }

  const supported = await isBiometricSupported();

  if (!supported) {
    console.warn("Biometric not supported but enabled in settings");
    return true; // Allow access if hardware not available
  }

  return await authenticateWithBiometric(promptMessage);
}
