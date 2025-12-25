const timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
// Bộ đếm đơn giản để quan sát/tối ưu hoá
const stats = {
  coalescedCalls: 0,
  scheduledCalls: 0,
  immediateCalls: 0,
};
const DEFAULT_DELAY_MS = 4000; // Trì hoãn 4 giây
const lastSyncTs: Map<string, number> = new Map();
const retryCounts: Map<string, number> = new Map();
const MIN_INTERVAL_MS = 15_000; // Không đồng bộ thường hơn 15 giây cho mỗi người dùng

/**
 * Lên lịch đồng bộ có trì hoãn cho một người dùng (hoặc người dùng hiện tại nếu không truyền).
 * Nhiều lời gọi trong cùng cửa sổ trì hoãn sẽ gộp thành một lần đồng bộ.
 */
export function scheduleSyncDebounced(
  userId?: string,
  delayMs = DEFAULT_DELAY_MS
) {
  const key = userId ?? "__global";
  const existing = timers.get(key);
  if (existing) {
    // Đã có timer chờ -> lời gọi này sẽ được gộp
    stats.coalescedCalls++;
    clearTimeout(existing);
  }

  const t = setTimeout(async () => {
    stats.scheduledCalls++;
    timers.delete(key);
    try {
      // Giới hạn tốc độ: nếu lần đồng bộ gần đây, lên lịch trì hoãn ngắn thay vì chạy ngay
      const last = lastSyncTs.get(key) ?? 0;
      const elapsed = Date.now() - last;
      if (elapsed < MIN_INTERVAL_MS) {
        // Lên lịch chạy sau thời gian còn lại
        const remaining = MIN_INTERVAL_MS - elapsed + 1000;
        scheduleSyncDebounced(userId, Math.max(1000, remaining));
        return;
      }

      // Cố gắng phát hiện trạng thái offline (best-effort). Nếu có NetInfo thì dùng.
      // Lập trình phòng thủ: xử lý default export, thiếu module native, và lỗi gọi hàm.
      let online = true;
      try {
        const netMod = await import("@react-native-community/netinfo");
        const NetInfo = (netMod && (netMod.default || netMod)) as any;
        const fetchFn = NetInfo && (NetInfo.fetch || NetInfo.getCurrentState);
        if (typeof fetchFn === "function") {
          try {
            // Gọi API sẵn có và phòng tránh lỗi native
            const state = await fetchFn.call(NetInfo);
            online = !!(state && state.isConnected);
          } catch (callErr) {
            console.warn(
              "NetInfo available but fetch/getCurrentState failed:",
              callErr
            );
            // Nếu NetInfo lỗi (thiếu module native), giả định online để tránh crash
            online = true;
          }
        }
      } catch (e) {
        // NetInfo chưa cài hoặc import thất bại; giả định online
      }
      if (!online) {
        // Lên lịch thử lại với backoff lũy tiến
        const rc = (retryCounts.get(key) ?? 0) + 1;
        retryCounts.set(key, rc);
        const backoff = Math.min(60_000, 1000 * Math.pow(2, rc));
        scheduleSyncDebounced(userId, backoff);
        return;
      }

      // Kiểm tra đăng nhập Firebase trước khi đồng bộ để tránh bỏ qua liên tục.
      try {
        const fsync = await import("@/services/firestoreSync");
        if (fsync && typeof fsync.isFirebaseSignedIn === "function") {
          try {
            const signedIn = await fsync.isFirebaseSignedIn();
            if (!signedIn) {
              console.warn(
                "Skipping Firestore sync: no authenticated Firebase user"
              );
              // Lên lịch thử lại sau với backoff
              const rc = (retryCounts.get(key) ?? 0) + 1;
              retryCounts.set(key, rc);
              const backoff = Math.min(60_000, 1000 * Math.pow(2, rc));
              scheduleSyncDebounced(userId, backoff);
              return;
            }
          } catch (e) {
            // Nếu kiểm tra thất bại, vẫn tiếp tục thử đồng bộ
            console.warn(
              "isFirebaseSignedIn check failed, proceeding to attempt sync:",
              e
            );
          }
        }
      } catch (e) {
        // Bỏ qua lỗi import và tiếp tục
      }

      const svc = await import("@/services/syncService");
      try {
        const did = await svc.syncAll(userId);
        if (did) {
          lastSyncTs.set(key, Date.now());
        }
      } catch (e) {
        throw e;
      }
      retryCounts.delete(key);
    } catch (e) {
      console.warn("Debounced sync failed:", e);
      // Nếu thất bại hãy lên lịch thử lại với backoff theo cấp số nhân
      const rc = (retryCounts.get(key) ?? 0) + 1;
      retryCounts.set(key, rc);
      const backoff = Math.min(60_000, 1000 * Math.pow(2, rc));
      scheduleSyncDebounced(userId, backoff);
    }
  }, delayMs) as ReturnType<typeof setTimeout>;

  timers.set(key, t);
}

/** Kích hoạt đồng bộ ngay lập tức (huỷ mọi đồng bộ đang trì hoãn). */
export async function triggerImmediate(userId?: string) {
  const key = userId ?? "__global";
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.delete(key);
  stats.immediateCalls++;
  try {
    // Kiểm tra đăng nhập Firebase trước khi đồng bộ
    try {
      const fsync = await import("@/services/firestoreSync");
      if (fsync && typeof fsync.isFirebaseSignedIn === "function") {
        const signedIn = await fsync.isFirebaseSignedIn();
        if (!signedIn) {
          console.warn(
            "Skipping Firestore sync (immediate): no authenticated Firebase user"
          );
          const rc = (retryCounts.get(key) ?? 0) + 1;
          retryCounts.set(key, rc);
          const backoff = Math.min(60_000, 1000 * Math.pow(2, rc));
          scheduleSyncDebounced(userId, backoff);
          return;
        }
      }
    } catch (e) {
      // Bỏ qua và tiếp tục
    }

    const svc = await import("@/services/syncService");
    const did = await svc.syncAll(userId);
    if (did) lastSyncTs.set(key, Date.now());
    retryCounts.delete(key);
  } catch (e) {
    console.warn("Immediate sync failed:", e);
    const rc = (retryCounts.get(key) ?? 0) + 1;
    retryCounts.set(key, rc);
    const backoff = Math.min(60_000, 1000 * Math.pow(2, rc));
    scheduleSyncDebounced(userId, backoff);
  }
}

export function getSyncTriggerStats() {
  return { ...stats };
}

export default { scheduleSyncDebounced, triggerImmediate, getSyncTriggerStats };
