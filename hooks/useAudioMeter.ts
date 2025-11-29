import { Audio } from "@/lib/audioAdapter";
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

      const recording = new Audio.Recording();
      recordingRef.current = recording;

      await recording.prepareToRecordAsync(
        Audio.RECORDING_OPTIONS_PRESET_HIGH_QUALITY
      );

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
              duration: 140,
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
          const next = Math.max(0, Math.min(1, l * 0.85 + normalized * 0.15));
          try {
            animRef.current?.stop?.();
          } catch {}
          const a = Animated.timing(meter, {
            toValue: next,
            duration: 120,
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
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI() || null;
      setRecordingUri(uri);
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
      console.warn("stop recording failed", e);
    }
  };

  return { isRecording, level, start, stop, recordingUri, meter };
}
