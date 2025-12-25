let Audio: any = null;

try {
  const m = require("expo-audio");
  Audio = m && (m.Audio || m.default || m);
} catch (e) {
  try {
    const m2 = require("expo-av");
    Audio = m2 && (m2.Audio || m2.default || m2);
  } catch (e2) {
    Audio = null;
  }
}

if (Audio) {
  console.log(
    "audioAdapter: using audio module",
    Audio && Audio._name ? Audio._name : "unknown"
  );
} else {
  console.warn("audioAdapter: no audio module found (expo-audio or expo-av)");
}

export { Audio };

if (Audio) {
  if (!Audio.requestPermissionsAsync) {
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
