import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";
import { writeAsStringAsync } from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";

export type UserSession = {
  id: string;
  username: string;
  name?: string | null;
  image?: string | null;
};

const KEY = "user_session";

// Kiểm tra SecureStore có khả dụng hay không (không áp dụng trong Expo Go)
const isSecureStoreAvailable = async (): Promise<boolean> => {
  try {
    // Thử truy cập SecureStore
    await SecureStore.getItemAsync("test");
    return true;
  } catch (error) {
    console.log(
      "SecureStore không khả dụng, dùng AsyncStorage như phương án dự phòng:",
      error
    );
    return false;
  }
};

export async function saveSession(user: UserSession) {
  console.log("Saving session for user:", user.username);
  try {
    const secureAvailable = await isSecureStoreAvailable();
    if (secureAvailable) {
      await SecureStore.setItemAsync(KEY, JSON.stringify(user));
      console.log("Session saved to SecureStore");
    } else {
      await AsyncStorage.setItem(KEY, JSON.stringify(user));
      console.log("Session saved to AsyncStorage (fallback)");
    }
    // Đồng thời ghi một tệp nhỏ để widget native đọc user id
    try {
      const path =
        (FileSystem.documentDirectory || "") + "kltn_widget_user.json";
      await writeAsStringAsync(
        path,
        JSON.stringify({ id: user.id, username: user.username })
      );
      console.log("Đã ghi tệp người dùng cho widget:", path);
    } catch (e) {
      console.log("Ghi tệp người dùng cho widget thất bại", e);
    }
  } catch (error) {
    console.log("Lỗi khi lưu phiên:", error);
    // Thử AsyncStorage như phương án cuối cùng
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(user));
      console.log("Phiên đã lưu vào AsyncStorage (dự phòng sau lỗi)");
      // Ghi tệp (cố gắng tốt nhất)
      try {
        const path =
          (FileSystem.documentDirectory || "") + "kltn_widget_user.json";
        await writeAsStringAsync(
          path,
          JSON.stringify({ id: user.id, username: user.username })
        );
        console.log("Đã ghi tệp người dùng cho widget (dự phòng):", path);
      } catch (e) {
        console.log("Ghi tệp người dùng cho widget thất bại (dự phòng)", e);
      }
    } catch (fallbackError) {
      console.log("Không thể lưu phiên vào bất kỳ bộ nhớ nào:", fallbackError);
    }
  }
}

export async function loadSession(): Promise<UserSession | null> {
  try {
    const secureAvailable = await isSecureStoreAvailable();
    let raw: string | null = null;

    if (secureAvailable) {
      raw = await SecureStore.getItemAsync(KEY);
    } else {
      raw = await AsyncStorage.getItem(KEY);
      console.log("Đã tải từ AsyncStorage (dự phòng):", raw);
    }

    if (!raw) {
      console.log("Không tìm thấy dữ liệu phiên");
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      return parsed;
    } catch (error) {
      console.log("Lỗi khi phân tích dữ liệu phiên:", error);
      return null;
    }
  } catch (error) {
    console.log("Lỗi khi tải phiên, thử dùng AsyncStorage (dự phòng):", error);
    // Thử AsyncStorage như phương án cuối cùng
    try {
      const raw = await AsyncStorage.getItem(KEY);
      console.log("Đã tải từ AsyncStorage (dự phòng sau lỗi):", raw);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed;
    } catch (fallbackError) {
      console.log("Không thể tải phiên từ bất kỳ bộ nhớ nào:", fallbackError);
      return null;
    }
  }
}

export async function clearSession() {
  console.log("Đang xoá phiên");
  try {
    const secureAvailable = await isSecureStoreAvailable();
    if (secureAvailable) {
      await SecureStore.deleteItemAsync(KEY);
      console.log("Đã xoá phiên khỏi SecureStore");
    } else {
      await AsyncStorage.removeItem(KEY);
      console.log("Đã xoá phiên khỏi AsyncStorage (dự phòng)");
    }
  } catch (error) {
    console.log(
      "Lỗi khi xoá phiên khỏi bộ nhớ chính, thử phương án dự phòng:",
      error
    );
    // Thử AsyncStorage như phương án dự phòng
    try {
      await AsyncStorage.removeItem(KEY);
      console.log("Đã xoá phiên khỏi AsyncStorage (dự phòng sau lỗi)");
    } catch (fallbackError) {
      console.log("Không thể xoá phiên khỏi bất kỳ bộ nhớ nào:", fallbackError);
    }
  }
}
