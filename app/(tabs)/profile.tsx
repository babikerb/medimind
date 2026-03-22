import { Picker } from "@react-native-picker/picker";
import { MaterialIcons } from "@expo/vector-icons";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import DateTimePickerModal from "react-native-modal-datetime-picker";
import { supabase } from "../../supabase";

const INSURANCE_PROVIDERS = [
  "Aetna",
  "Amerigroup",
  "Anthem Blue Cross",
  "Blue Cross Blue Shield",
  "Cigna",
  "Centene",
  "Humana",
  "Kaiser Permanente",
  "Molina Healthcare",
  "Oscar Health",
  "UnitedHealthcare",
  "Wellcare",
  "Other",
];

const GENDERS = ["Male", "Female", "Non-binary", "Prefer not to say"];

type Profile = {
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  insurance_provider: string;
  insurance_plan: string;
  dob: string;
  gender: string;
  language: string;
};

// ── View mode components ──────────────────────────────────────────────────────
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

// ── Edit mode components ──────────────────────────────────────────────────────
const FieldLabel = ({ text }: { text: string }) => (
  <Text style={styles.fieldLabel}>{text}</Text>
);

const InputBox = ({
  label,
  value,
  onChange,
  focused,
  onFocus,
  onBlur,
  keyboardType = "default",
  editable = true,
}: {
  label: string;
  value: string;
  onChange?: (t: string) => void;
  focused?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  keyboardType?: "default" | "numeric" | "phone-pad";
  editable?: boolean;
}) => (
  <View style={[styles.inputWrapper, focused && styles.inputWrapperFocused]}>
    <TextInput
      style={styles.input}
      placeholder={label}
      placeholderTextColor="#64748B"
      value={value}
      onChangeText={onChange}
      onFocus={onFocus}
      onBlur={onBlur}
      keyboardType={keyboardType}
      editable={editable}
      autoCorrect={false}
    />
  </View>
);

