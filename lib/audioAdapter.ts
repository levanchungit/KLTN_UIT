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
