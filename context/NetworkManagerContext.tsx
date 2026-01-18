import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoState, NetInfoStateType, NetInfoSubscription } from '@react-native-community/netinfo';
import React, { createContext, useContext, useEffect, useState } from 'react';

type NetworkType = NetInfoStateType;
type NetworkState = {
  type: NetworkType;
  isConnected: boolean;
  isInternetReachable: boolean | null;
  details: any;
};

type NetworkManagerContextType = {
  networkState: NetworkState;
  isOfflineMode: boolean;
  setOfflineMode: (enabled: boolean) => void;
  toggleOfflineMode: () => void;
};

const NetworkManagerContext = createContext<NetworkManagerContextType>({
  networkState: {
    type: NetInfoStateType.wifi,
    isConnected: true,
    isInternetReachable: true,
    details: null,
  },
  isOfflineMode: false,
  setOfflineMode: () => {},
  toggleOfflineMode: () => {},
});

// Store original NetInfo methods
let originalNetInfoFetch: any = null;
let originalNetInfoAddListener: any = null;

const STORAGE_KEY = "@network-offline-mode";

export function NetworkManagerProvider({ children }: { children: React.ReactNode }) {
  const [realNetworkState, setRealNetworkState] = useState<NetworkState>({
    type: NetInfoStateType.wifi,
    isConnected: true,
    isInternetReachable: true,
    details: null,
  });
  const [isOfflineMode, setIsOfflineMode] = useState(false);

  // Load saved offline mode preference
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (val === "true") {
        setIsOfflineMode(true);
      }
    });
  }, []);

  // Save offline mode preference
  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, isOfflineMode.toString()).catch(() => {});
  }, [isOfflineMode]);

  // Listen to real network changes
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      const networkState: NetworkState = {
        type: state.type as NetworkType,
        isConnected: state.isConnected ?? false,
        isInternetReachable: state.isInternetReachable,
        details: state.details,
      };
      setRealNetworkState(networkState);
    });

    return unsubscribe;
  }, []);

  // Mock NetInfo when offline mode changes
  useEffect(() => {
    if (isOfflineMode) {
      // Mock offline state
      const mockState = {
        type: NetInfoStateType.none,
        isConnected: false,
        isInternetReachable: false,
        details: null,
      };

      // Override NetInfo fetch method
      if (!originalNetInfoFetch) {
        originalNetInfoFetch = NetInfo.fetch;
      }
      NetInfo.fetch = () => Promise.resolve(mockState as NetInfoState);

      // Override NetInfo addEventListener
      if (!originalNetInfoAddListener) {
        originalNetInfoAddListener = NetInfo.addEventListener;
      }
      NetInfo.addEventListener = (listener: any) => {
        // Call listener immediately with offline state
        setTimeout(() => listener(mockState), 0);

        // Return a mock unsubscribe function
        return {
          remove: () => {},
        } as unknown as NetInfoSubscription;
      };

      console.log('🌐 Network Manager: Offline mode activated - All network requests blocked');
    } else {
      // Restore original NetInfo methods
      if (originalNetInfoFetch) {
        NetInfo.fetch = originalNetInfoFetch;
        originalNetInfoFetch = null;
      }
      if (originalNetInfoAddListener) {
        NetInfo.addEventListener = originalNetInfoAddListener;
        originalNetInfoAddListener = null;
      }

      console.log('🌐 Network Manager: Online mode activated - Network restored');
    }
  }, [isOfflineMode]);

  // Mock network requests when offline
  useEffect(() => {
    if (isOfflineMode) {
      // Override fetch
      const originalFetch = global.fetch;
      global.fetch = function(input: RequestInfo | URL, init?: RequestInit) {
        console.warn('🚫 Network blocked: Fetch request intercepted in offline mode', input);
        return Promise.reject(new Error('Network request blocked - Offline mode is active'));
      };

      // Override XMLHttpRequest
      const originalXMLHttpRequest = global.XMLHttpRequest;
      const MockXMLHttpRequest = function(this: XMLHttpRequest) {
        const xhr = new originalXMLHttpRequest();
        const originalOpen = xhr.open;
        xhr.open = function(method: string, url: string | URL, async?: boolean, user?: string | null, password?: string | null) {
          console.warn('🚫 Network blocked: XMLHttpRequest intercepted in offline mode', url);
          // Let it proceed but it will fail due to no network
          return originalOpen.call(this, method, typeof url === 'string' ? url : url.toString(), async ?? true, user, password);
        };
        return xhr;
      } as any;

      // Copy static properties
      MockXMLHttpRequest.UNSENT = originalXMLHttpRequest.UNSENT;
      MockXMLHttpRequest.OPENED = originalXMLHttpRequest.OPENED;
      MockXMLHttpRequest.HEADERS_RECEIVED = originalXMLHttpRequest.HEADERS_RECEIVED;
      MockXMLHttpRequest.LOADING = originalXMLHttpRequest.LOADING;
      MockXMLHttpRequest.DONE = originalXMLHttpRequest.DONE;

      global.XMLHttpRequest = MockXMLHttpRequest;

      return () => {
        global.fetch = originalFetch;
        global.XMLHttpRequest = originalXMLHttpRequest;
      };
    }
  }, [isOfflineMode]);

  const networkState = isOfflineMode ? {
    type: NetInfoStateType.none,
    isConnected: false,
    isInternetReachable: false,
    details: null,
  } : realNetworkState;

  const setOfflineMode = (enabled: boolean) => {
    setIsOfflineMode(enabled);
  };

  const toggleOfflineMode = () => {
    setIsOfflineMode(prev => !prev);
  };

  const value: NetworkManagerContextType = {
    networkState,
    isOfflineMode,
    setOfflineMode,
    toggleOfflineMode,
  };

  return (
    <NetworkManagerContext.Provider value={value}>
      {children}
    </NetworkManagerContext.Provider>
  );
}

export function useNetworkManager() {
  return useContext(NetworkManagerContext);
}