export default function ProfileScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [isDatePickerVisible, setDatePickerVisible] = useState(false);
  const [isOtherProvider, setIsOtherProvider] = useState(false);
  const [customProvider, setCustomProvider] = useState("");
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    async function fetchProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/(auth)/welcome"); return; }

      setEmail(user.email ?? "");
      setUserId(user.id);

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
      Animated.timing(fadeAnim, { toValue: 1, duration: 280, useNativeDriver: true }).start();
    }
    fetchProfile();
  }, []);

  function startEditing() {
    if (!profile) return;
    const isOther = !INSURANCE_PROVIDERS.slice(0, -1).includes(profile.insurance_provider);
    setIsOtherProvider(isOther);
    setCustomProvider(isOther ? profile.insurance_provider : "");
    setDraft({ ...profile });
    setEditing(true);
  }

  function cancelEditing() {
    setDraft(null);
    setEditing(false);
    setFocusedInput(null);
  }

  function setDraftField(field: keyof Profile, value: string) {
    setDraft((prev) => prev ? { ...prev, [field]: value } : prev);
  }

  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });

    if (!result.canceled) {
      const manipResult = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 300, height: 300 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      setDraftField("avatar_url", `data:image/jpeg;base64,${manipResult.base64}`);
    }
  }

  async function handleSave() {
    if (!draft || !userId) return;
    setSaving(true);

    const finalProvider = isOtherProvider ? customProvider : draft.insurance_provider;

    const { error } = await supabase
      .from("profiles")
      .update({
        first_name: draft.first_name,
        last_name: draft.last_name,
        dob: draft.dob,
        gender: draft.gender,
        language: draft.language,
        insurance_provider: finalProvider,
        insurance_plan: draft.insurance_plan,
        avatar_url: draft.avatar_url,
      })
      .eq("id", userId);

    setSaving(false);

    if (error) {
      Alert.alert("Error", "Could not save changes.");
    } else {
      setProfile({ ...draft, insurance_provider: finalProvider });
      setEditing(false);
      setDraft(null);
    }
  }

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
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${months[parseInt(month, 10) - 1]} ${parseInt(day, 10)}, ${year}`;
  }

  // ── Edit form ───────────────────────────────────────────────────────────────
  const renderEditForm = () => (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={styles.editForm}>

        {/* Avatar picker */}
        <TouchableOpacity style={styles.avatarEditContainer} onPress={pickImage} activeOpacity={0.8}>
          {draft?.avatar_url ? (
            <Image source={{ uri: draft.avatar_url }} style={styles.avatarEdit} />
          ) : (
            <View style={styles.avatarEditFallback}>
              <Text style={styles.avatarInitials}>
                {draft?.first_name?.[0] ?? ""}{draft?.last_name?.[0] ?? ""}
              </Text>
            </View>
          )}
          <View style={styles.cameraOverlay}>
            <MaterialIcons name="camera-alt" size={18} color="#fff" />
          </View>
        </TouchableOpacity>
        <Text style={styles.changePhotoHint}>Tap to change photo</Text>

        {/* Name */}
        <FieldLabel text="FIRST NAME" />
        <InputBox
          label="First Name"
          value={draft?.first_name ?? ""}
          onChange={(t) => setDraftField("first_name", t)}
          focused={focusedInput === "fn"}
          onFocus={() => setFocusedInput("fn")}
          onBlur={() => setFocusedInput(null)}
        />

        <FieldLabel text="LAST NAME" />
        <InputBox
          label="Last Name"
          value={draft?.last_name ?? ""}
          onChange={(t) => setDraftField("last_name", t)}
          focused={focusedInput === "ln"}
          onFocus={() => setFocusedInput("ln")}
          onBlur={() => setFocusedInput(null)}
        />

        {/* Date of Birth */}
        <FieldLabel text="DATE OF BIRTH" />
        <TouchableOpacity onPress={() => setDatePickerVisible(true)}>
          <View pointerEvents="none">
            <InputBox
              label="Select Birthday"
              value={draft?.dob ? formatDob(draft.dob) : ""}
              editable={false}
            />
          </View>
        </TouchableOpacity>
        <DateTimePickerModal
          isVisible={isDatePickerVisible}
          mode="date"
          onConfirm={(date) => {
            setDraftField("dob", date.toISOString().split("T")[0]);
            setDatePickerVisible(false);
          }}
          onCancel={() => setDatePickerVisible(false)}
          isDarkModeEnabled
          textColor="white"
          maximumDate={new Date()}
        />

        {/* Gender */}
        <FieldLabel text="GENDER" />
        <View style={styles.genderGroup}>
          {GENDERS.map((g) => (
            <TouchableOpacity
              key={g}
              style={[styles.genderBtn, draft?.gender === g && styles.genderBtnActive]}
              onPress={() => setDraftField("gender", g)}
              activeOpacity={0.8}
            >
              <Text style={[styles.genderBtnText, draft?.gender === g && styles.genderBtnTextActive]}>
                {g}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Language */}
        <FieldLabel text="LANGUAGE" />
        <InputBox
          label="Preferred Language"
          value={draft?.language ?? ""}
          onChange={(t) => setDraftField("language", t)}
          focused={focusedInput === "lang"}
          onFocus={() => setFocusedInput("lang")}
          onBlur={() => setFocusedInput(null)}
        />

        {/* Insurance Provider */}
        <FieldLabel text="INSURANCE PROVIDER" />
        <View style={styles.pickerWrapper}>
          <Picker
            selectedValue={isOtherProvider ? "Other" : (draft?.insurance_provider ?? "")}
            onValueChange={(v) => {
              if (v === "Other") {
                setIsOtherProvider(true);
                setDraftField("insurance_provider", "");
              } else {
                setIsOtherProvider(false);
                setCustomProvider("");
                setDraftField("insurance_provider", v);
              }
            }}
            style={{ color: "#FFF" }}
            dropdownIconColor="#7C3AED"
          >
            <Picker.Item label="Select Provider" value="" color="#94A3B8" />
            {INSURANCE_PROVIDERS.map((p) => (
              <Picker.Item
                key={p}
                label={p}
                value={p}
                color={Platform.OS === "ios" ? "#FFF" : "#000"}
              />
            ))}
          </Picker>
        </View>

        {isOtherProvider && (
          <InputBox
            label="Type Provider Name"
            value={customProvider}
            onChange={setCustomProvider}
            focused={focusedInput === "cp"}
            onFocus={() => setFocusedInput("cp")}
            onBlur={() => setFocusedInput(null)}
          />
        )}

        {/* Insurance Plan */}
        <FieldLabel text="INSURANCE PLAN" />
        <InputBox
          label="e.g. PPO, HMO"
          value={draft?.insurance_plan ?? ""}
          onChange={(t) => setDraftField("insurance_plan", t)}
          focused={focusedInput === "plan"}
          onFocus={() => setFocusedInput("plan")}
          onBlur={() => setFocusedInput(null)}
        />

        {/* Save button */}
        <TouchableOpacity
          style={[styles.saveButton, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.saveButtonText}>Save Changes</Text>
          }
        </TouchableOpacity>
      </View>
    </TouchableWithoutFeedback>
  );

  // ── View mode ───────────────────────────────────────────────────────────────
  const renderViewMode = () => (
    <>
      {/* Hero */}
      <View style={styles.heroSection}>
        <View style={styles.avatarContainer}>
          {profile?.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarInitials}>
                {profile?.first_name?.[0] ?? ""}{profile?.last_name?.[0] ?? ""}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.heroName}>{profile?.first_name} {profile?.last_name}</Text>
        <View style={styles.emailBadge}>
          <MaterialIcons name="mail-outline" size={13} color="#64748B" style={{ marginRight: 6 }} />
          <Text style={styles.emailText}>{email}</Text>
        </View>
      </View>

      <SectionHeader title="PERSONAL" />
      <View style={styles.card}>
        <InfoCard label="Date of Birth" value={formatDob(profile?.dob ?? "")} iconName="cake" />
        <View style={styles.divider} />
        <InfoCard label="Gender" value={profile?.gender ?? ""} iconName="person-outline" />
        <View style={styles.divider} />
        <InfoCard label="Language" value={profile?.language ?? ""} iconName="language" />
      </View>

      <SectionHeader title="INSURANCE" />
      <View style={styles.card}>
        <InfoCard label="Provider" value={profile?.insurance_provider ?? ""} iconName="local-hospital" />
        <View style={styles.divider} />
        <InfoCard label="Plan" value={profile?.insurance_plan ?? ""} iconName="description" />
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.8}>
        <MaterialIcons name="logout" size={18} color="#F87171" style={{ marginRight: 8 }} />
        <Text style={styles.logoutButtonText}>Log Out</Text>
      </TouchableOpacity>
    </>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      {/* Nav */}
      <View style={styles.topNav}>
        <TouchableOpacity
          style={styles.headerIconBtn}
          onPress={editing ? cancelEditing : () => router.back()}
          activeOpacity={0.7}
        >
          <MaterialIcons name={editing ? "close" : "arrow-back"} size={18} color="#94A3B8" />
        </TouchableOpacity>
        <Text style={styles.navTitle}>{editing ? "Edit Profile" : "Profile"}</Text>
        {editing ? (
          <View style={{ width: 32 }} />
        ) : (
          <TouchableOpacity style={styles.headerIconBtn} onPress={startEditing} activeOpacity={0.7}>
            <MaterialIcons name="edit" size={16} color="#94A3B8" />
          </TouchableOpacity>
        )}
      </View>

      {/* Skeleton */}
      {loading ? (
        <View style={styles.loadingScreen}>
          <View style={styles.skeletonAvatar} />
          <View style={styles.skeletonName} />
          <View style={styles.skeletonEmail} />
          <View style={styles.skeletonSection} />
          <View style={styles.skeletonCard}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.skeletonRow}>
                <View style={styles.skeletonIcon} />
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={styles.skeletonLineShort} />
                  <View style={styles.skeletonLineLong} />
                </View>
              </View>
            ))}
          </View>
          <ActivityIndicator size="small" color="#7C3AED" style={{ marginTop: 24 }} />
        </View>
      ) : null}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Animated.ScrollView
          style={[{ opacity: fadeAnim }, loading && { position: "absolute", opacity: 0 }]}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {editing ? renderEditForm() : renderViewMode()}
        </Animated.ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  topNav: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
  },
  navTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "800", letterSpacing: 0.2 },
  headerIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "#334155",
    justifyContent: "center",
    alignItems: "center",
  },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 48 },

  // ── View mode ──
  heroSection: { alignItems: "center", marginTop: 16, marginBottom: 36 },
  avatarContainer: { marginBottom: 16 },
  avatar: { width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: "#7C3AED" },
  avatarFallback: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: "#1E293B", borderWidth: 3, borderColor: "#7C3AED",
    justifyContent: "center", alignItems: "center",
  },
  avatarInitials: { color: "#7C3AED", fontSize: 32, fontWeight: "800" },
  heroName: { color: "#FFFFFF", fontSize: 26, fontWeight: "800", marginBottom: 8, textAlign: "center" },
  emailBadge: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#1E293B", paddingVertical: 6, paddingHorizontal: 16,
    borderRadius: 100, borderWidth: 1, borderColor: "#334155",
  },
  emailText: { color: "#94A3B8", fontSize: 13, fontWeight: "500" },
  sectionHeader: {
    color: "#FFFFFF", fontSize: 11, fontWeight: "900", letterSpacing: 3,
    opacity: 0.5, marginBottom: 12, marginTop: 4,
  },
  card: {
    backgroundColor: "#1E293B", borderRadius: 20, borderWidth: 1,
    borderColor: "#334155", paddingHorizontal: 20, marginBottom: 24,
  },
  divider: { height: 1, backgroundColor: "#334155" },
  infoCard: { flexDirection: "row", alignItems: "center", paddingVertical: 16, gap: 14 },
  iconWrapper: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "rgba(124, 58, 237, 0.12)",
    justifyContent: "center", alignItems: "center",
  },
  infoCardText: { flex: 1 },
  infoLabel: {
    color: "#64748B", fontSize: 11, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 1, marginBottom: 3,
  },
  infoValue: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  logoutButton: {
    flexDirection: "row", backgroundColor: "transparent", height: 54,
    borderRadius: 16, justifyContent: "center", alignItems: "center",
    borderWidth: 1, borderColor: "#7F1D1D", marginBottom: 32,
  },
  logoutButtonText: { color: "#F87171", fontSize: 15, fontWeight: "700" },

  // ── Edit mode ──
  editForm: { paddingTop: 8 },
  avatarEditContainer: {
    alignSelf: "center",
    marginBottom: 8,
    marginTop: 16,
  },
  avatarEdit: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: "#7C3AED",
  },
  avatarEditFallback: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#1E293B",
    borderWidth: 3,
    borderColor: "#7C3AED",
    justifyContent: "center",
    alignItems: "center",
  },
  cameraOverlay: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#7C3AED",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#0F172A",
  },
  changePhotoHint: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "500",
    textAlign: "center",
    marginBottom: 24,
  },
  fieldLabel: {
    color: "#FFFFFF", fontSize: 11, fontWeight: "900",
    letterSpacing: 2, opacity: 0.5, marginBottom: 8, marginTop: 4,
  },
  inputWrapper: {
    backgroundColor: "#1E293B", height: 64, borderRadius: 18,
    marginBottom: 16, borderWidth: 1, borderColor: "#334155",
    justifyContent: "center", paddingHorizontal: 16,
  },
  inputWrapperFocused: { borderColor: "#7C3AED" },
  input: { color: "#FFFFFF", fontSize: 16, fontWeight: "500" },
  genderGroup: {
    flexDirection: "row", flexWrap: "wrap",
    justifyContent: "space-between", marginBottom: 16,
  },
  genderBtn: {
    width: "48%", backgroundColor: "#1E293B",
    paddingVertical: 14, borderRadius: 14, marginBottom: 12,
    alignItems: "center", borderWidth: 1, borderColor: "#334155",
  },
  genderBtnActive: { borderColor: "#7C3AED", backgroundColor: "#2D2159" },
  genderBtnText: { color: "#94A3B8", fontWeight: "600" },
  genderBtnTextActive: { color: "#FFFFFF" },
  pickerWrapper: {
    backgroundColor: "#1E293B", borderRadius: 18, marginBottom: 16,
    borderWidth: 1, borderColor: "#334155", overflow: "hidden",
  },
  saveButton: {
    backgroundColor: "#7C3AED", height: 54, borderRadius: 16,
    justifyContent: "center", alignItems: "center", marginTop: 8, marginBottom: 32,
  },
  saveButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },

  // ── Skeleton ──
  loadingScreen: { flex: 1, paddingHorizontal: 28, paddingTop: 20 },
  skeletonAvatar: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: "#1E293B", alignSelf: "center", marginBottom: 14,
  },
  skeletonName: {
    width: 160, height: 22, borderRadius: 8,
    backgroundColor: "#1E293B", alignSelf: "center", marginBottom: 10,
  },
  skeletonEmail: {
    width: 200, height: 32, borderRadius: 100,
    backgroundColor: "#1E293B", alignSelf: "center", marginBottom: 36,
  },
  skeletonSection: { width: 80, height: 12, borderRadius: 4, backgroundColor: "#1E293B", marginBottom: 12 },
  skeletonCard: {
    backgroundColor: "#1E293B", borderRadius: 20, borderWidth: 1,
    borderColor: "#334155", paddingHorizontal: 20, marginBottom: 24,
  },
  skeletonRow: {
    flexDirection: "row", alignItems: "center", paddingVertical: 16,
    gap: 14, borderBottomWidth: 1, borderBottomColor: "#334155",
  },
  skeletonIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#2D3F55" },
  skeletonLineShort: { height: 10, width: "40%", borderRadius: 4, backgroundColor: "#2D3F55" },
  skeletonLineLong: { height: 14, width: "70%", borderRadius: 4, backgroundColor: "#334155" },
});
