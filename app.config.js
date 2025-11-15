export default {
  expo: {
    name: "KLTN_UIT",
    slug: "KLTN_UIT",
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
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      package: "com.levanchung.it.KLTN_UIT",
    },
    web: {
      bundler: "metro",
      output: "static",
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-router",
      "./plugins/withAppComponentFactoryFix",
      "@react-native-voice/voice"
      [
        "expo-image-picker",
        {
          photosPermission:
            "Ứng dụng cần quyền truy cập thư viện ảnh để chọn hóa đơn",
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      EXPO_PUBLIC_OPENAI_API_KEY: process.env.EXPO_PUBLIC_OPENAI_API_KEY,
      EXPO_PUBLIC_OCR_SPACE_API_KEY: process.env.EXPO_PUBLIC_OCR_SPACE_API_KEY,
      eas: {
        projectId: "17ee9dcf-d3f4-41ef-95bb-5202d44fdc8d",
      },
    },
  },
};
