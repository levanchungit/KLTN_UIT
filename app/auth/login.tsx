import { useUser } from "@/context/userContext";
import {
  createUserWithPassword,
  loginOrCreateUserWithGoogle,
  loginWithPassword,
} from "@/repos/authRepo";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Google from "expo-auth-session/providers/google";
import Constants from "expo-constants";
import { router, useGlobalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

export default function LoginScreen() {
  const { loginSet } = useUser();
  WebBrowser.maybeCompleteAuthSession();
  const params = useGlobalSearchParams();
  const upgradeParam = params?.upgrade === "1";
  const onboardingParam = params?.onboarding === "1";
  const [isLogin, setIsLogin] = useState(true); // true = login, false = register
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const passwordRef = useRef<TextInput | null>(null);
  const confirmRef = useRef<TextInput | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  // Read client IDs from config or env. We'll only mount the Google auth
  // component when a platform-appropriate client id is present to avoid
  // expo-auth-session throwing during initialization.
  const androidClientId =
    (Constants?.expoConfig?.extra as any)
      ?.EXPO_PUBLIC_ANDROID_GOOGLE_CLIENT_ID ||
    (Constants as any).manifest?.extra?.EXPO_PUBLIC_ANDROID_GOOGLE_CLIENT_ID ||
    process.env.EXPO_PUBLIC_ANDROID_GOOGLE_CLIENT_ID;
  const iosClientId =
    (Constants?.expoConfig?.extra as any)?.IOS_GOOGLE_CLIENT_ID ||
    (Constants as any).manifest?.extra?.IOS_GOOGLE_CLIENT_ID ||
    process.env.IOS_GOOGLE_CLIENT_ID;
  const expoClientId =
    (Constants?.expoConfig?.extra as any)?.EXPO_GOOGLE_CLIENT_ID ||
    (Constants as any).manifest?.extra?.EXPO_GOOGLE_CLIENT_ID ||
    process.env.EXPO_GOOGLE_CLIENT_ID;
  const webClientId =
    (Constants?.expoConfig?.extra as any)?.WEB_GOOGLE_CLIENT_ID ||
    (Constants as any).manifest?.extra?.WEB_GOOGLE_CLIENT_ID ||
    process.env.WEB_GOOGLE_CLIENT_ID;

  const canUseGoogle =
    Platform.OS === "android"
      ? Boolean(androidClientId)
      : Platform.OS === "ios"
      ? Boolean(iosClientId || expoClientId)
      : Boolean(webClientId || expoClientId);

  function GoogleSignIn() {
    const [request, response, promptAsync] = Google.useAuthRequest({
      androidClientId,
      iosClientId,
      expoClientId,
      webClientId,
    });

    React.useEffect(() => {
      (async () => {
        if (response?.type === "success") {
          const token = response.authentication?.accessToken;
          if (!token) return;
          try {
            const profileRes = await fetch(
              "https://www.googleapis.com/userinfo/v2/me",
              {
                headers: { Authorization: `Bearer ${token}` },
              }
            );
            const profile = await profileRes.json();
            const gId = profile.id;
            if (!gId) throw new Error("No Google id returned");

            const acct = await loginOrCreateUserWithGoogle({
              googleId: String(gId),
              email: profile.email,
              name: profile.name,
            });

            await loginSet({ id: acct.id, username: acct.username });
            try {
              await AsyncStorage.setItem("requires_onboarding", acct.id);
            } catch (e) {
              console.warn("Could not set requires_onboarding flag", e);
            }
            router.replace("/onboarding/wallet-setup");
          } catch (err) {
            console.error("Google sign-in failed:", err);
            Alert.alert("Lỗi", "Đăng nhập bằng Google thất bại");
          }
        }
      })();
    }, [response]);

    return (
      <TouchableOpacity
        style={[
          styles.submitButton,
          { backgroundColor: "#DB4437", marginTop: 12 },
        ]}
        onPress={async () => {
          if (!request) {
            Alert.alert(
              "Cấu hình Google",
              "Google Sign-In chưa được cấu hình đúng. Vui lòng kiểm tra client IDs."
            );
            return;
          }
          try {
            await promptAsync({ useProxy: true, showInRecents: true });
          } catch (e) {
            console.error("promptAsync error:", e);
            Alert.alert("Lỗi", "Không thể mở trình đăng nhập Google");
          }
        }}
      >
        <Text style={styles.submitButtonText}>Đăng nhập bằng Google</Text>
      </TouchableOpacity>
    );
  }

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert("Lỗi", "Vui lòng nhập đầy đủ thông tin");
      return;
    }

    setLoading(true);
    try {
      const result = await loginWithPassword({ username, password });
      await loginSet({ id: result.id, username: result.username });
      try {
        // If onboarding flow requested, send user into onboarding wallet setup
        const onboarding = onboardingParam;
        const upgrade =
          (await AsyncStorage.getItem("upgrade_after_login")) ||
          (upgradeParam ? "1" : null);
        if (onboarding) {
          router.replace("/onboarding/wallet-setup");
          return;
        }
        if (upgrade === "1") {
          await AsyncStorage.removeItem("upgrade_after_login");
          router.replace("/sync");
          return;
        }
      } catch (e) {
        // ignore and continue
      }
      router.replace("/(tabs)");
    } catch (error: any) {
      const msg =
        error.message === "WRONG_CREDENTIALS"
          ? "Sai username hoặc password"
          : error.message === "EMPTY_FIELDS"
          ? "Vui lòng nhập đầy đủ thông tin"
          : "Đăng nhập thất bại";
      Alert.alert("Lỗi đăng nhập", msg);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!username.trim() || !password.trim() || !confirmPassword.trim()) {
      Alert.alert("Lỗi", "Vui lòng nhập đầy đủ thông tin");
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert("Lỗi", "Mật khẩu xác nhận không khớp");
      return;
    }

    if (username.length < 3) {
      Alert.alert("Lỗi", "Username phải có ít nhất 3 ký tự");
      return;
    }

    if (password.length < 4) {
      Alert.alert("Lỗi", "Password phải có ít nhất 4 ký tự");
      return;
    }

    setLoading(true);
    try {
      const userId = await createUserWithPassword({ username, password });
      await loginSet({ id: userId, username });
      // mark this freshly-registered user as requiring onboarding
      try {
        await AsyncStorage.setItem("requires_onboarding", userId);
      } catch (e) {
        console.warn("Could not set requires_onboarding flag", e);
      }
      try {
        const onboarding = onboardingParam;
        const upgrade =
          (await AsyncStorage.getItem("upgrade_after_login")) ||
          (upgradeParam ? "1" : null);
        // Always send newly registered users into onboarding flow
        router.replace("/onboarding/wallet-setup");
        return;
      } catch (e) {
        // ignore
      }
      router.replace("/(tabs)");
    } catch (error: any) {
      const msg =
        error.message === "USERNAME_TAKEN"
          ? "Username đã tồn tại"
          : error.message === "USERNAME_TOO_SHORT"
          ? "Username quá ngắn (tối thiểu 3 ký tự)"
          : error.message === "PASSWORD_TOO_SHORT"
          ? "Password quá ngắn (tối thiểu 4 ký tự)"
          : "Đăng ký thất bại";
      Alert.alert("Lỗi đăng ký", msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <MaterialCommunityIcons
            name="wallet-outline"
            size={80}
            color="#007AFF"
          />
          <Text style={styles.title}>KLTN UIT</Text>
          <Text style={styles.subtitle}>Quản lý tài chính cá nhân</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.tabContainer}>
            <TouchableOpacity
              style={[styles.tab, isLogin && styles.tabActive]}
              onPress={() => setIsLogin(true)}
            >
              <Text style={[styles.tabText, isLogin && styles.tabTextActive]}>
                Đăng nhập
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, !isLogin && styles.tabActive]}
              onPress={() => setIsLogin(false)}
            >
              <Text style={[styles.tabText, !isLogin && styles.tabTextActive]}>
                Đăng ký
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.inputContainer}>
            <MaterialCommunityIcons
              name="account-outline"
              size={24}
              color="#666"
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="Username"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType={isLogin ? "done" : "next"}
              onSubmitEditing={() => {
                if (!isLogin) {
                  passwordRef.current?.focus();
                }
              }}
            />
          </View>

          <View style={styles.inputContainer}>
            <MaterialCommunityIcons
              name="lock-outline"
              size={24}
              color="#666"
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              ref={passwordRef}
              returnKeyType={isLogin ? "done" : "next"}
              onSubmitEditing={() => {
                if (isLogin) handleLogin();
                else confirmRef.current?.focus();
              }}
            />
            <TouchableOpacity
              onPress={() => setShowPassword((s) => !s)}
              style={{ padding: 8 }}
            >
              <MaterialCommunityIcons
                name={showPassword ? "eye-off" : "eye"}
                size={20}
                color="#666"
              />
            </TouchableOpacity>
          </View>

          {!isLogin && (
            <View style={styles.inputContainer}>
              <MaterialCommunityIcons
                name="lock-check-outline"
                size={24}
                color="#666"
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                placeholder="Xác nhận password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showConfirm}
                autoCapitalize="none"
                ref={confirmRef}
                returnKeyType="done"
                onSubmitEditing={handleRegister}
              />
              <TouchableOpacity
                onPress={() => setShowConfirm((s) => !s)}
                style={{ padding: 8 }}
              >
                <MaterialCommunityIcons
                  name={showConfirm ? "eye-off" : "eye"}
                  size={20}
                  color="#666"
                />
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity
            style={styles.submitButton}
            onPress={isLogin ? handleLogin : handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>
                {isLogin ? "Đăng nhập" : "Đăng ký"}
              </Text>
            )}
          </TouchableOpacity>

          {/* Google Sign-In: only mount the hook when a platform-appropriate client id exists */}
          {canUseGoogle ? (
            <GoogleSignIn />
          ) : (
            <TouchableOpacity
              style={[
                styles.submitButton,
                { backgroundColor: "#DB4437", marginTop: 12 },
              ]}
              onPress={() => {
                Alert.alert(
                  "Cấu hình Google",
                  "Google Sign-In chưa được cấu hình cho nền tảng này. Vui lòng đặt client IDs trong biến môi trường hoặc `app.config.js` extra."
                );
              }}
            >
              <Text style={styles.submitButtonText}>Đăng nhập bằng Google</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    alignItems: "center",
    marginBottom: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#333",
    marginTop: 16,
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginTop: 8,
  },
  form: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  tabContainer: {
    flexDirection: "row",
    marginBottom: 24,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 6,
  },
  tabActive: {
    backgroundColor: "#007AFF",
  },
  tabText: {
    fontSize: 16,
    color: "#666",
    fontWeight: "500",
  },
  tabTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    marginBottom: 16,
    paddingHorizontal: 12,
    backgroundColor: "#fafafa",
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 16,
    color: "#333",
  },
  submitButton: {
    backgroundColor: "#007AFF",
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  submitButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  skipButton: {
    marginTop: 16,
    alignItems: "center",
  },
  skipButtonText: {
    color: "#007AFF",
    fontSize: 14,
  },
});
