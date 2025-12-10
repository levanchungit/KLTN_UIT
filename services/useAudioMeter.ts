import { Audio } from "@/services/audioAdapter";
import { useEffect, useRef, useState } from "react";
import { Animated } from "react-native";

type UseAudioMeter = {
  isRecording: boolean;
  level: number; // 0..1
  start: () => Promise<void>;
  stop: () => Promise<void>;
  recordingUri?: string | null;
  meter?: Animated.Value;
};

export default function useAudioMeter(): UseAudioMeter {
  const [isRecording, setIsRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const recordingRef = useRef<any>(null);
  const meter = useRef(new Animated.Value(0)).current;
  const animRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      // cleanup
      stop().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      // Ensure Recording class is available. Some runtimes / adapters may not
      // expose `Audio.Recording` directly — try to resolve a Recording class
      // from common locations and fail gracefully with a helpful message.
      let RecordingClass: any = Audio && Audio.Recording;
      if (!RecordingClass) {
        try {
          // Try expo-av directly as a fallback
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const av = require("expo-av");
          RecordingClass =
            (av && (av.Audio?.Recording || av.Recording)) || null;
        } catch (e) {
          RecordingClass = null;
        }
      }

      if (!RecordingClass || typeof RecordingClass !== "function") {
        console.warn("Recording class not available on this platform", {
          hasAudio: !!Audio,
          recordingPresent: !!(Audio && (Audio as any).Recording),
        });
        throw new Error(
          "Recording not supported: Recording class is unavailable on this device."
        );
      }

      const recording = new RecordingClass();
      recordingRef.current = recording;

      const recordingOptions =
        (Audio && (Audio as any).RECORDING_OPTIONS_PRESET_HIGH_QUALITY) ||
        undefined;

      await recording.prepareToRecordAsync(recordingOptions);

      // set a status update to read metering when available
      recording.setOnRecordingStatusUpdate((status: any) => {
        // status may contain metering info on some platforms (iOS)
        // try multiple possible fields; fallback to a small animated value
        let db: number | null = null;
        if (status && typeof status === "object") {
          if (status.metering && typeof status.metering === "object") {
            db =
              status.metering.averagePower ?? status.metering.peakPower ?? null;
          } else if (typeof status.metering === "number") {
            db = status.metering;
          } else if (typeof status.lastPeakPower === "number") {
            db = status.lastPeakPower;
          } else if (typeof status.averagePower === "number") {
            db = status.averagePower;
          }
        }

        if (db == null) {
          // fallback: more reactive pseudo value (spikes + smoothing)
          const t = (status?.durationMillis || 0) / 1000;
          const spike = Math.random() * 0.4; // smaller occasional spikes
          const base = 0.04 + 0.08 * Math.abs(Math.sin(t * 2.0));
          const pseudo = Math.min(1, base + spike);

          // stronger smoothing for a steady meter
          setLevel((l) => {
            const next = l * 0.85 + pseudo * 0.15;
            // animate meter towards next for smooth visuals
            try {
              animRef.current?.stop?.();
            } catch {}
            const a = Animated.timing(meter, {
              toValue: next,
              duration: 200,
              useNativeDriver: false,
            });
            animRef.current = a;
            a.start(() => {
              if (animRef.current === a) animRef.current = null;
            });
            return next;
          });
          return;
        }

        // db usually negative (e.g., -160..0). Normalize to 0..1
        const normalized = Math.max(0, Math.min(1, (db + 160) / 160));
        setLevel((l) => {
          const next = Math.max(0, Math.min(1, l * 0.9 + normalized * 0.1));
          try {
            animRef.current?.stop?.();
          } catch {}
          const a = Animated.timing(meter, {
            toValue: next,
            duration: 180,
            useNativeDriver: false,
          });
          animRef.current = a;
          a.start(() => {
            if (animRef.current === a) animRef.current = null;
          });
          return next;
        });
      });

      await recording.startAsync();
      setIsRecording(true);
      setRecordingUri(null);
    } catch (e) {
      console.warn("start recording failed", e);
      setIsRecording(false);
    }
  };

  const stop = async () => {
    try {
      const rec = recordingRef.current;
      if (!rec) return;

      try {
        await rec.stopAndUnloadAsync();
      } catch (err: any) {
        // Some devices / runtimes throw when the native recorder is already
        // gone (e.g. "Recorder does not exist."). Treat that as a non-fatal
        // condition: log at debug level and continue cleanup.
        const msg = err && err.message ? String(err.message) : String(err);
        if (
          /recorder does not exist/i.test(msg) ||
          /recorder.*not.*exist/i.test(msg) ||
          /recorder.*gone/i.test(msg)
        ) {
          console.log("stopAndUnloadAsync: recorder missing (ignored)", msg);
        } else {
          console.warn("stop recording failed", err);
        }
      }

      try {
        const uri = recordingRef.current?.getURI?.() || null;
        setRecordingUri(uri);
      } catch {}

      // Ensure we always clear internal refs/state even if stop failed
      recordingRef.current = null;
      setIsRecording(false);
      setLevel(0);
      try {
        animRef.current?.stop?.();
      } catch {}
      Animated.timing(meter, {
        toValue: 0,
        duration: 160,
        useNativeDriver: false,
      }).start(() => {
        try {
          meter.setValue(0);
        } catch {}
      });
    } catch (e) {
      console.warn("stop recording failed (cleanup)", e);
    }
  };

  return { isRecording, level, start, stop, recordingUri, meter };
}
