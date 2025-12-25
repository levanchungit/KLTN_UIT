// utils/auth.ts - Tiện ích xác thực
import { loadSession } from "@/context/session";

/**
 * Lấy ID người dùng hiện tại. Ném lỗi nếu chưa đăng nhập.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const session = await loadSession();
  return session && session.id ? session.id : null;
}

/**
 * Kiểm tra người dùng đã đăng nhập bằng tài khoản chưa
 */
export async function isUserLoggedIn(): Promise<boolean> {
  const session = await loadSession();
  return session !== null;
}

/**
 * Lấy ID người dùng hoặc ném lỗi nếu chưa đăng nhập
 */
export async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("USER_NOT_LOGGED_IN");
  return userId;
}

/**
 * Khởi tạo phiên người dùng cục bộ nếu chưa có (đã bỏ hỗ trợ)
 */
// Lưu ý: đã bỏ chế độ local_user. Ứng dụng yêu cầu người dùng đã đăng nhập.
export async function ensureLocalUser(): Promise<void> {
  // Không làm gì (giữ tương thích) — khái niệm local user đã bị loại bỏ.
  return;
}
