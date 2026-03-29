import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const { width } = Dimensions.get("window");

const APP_BG = "#0F172A";
const SURFACE = "#1E293B";
const PURPLE = "#7C3AED";
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_SECONDARY = "#94A3B8";
const TEXT_MUTED = "#64748B";

interface Slide {
  icon: keyof typeof MaterialIcons.glyphMap;
  iconColor: string;
  title: string;
  subtitle: string;
}

const SLIDES: Slide[] = [
  {
    icon: "medical-services",
    iconColor: "#EF4444",
    title: "Describe Your Symptoms",
    subtitle:
      "Our AI asks smart follow-up questions and assigns an Emergency Severity Index (ESI) level, just like a triage nurse would.",
  },
  {
    icon: "local-hospital",
    iconColor: "#3B82F6",
    title: "Get Matched to Hospitals",
    subtitle:
      "We rank nearby hospitals by real-time bed availability, wait times, drive time in traffic, insurance match, and department fit.",
  },
  {
    icon: "verified",
    iconColor: "#10B981",
    title: "Real Data, Real Time",
    subtitle:
      "Hospital capacity comes from the U.S. Department of Health & Human Services. No guesswork, just verified numbers.",
  },
  {
    icon: "shield",
    iconColor: PURPLE,
    title: "Your Health, Your Control",
    subtitle:
      "MediMind is a decision-support tool, not a replacement for professional medical advice. In an emergency, always call 911.",
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;

  const handleNext = async () => {
    if (currentIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1, animated: true });
    } else {
      await AsyncStorage.setItem("onboarding_complete", "true");
      router.replace("/(auth)/welcome");
    }
  };

  const handleSkip = async () => {
    await AsyncStorage.setItem("onboarding_complete", "true");
    router.replace("/(auth)/welcome");
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      setCurrentIndex(viewableItems[0].index ?? 0);
    }
  }).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const renderSlide = ({ item }: { item: Slide }) => (
    <View style={[styles.slide, { width }]}>
      <View style={styles.iconContainer}>
        <View style={[styles.iconCircle, { backgroundColor: item.iconColor + "1A" }]}>
          <MaterialIcons name={item.icon} size={64} color={item.iconColor} />
        </View>
      </View>
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.subtitle}>{item.subtitle}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safeArea}>
        {/* Skip button */}
        <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>

        {/* Slides */}
        <FlatList
          ref={flatListRef}
          data={SLIDES}
          renderItem={renderSlide}
          keyExtractor={(_, i) => String(i)}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          bounces={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            { useNativeDriver: false }
          )}
        />

        {/* Bottom area */}
        <View style={styles.bottomArea}>
          {/* Dots */}
          <View style={styles.dotsRow}>
            {SLIDES.map((_, i) => {
              const inputRange = [(i - 1) * width, i * width, (i + 1) * width];
              const dotWidth = scrollX.interpolate({
                inputRange,
                outputRange: [8, 24, 8],
                extrapolate: "clamp",
              });
              const dotOpacity = scrollX.interpolate({
                inputRange,
                outputRange: [0.3, 1, 0.3],
                extrapolate: "clamp",
              });
              return (
                <Animated.View
                  key={i}
                  style={[styles.dot, { width: dotWidth, opacity: dotOpacity }]}
                />
              );
            })}
          </View>

          {/* Next / Get Started button */}
          <TouchableOpacity style={styles.nextButton} activeOpacity={0.8} onPress={handleNext}>
            <Text style={styles.nextText}>
              {currentIndex === SLIDES.length - 1 ? "Get Started" : "Next"}
            </Text>
            <MaterialIcons
              name={currentIndex === SLIDES.length - 1 ? "check" : "arrow-forward"}
              size={20}
              color="#FFF"
            />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: APP_BG },
  safeArea: { flex: 1 },
  skipButton: {
    position: "absolute",
    top: 60,
    right: 24,
    zIndex: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  skipText: {
    color: TEXT_MUTED,
    fontSize: 16,
    fontWeight: "600",
  },
  slide: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  iconContainer: {
    marginBottom: 40,
  },
  iconCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    color: TEXT_PRIMARY,
    fontSize: 28,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 16,
  },
  subtitle: {
    color: TEXT_SECONDARY,
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
  },
  bottomArea: {
    paddingHorizontal: 28,
    paddingBottom: 30,
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  dot: {
    height: 8,
    borderRadius: 4,
    backgroundColor: PURPLE,
    marginHorizontal: 4,
  },
  nextButton: {
    backgroundColor: PURPLE,
    height: 58,
    borderRadius: 18,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    shadowColor: PURPLE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  nextText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },
});
