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
