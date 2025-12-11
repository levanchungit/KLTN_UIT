import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

interface AppTourContextType {
  shouldShowTour: boolean;
  currentStep: number;
  startTour: () => void;
  nextStep: () => void;
  skipTour: () => void;
  resetTour: () => void;
  isTourEnabled: boolean;
  setIsTourEnabled: (enabled: boolean) => void;
}

const AppTourContext = createContext<AppTourContextType | undefined>(undefined);

const TOUR_KEY = "@app_tour_completed";
const TOUR_ENABLED_KEY = "@app_tour_enabled";

export function AppTourProvider({ children }: { children: React.ReactNode }) {
  const [shouldShowTour, setShouldShowTour] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [isTourEnabled, setIsTourEnabled] = useState(true);

  useEffect(() => {
    checkTourStatus();
  }, []);

  const checkTourStatus = async () => {
    try {
      const [tourCompleted, tourEnabled] = await Promise.all([
        AsyncStorage.getItem(TOUR_KEY),
        AsyncStorage.getItem(TOUR_ENABLED_KEY),
      ]);

      if (tourEnabled !== null) {
        setIsTourEnabled(tourEnabled === "true");
      }

      // Show tour if never completed and tour is enabled
      if (!tourCompleted && (tourEnabled === null || tourEnabled === "true")) {
        setShouldShowTour(true);
      }
    } catch (error) {
      console.error("Error checking tour status:", error);
    }
  };

  const startTour = useCallback(() => {
    setShouldShowTour(true);
    setCurrentStep(0);
  }, []);

  const nextStep = useCallback(() => {
    setCurrentStep((prev) => prev + 1);
  }, []);

  const skipTour = useCallback(async () => {
    try {
      await AsyncStorage.setItem(TOUR_KEY, "true");
      setShouldShowTour(false);
      setCurrentStep(0);
    } catch (error) {
      console.error("Error saving tour status:", error);
    }
  }, []);

  const resetTour = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(TOUR_KEY);
      setShouldShowTour(true);
      setCurrentStep(0);
    } catch (error) {
      console.error("Error resetting tour:", error);
    }
  }, []);

  const setTourEnabled = useCallback(async (enabled: boolean) => {
    try {
      await AsyncStorage.setItem(TOUR_ENABLED_KEY, enabled.toString());
      setIsTourEnabled(enabled);
      if (enabled) {
        // If re-enabling, check if tour was completed
        const completed = await AsyncStorage.getItem(TOUR_KEY);
        if (!completed) {
          setShouldShowTour(true);
        }
      } else {
        setShouldShowTour(false);
      }
    } catch (error) {
      console.error("Error setting tour enabled:", error);
    }
  }, []);

  return (
    <AppTourContext.Provider
      value={{
        shouldShowTour,
        currentStep,
        startTour,
        nextStep,
        skipTour,
        resetTour,
        isTourEnabled,
        setIsTourEnabled: setTourEnabled,
      }}
    >
      {children}
    </AppTourContext.Provider>
  );
}

export function useAppTour() {
  const context = useContext(AppTourContext);
  if (!context) {
    throw new Error("useAppTour must be used within AppTourProvider");
  }
  return context;
}
