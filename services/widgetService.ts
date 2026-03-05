/**
 * Widget Service — bridge between React Native and the Android widget.
 *
 * Provides `refreshWidget()` to force-update the home-screen widget so that the
 * displayed balance always matches the current database state. Should be called:
 *   - after adding / editing / deleting a transaction
 *   - after a Firestore sync completes
 *   - when the app transitions to "background" (AppState)
 */
import { NativeModules, Platform, AppState, AppStateStatus } from "react-native";

const { WidgetUpdateModule } = NativeModules;

/**
 * Ask the native side to re-read the SQLite balance and push new data to the
 * widget.  No-op on iOS or when the native module is unavailable.
 */
export async function refreshWidget(): Promise<void> {
  if (Platform.OS !== "android") return;
  if (!WidgetUpdateModule) {
    console.warn("[widgetService] WidgetUpdateModule not available");
    return;
  }
  try {
    await WidgetUpdateModule.updateWidget();
  } catch (e) {
    console.warn("[widgetService] refreshWidget failed:", e);
  }
}

/**
 * Fire-and-forget variant — does not return a promise and will never throw.
 * Ideal for use inside event handlers where you don't want to await.
 */
export function refreshWidgetSilent(): void {
  if (Platform.OS !== "android") return;
  if (!WidgetUpdateModule) return;
  try {
    WidgetUpdateModule.updateWidgetSilent();
  } catch {
    // swallow
  }
}

/**
 * Install an AppState listener that refreshes the widget whenever the app goes
 * to the background. Returns an unsubscribe function.
 *
 * Usage (typically in root _layout.tsx):
 * ```ts
 * useEffect(() => {
 *   const unsub = installWidgetAutoRefresh();
 *   return unsub;
 * }, []);
 * ```
 */
export function installWidgetAutoRefresh(): () => void {
  if (Platform.OS !== "android") return () => {};

  let lastState: AppStateStatus = AppState.currentState;

  const listener = (nextState: AppStateStatus) => {
    // App is transitioning to background or inactive — refresh widget
    if (lastState === "active" && (nextState === "background" || nextState === "inactive")) {
      refreshWidgetSilent();
    }
    lastState = nextState;
  };

  const subscription = AppState.addEventListener("change", listener);

  return () => {
    subscription.remove();
  };
}
