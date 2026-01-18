import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { trainModel } from "@/services/trainModel";

type ModelTrainingCtx = {
  isTraining: boolean;
  progress: number; // 0-100
  isReady: boolean;
  isQuickMode: boolean;
  startTraining: () => void;
  cancelTraining: () => void;
  enableQuickMode: () => void;
};

const STORAGE_KEY = "@model-trained";

const ModelTrainingContext = createContext<ModelTrainingCtx>({
  isTraining: false,
  progress: 0,
  isReady: false,
  isQuickMode: false,
  startTraining: () => {},
  cancelTraining: () => {},
  enableQuickMode: () => {},
});

export function ModelTrainingProvider({ children }: { children: React.ReactNode }) {
  const [isTraining, setIsTraining] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [isQuickMode, setIsQuickMode] = useState(false);

  // cancel token
  const cancelRef = React.useRef(false);

  useEffect(() => {
    // load persisted ready flag
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v === "true") setIsReady(true);
    });
  }, []);

  const startTraining = async () => {
    if (isTraining || isReady) return;
    cancelRef.current = false;
    setIsTraining(true);
    setProgress(0);
    try {
      await trainModel((p) => {
        if (cancelRef.current) throw new Error("canceled");
        setProgress(Math.min(100, Math.max(0, Math.round(p))));
      });
      if (!cancelRef.current) {
        setIsReady(true);
        AsyncStorage.setItem(STORAGE_KEY, "true").catch(() => {});
      }
    } catch (e) {
      // cancelled or failed - leave isReady false
      console.warn("Model training failed/cancelled", e);
    } finally {
      setIsTraining(false);
      setProgress((prev) => (cancelRef.current ? 0 : prev));
    }
  };

  const cancelTraining = () => {
    cancelRef.current = true;
    setIsTraining(false);
    setProgress(0);
  };

  const enableQuickMode = () => {
    setIsQuickMode(true);
    setIsTraining(false);
  };

  const value = useMemo(
    () => ({
      isTraining,
      progress,
      isReady,
      isQuickMode,
      startTraining,
      cancelTraining,
      enableQuickMode,
    }),
    [isTraining, progress, isReady, isQuickMode]
  );

  return <ModelTrainingContext.Provider value={value}>{children}</ModelTrainingContext.Provider>;
}

export function useModelTraining() {
  return useContext(ModelTrainingContext);
}

