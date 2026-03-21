import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { supabase } from "../../supabase";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const showSubscription = Keyboard.addListener("keyboardWillShow", () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener("keyboardWillHide", () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  async function signInWithEmail() {
    if (!email || !password) {
      Alert.alert("Error", "Please fill in all fields.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      Alert.alert("Login Error", error.message);
    } else {
      router.replace("/(tabs)");
    }
    setLoading(false);
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />

        {/* Top Navigation - Smooth Fade/Slide */}
        <View style={styles.topNav}>
          {!isKeyboardVisible && (
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
              activeOpacity={0.7}
            >
              <Text style={styles.backButtonText}>BACK</Text>
            </TouchableOpacity>
          )}
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.flex}
        >
          <View style={styles.inner}>
            {/* Header Section */}
            <View style={styles.header}>
              <Text style={styles.brandName}>MEDIMIND</Text>
              <Text style={styles.title}>Welcome Back</Text>
              <Text style={styles.subtitle}>Log in to your account</Text>
            </View>

            {/* Form Section */}
            <View style={styles.form}>
              <View
                style={[
                  styles.inputWrapper,
                  focusedInput === "email" && styles.inputWrapperFocused,
                ]}
              >
                <TextInput
                  style={styles.input}
                  placeholder="Email Address"
                  placeholderTextColor="#64748B"
                  onChangeText={setEmail}
                  value={email}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  onFocus={() => setFocusedInput("email")}
                  onBlur={() => setFocusedInput(null)}
                />
              </View>

              <View
                style={[
                  styles.inputWrapper,
                  focusedInput === "password" && styles.inputWrapperFocused,
                ]}
              >
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor="#64748B"
                  onChangeText={setPassword}
                  value={password}
                  secureTextEntry
                  autoCapitalize="none"
                  onFocus={() => setFocusedInput("password")}
                  onBlur={() => setFocusedInput(null)}
                />
              </View>

              <TouchableOpacity style={styles.forgotPassword}>
                <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.loginButton, loading && styles.buttonDisabled]}
                onPress={signInWithEmail}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.loginButtonText}>Log In</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Bottom Link */}
            <View style={styles.footer}>
              <TouchableOpacity onPress={() => router.push("/signup")}>
                <Text style={styles.footerText}>
                  New here? <Text style={styles.link}>Create Account</Text>
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  flex: { flex: 1 },
  topNav: {
    paddingHorizontal: 28,
    paddingTop: Platform.OS === "android" ? 40 : 10,
    height: 60,
    justifyContent: "center",
  },
  inner: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: "center",
  },
  header: { marginBottom: 40 },
  brandName: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 4,
    marginBottom: 12,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 32,
    fontWeight: "800",
    marginBottom: 8,
  },
  subtitle: {
    color: "#94A3B8",
    fontSize: 16,
  },
  form: { width: "100%" },
  inputWrapper: {
    backgroundColor: "#1E293B",
    height: 64,
    borderRadius: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#334155",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  inputWrapperFocused: {
    borderColor: "#7C3AED",
    backgroundColor: "rgba(30, 41, 59, 1)",
  },
  input: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "500",
  },
  forgotPassword: {
    alignSelf: "flex-end",
    marginBottom: 24,
  },
  forgotPasswordText: {
    color: "#94A3B8",
    fontSize: 14,
    fontWeight: "600",
  },
  loginButton: {
    backgroundColor: "#7C3AED",
    height: 58,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  buttonDisabled: { opacity: 0.7 },
  loginButtonText: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" },
  footer: {
    alignItems: "center",
    marginTop: 32,
  },
  backButton: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(30, 41, 59, 0.8)",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: "#334155",
  },
  backButtonText: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },
  footerText: {
    color: "#64748B",
    fontSize: 14,
  },
  link: {
    color: "#7C3AED",
    fontWeight: "700",
  },
});
