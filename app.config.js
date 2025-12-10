require("dotenv").config();

export default {
  expo: {
    name: "HugoKeeper",
    slug: "HugoKeeper",
    version: "1.0.0",
    owner: "levanchung.it",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "kltnuit",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    splash: {
      image: "./assets/images/icon.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
    },
    ios: {
      supportsTablet: true,
      infoPlist: {
        NSSpeechRecognitionUsageDescription:
          "Ứng dụng cần quyền nhận diện giọng nói để tạo giao dịch nhanh",
        NSMicrophoneUsageDescription:
          "Ứng dụng cần quyền microphone để nhận diện giọng nói",
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/adaptive-icon.png",
        backgroundColor: "#ffffff",
      },
      permissions: [
        "android.permission.RECORD_AUDIO",
        "android.permission.MODIFY_AUDIO_SETTINGS",
      ],
      package: "com.anonymous.SpeectToTextApp",
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      package: "com.levanchung.it.KLTN_UIT",
      googleServicesFile: "./google-services.json",
    },
    web: {
      bundler: "metro",
      output: "static",
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-router",
      [
        "expo-image-picker",
        {
          photosPermission:
            "Ứng dụng cần quyền truy cập thư viện ảnh để chọn hóa đơn",
        },
      ],
      [
        "expo-notifications",
        {
          icon: "./assets/images/icon_192x192.png",
          color: "#667eea",
          sounds: [],
        },
      ],
      "expo-speech-recognition",
      [
        "expo-speech-recognition",
        {
          microphonePermission: "Cho phép $(PRODUCT_NAME) sử dụng micro.",
          speechRecognitionPermission:
            "Cho phép $(PRODUCT_NAME) sử dụng nhận diện giọng nói.",
          androidSpeechServicePackages: [
            "com.google.android.googlequicksearchbox",
          ],
        },
      ],
      [
        "expo-av",
        {
          microphonePermission:
            "Allow $(PRODUCT_NAME) to access your microphone.",
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      EXPO_PUBLIC_HUGGINGFACE_API_KEY:
        process.env.EXPO_PUBLIC_HUGGINGFACE_API_KEY ||
        process.env.HUGGINGFACE_API_KEY,
      EXPO_PUBLIC_HUGGINGFACE_MODEL:
        process.env.EXPO_PUBLIC_HUGGINGFACE_MODEL ||
        process.env.HUGGINGFACE_MODEL,
      EXPO_PUBLIC_OCR_SPACE_API_KEY: process.env.EXPO_PUBLIC_OCR_SPACE_API_KEY,
      EXPO_PUBLIC_ANDROID_GOOGLE_CLIENT_ID:
        process.env.EXPO_PUBLIC_ANDROID_GOOGLE_CLIENT_ID,
      IOS_GOOGLE_CLIENT_ID: process.env.IOS_GOOGLE_CLIENT_ID,
      WEB_GOOGLE_CLIENT_ID: process.env.EXPO_PUBLIC_WEB_GOOGLE_CLIENT_ID,
      EXPO_GOOGLE_CLIENT_ID: process.env.EXPO_PUBLIC_EXPO_GOOGLE_CLIENT_ID,
      eas: {
        projectId: "17ee9dcf-d3f4-41ef-95bb-5202d44fdc8d",
      },
      FIREBASE_CONFIG: {
        apiKey: "AIzaSyAIagCB77cqGVaPriR-MQMB9x9ahmNr5ek",
        authDomain: "kltn-uit-921cf.firebaseapp.com",
        projectId: "kltn-uit-921cf",
        storageBucket: "kltn-uit-921cf.firebasestorage.app",
        messagingSenderId: "702360028374",
        appId: "1:702360028374:web:ef4308fead816d3489f577",
        measurementId: "G-T9E6WMBGCF",
      },
    },
  },
};
