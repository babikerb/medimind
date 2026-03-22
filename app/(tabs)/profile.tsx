import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../../supabase";

type Profile = {
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  zip_code: string;
  insurance_provider: string;
  insurance_plan: string;
  dob: string;
  gender: string;
  language: string;
};

const InfoCard = ({
  label,
  value,
  iconName,
}: {
  label: string;
  value: string;
  iconName: keyof typeof MaterialIcons.glyphMap;
}) => (
  <View style={styles.infoCard}>
    <View style={styles.iconWrapper}>
      <MaterialIcons name={iconName} size={18} color="#7C3AED" />
    </View>
    <View style={styles.infoCardText}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || "—"}</Text>
    </View>
  </View>
);

const SectionHeader = ({ title }: { title: string }) => (
  <Text style={styles.sectionHeader}>{title}</Text>
);

export default function ProfileScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    async function fetchProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/(auth)/welcome");
        return;
      }

      setEmail(user.email ?? "");

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (error) {
        Alert.alert("Error", "Could not load profile.");
      } else {
        setProfile(data);
      }

      setLoading(false);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }).start();
    }

    fetchProfile();
  }, []);

  async function handleLogout() {
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log Out",
        style: "destructive",
        onPress: async () => {
          await supabase.auth.signOut();
          router.replace("/(auth)/welcome");
        },
      },
    ]);
  }

  function formatDob(dob: string) {
    if (!dob) return "—";
    const [year, month, day] = dob.split("-");
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return `${months[parseInt(month, 10) - 1]} ${parseInt(day, 10)}, ${year}`;
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.topNav}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <MaterialIcons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.navTitle}>PROFILE</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={styles.loadingScreen}>
          {/* Avatar skeleton */}
          <View style={styles.skeletonAvatar} />
          <View style={styles.skeletonName} />
          <View style={styles.skeletonEmail} />

          <View style={styles.skeletonSection} />
          <View style={styles.skeletonCard}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={styles.skeletonRow}>
                <View style={styles.skeletonIcon} />
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={styles.skeletonLineShort} />
                  <View style={styles.skeletonLineLong} />
                </View>
              </View>
            ))}
          </View>

          <View style={styles.skeletonSection} />
          <View style={styles.skeletonCard}>
            {[0, 1].map((i) => (
              <View key={i} style={styles.skeletonRow}>
                <View style={styles.skeletonIcon} />
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={styles.skeletonLineShort} />
                  <View style={styles.skeletonLineLong} />
                </View>
              </View>
            ))}
          </View>

          <ActivityIndicator
            size="small"
            color="#7C3AED"
            style={{ marginTop: 24 }}
          />
        </View>
      ) : null}

      <Animated.ScrollView
        style={[{ opacity: fadeAnim }, loading && { position: "absolute", opacity: 0 }]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.heroSection}>
          <View style={styles.avatarContainer}>
            {profile?.avatar_url ? (
              <Image
                source={{ uri: profile.avatar_url }}
                style={styles.avatar}
              />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitials}>
                  {profile?.first_name?.[0] ?? ""}
                  {profile?.last_name?.[0] ?? ""}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.heroName}>
            {profile?.first_name} {profile?.last_name}
          </Text>
          <View style={styles.emailBadge}>
            <MaterialIcons
              name="mail-outline"
              size={13}
              color="#64748B"
              style={{ marginRight: 6 }}
            />
            <Text style={styles.emailText}>{email}</Text>
          </View>
        </View>

        {/* Personal */}
        <SectionHeader title="PERSONAL" />
        <View style={styles.card}>
          <InfoCard
            label="Date of Birth"
            value={formatDob(profile?.dob ?? "")}
            iconName="cake"
          />
          <View style={styles.divider} />
          <InfoCard
            label="Gender"
            value={profile?.gender ?? ""}
            iconName="person-outline"
          />
          <View style={styles.divider} />
          <InfoCard
            label="Language"
            value={profile?.language ?? ""}
            iconName="language"
          />
          <View style={styles.divider} />
          <InfoCard
            label="ZIP Code"
            value={profile?.zip_code ?? ""}
            iconName="location-on"
          />
        </View>

        {/* Insurance */}
        <SectionHeader title="INSURANCE" />
        <View style={styles.card}>
          <InfoCard
            label="Provider"
            value={profile?.insurance_provider ?? ""}
            iconName="local-hospital"
          />
          <View style={styles.divider} />
          <InfoCard
            label="Plan"
            value={profile?.insurance_plan ?? ""}
            iconName="description"
          />
        </View>

        {/* Logout */}
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <MaterialIcons
            name="logout"
            size={18}
            color="#F87171"
            style={{ marginRight: 8 }}
          />
          <Text style={styles.logoutButtonText}>Log Out</Text>
        </TouchableOpacity>
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  topNav: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? 40 : 10,
    height: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 4,
  },
  scrollContent: {
    paddingHorizontal: 28,
    paddingBottom: 48,
  },

  heroSection: {
    alignItems: "center",
    marginTop: 16,
    marginBottom: 36,
  },
  avatarContainer: {
    marginBottom: 16,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: "#7C3AED",
  },
  avatarFallback: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#1E293B",
    borderWidth: 3,
    borderColor: "#7C3AED",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarInitials: {
    color: "#7C3AED",
    fontSize: 32,
    fontWeight: "800",
  },
  heroName: {
    color: "#FFFFFF",
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 8,
    textAlign: "center",
  },
  emailBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E293B",
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: "#334155",
  },
  emailText: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "500",
  },

  sectionHeader: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 3,
    opacity: 0.5,
    marginBottom: 12,
    marginTop: 4,
  },

  card: {
    backgroundColor: "#1E293B",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  divider: {
    height: 1,
    backgroundColor: "#334155",
  },
  infoCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    gap: 14,
  },
  iconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(124, 58, 237, 0.12)",
    justifyContent: "center",
    alignItems: "center",
  },
  infoCardText: {
    flex: 1,
  },
  infoLabel: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 3,
  },
  infoValue: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },

  loadingScreen: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 20,
  },
  skeletonAvatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#1E293B",
    alignSelf: "center",
    marginBottom: 14,
  },
  skeletonName: {
    width: 160,
    height: 22,
    borderRadius: 8,
    backgroundColor: "#1E293B",
    alignSelf: "center",
    marginBottom: 10,
  },
  skeletonEmail: {
    width: 200,
    height: 32,
    borderRadius: 100,
    backgroundColor: "#1E293B",
    alignSelf: "center",
    marginBottom: 36,
  },
  skeletonSection: {
    width: 80,
    height: 12,
    borderRadius: 4,
    backgroundColor: "#1E293B",
    marginBottom: 12,
  },
  skeletonCard: {
    backgroundColor: "#1E293B",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
  },
  skeletonIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#2D3F55",
  },
  skeletonLineShort: {
    height: 10,
    width: "40%",
    borderRadius: 4,
    backgroundColor: "#2D3F55",
  },
  skeletonLineLong: {
    height: 14,
    width: "70%",
    borderRadius: 4,
    backgroundColor: "#334155",
  },

  logoutButton: {
    flexDirection: "row",
    backgroundColor: "transparent",
    height: 58,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#7F1D1D",
    marginBottom: 32,
  },
  logoutButtonText: {
    color: "#F87171",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 1,
  },
});
