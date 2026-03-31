import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import "react-native-reanimated";

import { useColorScheme } from "@/hooks/use-color-scheme";
import { Session } from "@supabase/supabase-js";
import { supabase } from "../supabase";

export const unstable_settings = {
  initialRouteName: "(auth)/welcome",
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const segments = useSegments();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.auth.getSession(),
      AsyncStorage.getItem("onboarding_complete"),
    ]).then(([{ data: { session } }, onboarding]) => {
      setSession(session);
      setOnboardingDone(onboarding === "true");
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (loading || onboardingDone === null) return;

    const inAuthGroup = segments[0] === "(auth)";
    const onOnboarding = inAuthGroup && segments[1] === "onboarding";

    if (!onboardingDone && !onOnboarding) {
      router.replace("/(auth)/onboarding");
      return;
    }

    if (onboardingDone && session && inAuthGroup) {
      router.replace("/(tabs)");
      return;
    }

    if (onboardingDone && !session && !inAuthGroup) {
      router.replace("/(auth)/welcome");
      return;
    }
  }, [session, loading, onboardingDone]);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#0F172A",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator color="#7C3AED" size="large" />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <StatusBar style="light" backgroundColor="#0f172a" translucent={false} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)/welcome" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="diagnose" />
        <Stack.Screen name="results" />
        <Stack.Screen name="care-plan" />
        <Stack.Screen name="insurance-scan" />
        <Stack.Screen name="admin-dashboard" />
        <Stack.Screen name="modal" options={{ presentation: "modal" }} />
      </Stack>
    </ThemeProvider>
  );
}
