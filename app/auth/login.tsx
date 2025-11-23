import { useTheme } from "@/app/providers/ThemeProvider";
import { useUser } from "@/context/userContext";
import {
  createUserWithPassword,
  loginOrCreateUserWithGoogle,
  loginWithPassword,
} from "@/repos/authRepo";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import Constants from "expo-constants";
import { router, useGlobalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
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
  const params = useGlobalSearchParams();
  const upgradeParam = params?.upgrade === "1";
  const onboardingParam = params?.onboarding === "1";

  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const passwordRef = useRef<TextInput | null>(null);
  const confirmRef = useRef<TextInput | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // client ids from app config or env
  const androidClientId =
    (Constants as any)?.expoConfig?.extra
      ?.EXPO_PUBLIC_ANDROID_GOOGLE_CLIENT_ID ||
    process.env.EXPO_PUBLIC_ANDROID_GOOGLE_CLIENT_ID;
  const iosClientId =
    (Constants as any)?.expoConfig?.extra?.IOS_GOOGLE_CLIENT_ID ||
    process.env.IOS_GOOGLE_CLIENT_ID;
  const webClientId =
    "413389631553-2vlf4boj5gtm0tgq9a62njcohasp581b.apps.googleusercontent.com";

  // Cấu hình GoogleSignin, không check Expo / NativeModules nữa
  useEffect(() => {
    GoogleSignin.configure({
      webClientId: webClientId || undefined,
      iosClientId: iosClientId || undefined,
      offlineAccess: false,
      scopes: ["profile", "email"],
    });
  }, [webClientId, iosClientId]);

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    try {
      if (
        Platform.OS === "android" &&
        typeof GoogleSignin.hasPlayServices === "function"
      ) {
        await GoogleSignin.hasPlayServices({
          showPlayServicesUpdateDialog: true,
        });
      }

      try {
        await GoogleSignin.signOut();
      } catch (e) {
        // ignore if not signed in
      }

      const userInfo = await GoogleSignin.signIn({ prompt: "select_account" });
      console.log(userInfo);
      const profile = userInfo.data.user;
      const idToken = userInfo.data.idToken;
      const photo =
        userInfo.data.photo || (profile && (profile.photo || profile.picture));

      const acct = await loginOrCreateUserWithGoogle({
        googleId: String(profile.id),
        email: profile.email,
        name: profile.name,
        image: photo,
        idToken,
      } as any);

      await loginSet({
        id: acct.id,
        username: acct.username,
        name: acct.name ?? null,
        image: acct.image ?? null,
      });

      // Check if user has completed onboarding by checking categories count
      try {
        const { db, openDb } = await import("@/db");
        await openDb();
        const catRow = await db.getFirstAsync<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM categories WHERE user_id=?`,
          acct.id as any
        );
        const catCount = catRow?.cnt ?? 0;
        if (catCount >= 3) {
          router.replace("/(tabs)");
          return;
        }
      } catch (e) {
        console.warn("Failed to check categories:", e);
      }

      // Create default account if not exists
      try {
        const { db, openDb } = await import("@/db");
        await openDb();
        const accRow = await db.getFirstAsync<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM accounts WHERE user_id=?`,
          acct.id as any
        );
        const accCount = accRow?.cnt ?? 0;
        if (accCount === 0) {
          const id = `acc_default_${acct.id}`;
          await db.runAsync(
            `INSERT INTO accounts(id,user_id,name,icon,color,include_in_total,balance_cached,created_at,updated_at)
             VALUES(?,?,?,?,?,?,?,?,?)`,
            [
              id,
              acct.id,
              "Ví mặc định",
              "wallet",
              "#007AFF",
              1,
              0,
              Math.floor(Date.now() / 1000),
              null,
            ] as any
          );
        }
      } catch (e) {
        console.warn("Failed to create default account:", e);
      }

      try {
        await AsyncStorage.setItem("requires_onboarding", acct.id);
      } catch (e) {
        console.warn("Could not set requires_onboarding flag", e);
      }
      router.replace("/onboarding/categories-setup");
    } catch (err: any) {
      console.log("GoogleSignin error:", err);
      Alert.alert("Lỗi", "Đăng nhập bằng Google thất bại");
    } finally {
      setGoogleLoading(false);
    }
  }

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert("Lỗi", "Vui lòng nhập đầy đủ thông tin");
      return;
    }
    setLoading(true);
    try {
      const result = await loginWithPassword({ username, password });
      await loginSet({
        id: result.id,
        username: result.username,
        name: (result as any).name ?? null,
        image: (result as any).image ?? null,
      });
      try {
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
        // ignore
      }
      (router as any).replace("(tabs)");
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

      // Check if user has completed onboarding by checking categories count
      try {
        const { db, openDb } = await import("@/db");
        await openDb();
        const catRow = await db.getFirstAsync<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM categories WHERE user_id=?`,
          userId as any
        );
        const catCount = catRow?.cnt ?? 0;
        if (catCount >= 3) {
          router.replace("/(tabs)");
          return;
        }
      } catch (e) {
        console.warn("Failed to check categories:", e);
      }

      // Create default account if not exists
      try {
        const { db, openDb } = await import("@/db");
        await openDb();
        const accRow = await db.getFirstAsync<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM accounts WHERE user_id=?`,
          userId as any
        );
        const accCount = accRow?.cnt ?? 0;
        if (accCount === 0) {
          const id = `acc_default_${userId}`;
          await db.runAsync(
            `INSERT INTO accounts(id,user_id,name,icon,color,include_in_total,balance_cached,created_at,updated_at)
             VALUES(?,?,?,?,?,?,?,?,?)`,
            [
              id,
              userId,
              "Ví mặc định",
              "wallet",
              "#007AFF",
              1,
              0,
              Math.floor(Date.now() / 1000),
              null,
            ] as any
          );
        }
      } catch (e) {
        console.warn("Failed to create default account:", e);
      }

      try {
        await AsyncStorage.setItem("requires_onboarding", userId);
      } catch (e) {
        console.warn("Could not set requires_onboarding flag", e);
      }
      router.replace("/onboarding/categories-setup");
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

  const { colors } = useTheme();

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scrollContent: {
      flexGrow: 1,
      justifyContent: "center",
      padding: 20,
      paddingBottom: 40,
    },
    header: { alignItems: "center", marginBottom: 40 },
    title: {
      fontSize: 32,
      fontWeight: "bold",
      color: colors.text,
      marginTop: 16,
    },
    subtitle: { fontSize: 16, color: colors.subText, marginTop: 8 },
    form: {
      backgroundColor: colors.card,
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
      backgroundColor: colors.background,
      borderRadius: 8,
      padding: 4,
    },
    tab: {
      flex: 1,
      paddingVertical: 12,
      alignItems: "center",
      borderRadius: 6,
    },
    tabActive: { backgroundColor: "#007AFF" },
    tabText: { fontSize: 16, color: colors.subText, fontWeight: "500" },
    tabTextActive: { color: "#fff", fontWeight: "600" },
    inputContainer: {
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderColor: colors.divider,
      borderRadius: 8,
      marginBottom: 16,
      paddingHorizontal: 12,
      backgroundColor: colors.background,
    },
    inputIcon: { marginRight: 8 },
    input: { flex: 1, paddingVertical: 14, fontSize: 16, color: colors.text },
    submitButton: {
      backgroundColor: "#007AFF",
      paddingVertical: 16,
      borderRadius: 8,
      alignItems: "center",
      marginTop: 8,
    },
    submitButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  });

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
              placeholder="Tên đăng nhập"
              placeholderTextColor={colors.subText}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType={isLogin ? "done" : "next"}
              onSubmitEditing={() => {
                if (!isLogin) passwordRef.current?.focus();
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
              placeholder="Mật khẩu"
              placeholderTextColor={colors.subText}
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
                placeholder="Xác nhận mật khẩu"
                placeholderTextColor={colors.subText}
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

          <TouchableOpacity
            style={[
              styles.submitButton,
              { backgroundColor: "#DB4437", marginTop: 12 },
            ]}
            onPress={handleGoogleSignIn}
            disabled={googleLoading}
          >
            {googleLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>Đăng nhập bằng Google</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
