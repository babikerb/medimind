import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Animated,
    AppState,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

const VIDEO_SOURCE = require("../../assets/videos/welcome.mov");

const TAGLINES = [
  "AI Care Now",
  "Smart Health Help",
  "Fast Medical Answers",
  "Care Made Simple",
  "Health AI Guide",
  "Quick Care Chat",
  "AI Health Buddy",
  "Better Care Fast",
  "Smart Medical Chat",
  "Care In Seconds",
  "Your AI Doctor",
];

export default function WelcomeScreen() {
  const router = useRouter();
  const [taglineIndex, setTaglineIndex] = useState(0);
  const [videoReady, setVideoReady] = useState(false);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const loadingFadeAnim = useRef(new Animated.Value(1)).current;
  const appState = useRef(AppState.currentState);

  const player = useVideoPlayer(VIDEO_SOURCE, (player) => {
    player.loop = true;
    player.muted = true;
    player.playbackRate = 0.8;
    player.play();
  });

  useEffect(() => {
    const subscription = player.addListener("statusChange", ({ status }) => {
      if (status === "readyToPlay" && !videoReady) {
        setVideoReady(true);
        Animated.timing(loadingFadeAnim, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
        }).start();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [player, videoReady, loadingFadeAnim]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === "active"
      ) {
        player.play();
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [player]);

  useEffect(() => {
    const interval = setInterval(() => {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }).start(() => {
        setTaglineIndex((prev) => (prev + 1) % TAGLINES.length);
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }).start();
      });
    }, 2500);

    return () => clearInterval(interval);
  }, [fadeAnim]);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        nativeControls={false}
        contentFit="cover"
        allowsFullscreen={false}
        allowsPictureInPicture={false}
      />

      <View style={[StyleSheet.absoluteFill, styles.videoOverlay]} />

      {!videoReady && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.loadingContainer,
            { opacity: loadingFadeAnim },
          ]}
          pointerEvents="none"
        >
          <ActivityIndicator size="large" color="#7C3AED" />
        </Animated.View>
      )}

      <SafeAreaView style={styles.safeArea}>
        <View style={styles.contentContainer}>
          <View style={styles.header}>
            <Text style={styles.brandName}>MEDIMIND</Text>

            <View style={styles.emergencyBadge}>
              <View style={styles.emergencyIndicator} />
              <Text style={styles.emergencyText}>
                EMERGENCY: DIAL <Text style={styles.emergencyBold}>911</Text>
              </Text>
            </View>

            <View style={styles.taglineWrapper}>
              <Animated.Text
                style={[styles.subheadline, { opacity: fadeAnim }]}
              >
                {TAGLINES[taglineIndex]}
              </Animated.Text>
            </View>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.signUpButton}
              activeOpacity={0.8}
              onPress={() => router.push("/signup")}
            >
              <Text style={styles.signUpButtonText}>Sign Up</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.loginButton}
              activeOpacity={0.7}
              onPress={() => router.push("/login")}
            >
              <Text style={styles.loginButtonText}>Log In</Text>
            </TouchableOpacity>

            <Text style={styles.tosText}>
              By clicking Sign Up, you agree to our{"\n"}
              <Text style={styles.link}>Terms of Service</Text> and{" "}
              <Text style={styles.link}>Privacy Policy</Text>
            </Text>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  loadingContainer: {
    backgroundColor: "#0F172A",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 20,
  },
  videoOverlay: { backgroundColor: "rgba(15, 23, 42, 0.6)" },
  safeArea: { flex: 1 },
  contentContainer: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: "space-between",
  },
  header: { alignItems: "center", marginTop: 20 },
  brandName: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 6,
    marginBottom: 20,
  },
  emergencyBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(30, 41, 59, 0.8)",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 10,
  },
  emergencyIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#FB7185",
    marginRight: 10,
  },
  emergencyText: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1,
  },
  emergencyBold: { color: "#FB7185", fontWeight: "800" },
  footer: { marginBottom: 30 },
  taglineWrapper: {
    height: 60,
    justifyContent: "center",
    alignItems: "center",
  },
  subheadline: {
    color: "#64748B",
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "500",
    textAlign: "center",
  },
  signUpButton: {
    backgroundColor: "#7C3AED",
    height: 58,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  signUpButtonText: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" },
  loginButton: {
    backgroundColor: "#1E293B",
    height: 58,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 24,
  },
  loginButtonText: { color: "#FFFFFF", fontSize: 18, fontWeight: "600" },
  tosText: {
    color: "#64748B",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
  },
  link: { textDecorationLine: "underline", color: "#94A3B8" },
});
