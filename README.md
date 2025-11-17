# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.

## Google Sign-In (Expo)

This project includes a Google Sign-In flow using `expo-auth-session`. To use it you must provide OAuth client IDs from the Google Cloud Console and expose them to the app via environment variables or `app.config.js` `extra`.

Required values (set these as environment variables or in `expo.extra`):

- `EXPO_PUBLIC_ANDROID_GOOGLE_CLIENT_ID` — Android client ID (required when testing on Android / Expo Go)
- `IOS_GOOGLE_CLIENT_ID` — iOS client ID (required for simulator / device builds)
- `WEB_GOOGLE_CLIENT_ID` — Web client ID (for web or some Expo redirect flows)
- `EXPO_GOOGLE_CLIENT_ID` — Optional Expo dev-client client id

How to obtain client IDs:

1. Go to Google Cloud Console → APIs & Services → Credentials.
2. Create an OAuth 2.0 Client ID for the platform(s) you need (Android, iOS, Web).
3. Copy the client ID (a string ending with `.apps.googleusercontent.com`).

Quick local test (Windows `cmd.exe`):

1. From a project terminal set the env vars (replace the values):

```cmd
set EXPO_PUBLIC_ANDROID_GOOGLE_CLIENT_ID=your-android-client-id.apps.googleusercontent.com
set WEB_GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
set IOS_GOOGLE_CLIENT_ID=your-ios-client-id.apps.googleusercontent.com
set EXPO_GOOGLE_CLIENT_ID=your-expo-client-id.apps.googleusercontent.com
npm start
```

2. Restart Expo so `Constants.expoConfig.extra` picks up the variables.
3. Open the app in Expo Go or your dev client and tap "Đăng nhập bằng Google".

Notes and troubleshooting:

- When running in Expo Go, using `useProxy: true` (the default in the app) often makes the flow simpler — but platform client IDs may still be required for Android/iOS behavior.
- For standalone builds or dev clients, make sure redirect URIs in Google Cloud Console match your app's scheme (see `app.config.js` `scheme` value).
- If the Google button shows a configuration alert, verify the env vars are set and restart Metro/Expo.

## Google Sign-In (Native) — `@react-native-google-signin/google-signin`

Phiên bản native sử dụng `@react-native-google-signin/google-signin` cho trải nghiệm Google Sign-In ổn định hơn trên dev-client/standalone. Lưu ý: native module yêu cầu build native (EAS dev-client hoặc native build), không hoạt động trong Expo Go.

Các bước cài đặt tóm tắt:

1. Cài dependency:

```bash
yarn add @react-native-google-signin/google-signin
# hoặc
npm install @react-native-google-signin/google-signin
```

2. Android: thêm `google-services.json` vào `android/app/` và cấu hình Gradle theo hướng dẫn của thư viện.
   - Tạo OAuth Client trong Google Cloud Console với loại **Android**.
   - Client phải được tạo cho `applicationId` (package name) của app và SHA-1 của keystore bạn dùng để build.
   - Lấy SHA-1 (debug keystore) bằng lệnh (Windows `cmd.exe`):

```cmd
keytool -list -v -keystore %USERPROFILE%\.android\debug.keystore -alias androiddebugkey -storepass android -keypass android
```

- Thêm `google-services.json` (từ Firebase / Google Cloud) vào `android/app/`.

3. iOS: thêm `GoogleService-Info.plist` vào Xcode project (nếu dùng Firebase) hoặc cấu hình reversed client ID trong `Info.plist` theo hướng dẫn thư viện.
   - Chạy `pod install` trong thư mục `ios/` sau khi cài package:

```bash
cd ios && pod install && cd ..
```

4. Build dev-client / native app:
   - Với EAS (khuyến nghị):

```bash
eas build --profile development --platform android
eas build --profile development --platform ios
```

- Hoặc dùng prebuild & chạy trực tiếp nếu đang ở bare workflow.

5. Kiểm tra flow:
   - Mở app trên thiết bị cài dev-client/ứng dụng native (không phải Expo Go).
   - Nhấn nút "Đăng nhập bằng Google" — native module sẽ gọi Google Sign-In UI.

Ghi chú quan trọng:

- OAuth client Android yêu cầu SHA-1 khớp với keystore dùng để build dev-client/ứng dụng. Nếu SHA-1 không đúng, Google Sign-In sẽ lỗi.
- Đảm bảo `loginOrCreateUserWithGoogle` (trong `repos/authRepo.ts`) chấp nhận `idToken` và/hoặc `googleId` để backend xác thực/khởi tạo user.
- Nếu bạn vẫn muốn thử nhanh trong Expo Go, giữ flow dự phòng `expo-auth-session` (web/proxy) — nhưng hiện tại file `app/auth/login.tsx` đã chuyển sang native flow và sẽ hiển thị hướng dẫn khi chạy trong Expo Go.

Lệnh tóm tắt (Windows `cmd.exe`) để thử cục bộ với dev-client/EAS:

```cmd
REM cài dependency
yarn add @react-native-google-signin/google-signin

REM iOS pods
cd ios && pod install && cd ..

REM build dev-client (EAS) cho Android
eas build --platform android --profile development

REM hoặc cho iOS
eas build --platform ios --profile development
```

Nếu muốn, tôi có thể thêm hướng dẫn cụ thể cho `app.config.js` và cách lưu client IDs an toàn bằng EAS secrets.
