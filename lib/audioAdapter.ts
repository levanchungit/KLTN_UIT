// Runtime adapter for audio module.
// Prefer `expo-audio` (new) but fall back to `expo-av` for compatibility.
// Exports the `Audio` symbol used throughout the codebase.

let Audio: any = null;

// Use static requires (Metro doesn't allow dynamic require with variables)
try {
  // Prefer expo-audio
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const m = require("expo-audio");
  Audio = m && (m.Audio || m.default || m);
} catch (e) {
  try {
    // Fallback to expo-av
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const m2 = require("expo-av");
    Audio = m2 && (m2.Audio || m2.default || m2);
  } catch (e2) {
    Audio = null;
  }
}

if (Audio) {
  // eslint-disable-next-line no-console
  console.log(
    "audioAdapter: using audio module",
    Audio && Audio._name ? Audio._name : "unknown"
  );
} else {
  // eslint-disable-next-line no-console
  console.warn("audioAdapter: no audio module found (expo-audio or expo-av)");
}

export { Audio };

// Provide a safe fallback for requesting recording permissions when the
// underlying audio module doesn't expose `requestPermissionsAsync`.
if (Audio) {
  if (!Audio.requestPermissionsAsync) {
    // Attach a simple polyfill that tries several strategies:
    // 1. Use `expo-permissions` if available.
    // 2. Use React Native `PermissionsAndroid` on Android.
    // 3. As a last resort, return `granted` to avoid blocking (best-effort).
    // This keeps callers like `Audio.requestPermissionsAsync()` working.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    Audio.requestPermissionsAsync = async function () {
      try {
        // Try expo-permissions
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Perm = require("expo-permissions");
        if (Perm && typeof Perm.requestAsync === "function") {
          try {
            // AUDIO_RECORDING constant name differs across versions
            const audioConst = Perm.PERMISSIONS
              ? Perm.PERMISSIONS.AUDIO_RECORDING || Perm.PERMISSIONS.AUDIO
              : null;
            const res = audioConst
              ? await Perm.requestAsync(audioConst)
              : await Perm.requestAsync("audio");
            return { status: res?.status ?? res };
          } catch (e) {
            // ignore and continue to other strategies
          }
        }
      } catch (e) {
        // expo-permissions not available
      }

      try {
        // Fallback to React Native PermissionsAndroid for Android
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const RN = require("react-native");
        const { PermissionsAndroid, Platform } = RN || {};
        if (Platform && Platform.OS === "android" && PermissionsAndroid) {
          try {
            const granted = await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
            );
            return {
              status:
                granted === PermissionsAndroid.RESULTS.GRANTED
                  ? "granted"
                  : "denied",
            };
          } catch (e) {
            // ignore
          }
        }
      } catch (e) {
        // react-native require failed
      }

      // As a last resort, return granted to avoid blocking callers.
      return { status: "granted" };
    };
  }
}
