import { MaterialIcons } from "@expo/vector-icons";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../supabase";
import {
  InsuranceExtracted,
  InsuranceVerifyResponse,
  verifyInsurance,
} from "../services/api";

const APP_BG = "#0F172A";
const SURFACE = "#1E293B";
const BORDER = "#334155";
const PURPLE = "#7C3AED";
const PURPLE_DIM = "rgba(124,58,237,0.12)";
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_SECONDARY = "#94A3B8";
const TEXT_MUTED = "#64748B";
const GREEN = "#10B981";
const BLUE = "#3B82F6";
const AMBER = "#F59E0B";

type Step = "capture" | "processing" | "results";

export default function InsuranceScanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [step, setStep] = useState<Step>("capture");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [result, setResult] = useState<InsuranceVerifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const captureImage = async (useCamera: boolean) => {
    const permission = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert("Permission needed", "Please grant camera/photo access to scan your insurance card.");
      return;
    }

    const pickerResult = useCamera
      ? await ImagePicker.launchCameraAsync({
          allowsEditing: true,
          quality: 1,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          quality: 1,
        });

    if (pickerResult.canceled) return;

    const manipulated = await ImageManipulator.manipulateAsync(
      pickerResult.assets[0].uri,
      [{ resize: { width: 1200 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );

    setImageUri(pickerResult.assets[0].uri);
    processImage(manipulated.base64!);
  };

  const processImage = async (base64: string) => {
    setStep("processing");
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id || "";

      const response = await verifyInsurance({
        user_id: userId,
        image_base64: base64,
      });

      setResult(response);
      setStep("results");
    } catch (e: any) {
      console.error("Insurance verification error:", e);
      setError("Could not process insurance card. Please try again with a clearer image.");
      setStep("capture");
    }
  };

  const InfoRow = ({ label, value, icon }: { label: string; value: string | null; icon: keyof typeof MaterialIcons.glyphMap }) => {
    if (!value) return null;
    return (
      <View style={s.infoRow}>
        <View style={s.infoIcon}>
          <MaterialIcons name={icon} size={16} color={PURPLE} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.infoLabel}>{label}</Text>
          <Text style={s.infoValue}>{value}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={[s.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerIconBtn} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={18} color={TEXT_SECONDARY} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Insurance Verification</Text>
        <View style={{ width: 32 }} />
      </View>

      {step === "capture" && (
        <View style={s.captureContainer}>
          {imageUri && error && (
            <View style={s.errorCard}>
              <MaterialIcons name="error-outline" size={24} color="#EF4444" />
              <Text style={s.errorText}>{error}</Text>
            </View>
          )}

          <View style={s.illustrationArea}>
            <View style={s.cardOutline}>
              <MaterialIcons name="credit-card" size={64} color={PURPLE} />
              <Text style={s.cardOutlineText}>Insurance Card</Text>
            </View>
          </View>

          <Text style={s.captureTitle}>Scan Your Insurance Card</Text>
          <Text style={s.captureSubtitle}>
            Take a photo or upload an image of your insurance card. Our AI will extract your coverage details and match you to accepted hospitals.
          </Text>

          <TouchableOpacity style={s.primaryBtn} onPress={() => captureImage(true)} activeOpacity={0.85}>
            <MaterialIcons name="photo-camera" size={20} color="#fff" />
            <Text style={s.primaryBtnText}>Take Photo</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.secondaryBtn} onPress={() => captureImage(false)} activeOpacity={0.85}>
            <MaterialIcons name="photo-library" size={20} color={PURPLE} />
            <Text style={s.secondaryBtnText}>Upload from Gallery</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === "processing" && (
        <View style={s.processingContainer}>
          {imageUri && (
            <Image source={{ uri: imageUri }} style={s.previewImage} />
          )}
          <View style={s.processingSpinner}>
            <ActivityIndicator size="large" color={PURPLE} />
          </View>
          <Text style={s.processingTitle}>Analyzing your card...</Text>
          <Text style={s.processingSubtitle}>
            AI is extracting insurance details from your card image
          </Text>
        </View>
      )}

      {step === "results" && result && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.resultsPad}>
          {/* Card preview */}
          {imageUri && (
            <Image source={{ uri: imageUri }} style={s.resultPreview} />
          )}

          {/* Extracted info */}
          <Text style={s.sectionLabel}>EXTRACTED INFORMATION</Text>
          <View style={s.card}>
            <InfoRow label="Provider" value={result.extracted.provider_name} icon="local-hospital" />
            <InfoRow label="Member ID" value={result.extracted.member_id} icon="badge" />
            <InfoRow label="Group Number" value={result.extracted.group_number} icon="group" />
            <InfoRow label="Plan Type" value={result.extracted.plan_type} icon="description" />
            <InfoRow label="Plan Name" value={result.extracted.plan_name} icon="assignment" />
            <InfoRow label="ER Copay" value={result.extracted.copay_er} icon="local-atm" />
            <InfoRow label="Urgent Care Copay" value={result.extracted.copay_urgent} icon="local-atm" />
            <InfoRow label="Effective Date" value={result.extracted.effective_date} icon="event" />
          </View>

          {/* Hospital matches */}
          <Text style={s.sectionLabel}>ACCEPTED AT {result.matched_hospitals_count} HOSPITALS</Text>
          <View style={s.card}>
            {result.matched_hospitals.length > 0 ? (
              result.matched_hospitals.map((h, i) => (
                <View key={h.id} style={[s.hospitalRow, i > 0 && s.hospitalRowBorder]}>
                  <MaterialIcons name="check-circle" size={16} color={GREEN} />
                  <Text style={s.hospitalName}>{h.name}</Text>
                </View>
              ))
            ) : (
              <View style={s.noMatchRow}>
                <MaterialIcons name="info-outline" size={16} color={AMBER} />
                <Text style={s.noMatchText}>
                  No hospital matches found. Your insurance may still be accepted — verify directly with the hospital.
                </Text>
              </View>
            )}
          </View>

          {/* Profile update status */}
          {result.profile_updated && (
            <View style={s.updateBanner}>
              <MaterialIcons name="check-circle" size={16} color={GREEN} />
              <Text style={s.updateBannerText}>Profile updated with your insurance info</Text>
            </View>
          )}

          {/* Actions */}
          <TouchableOpacity style={s.primaryBtn} onPress={() => router.back()} activeOpacity={0.85}>
            <MaterialIcons name="check" size={20} color="#fff" />
            <Text style={s.primaryBtnText}>Done</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.secondaryBtn}
            onPress={() => {
              setStep("capture");
              setResult(null);
              setImageUri(null);
            }}
            activeOpacity={0.85}
          >
            <MaterialIcons name="refresh" size={20} color={PURPLE} />
            <Text style={s.secondaryBtnText}>Scan Another Card</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: APP_BG },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerTitle: { fontSize: 15, fontWeight: "800", color: TEXT_PRIMARY, letterSpacing: 0.2 },
  headerIconBtn: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
    justifyContent: "center", alignItems: "center",
  },

  // Capture
  captureContainer: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  illustrationArea: {
    alignItems: "center",
    marginBottom: 32,
  },
  cardOutline: {
    width: 200,
    height: 130,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: PURPLE,
    borderStyle: "dashed",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: PURPLE_DIM,
  },
  cardOutlineText: {
    fontSize: 12,
    fontWeight: "600",
    color: TEXT_MUTED,
    marginTop: 8,
  },
  captureTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: TEXT_PRIMARY,
    textAlign: "center",
    marginBottom: 12,
  },
  captureSubtitle: {
    fontSize: 14,
    color: TEXT_SECONDARY,
    textAlign: "center",
    lineHeight: 21,
    marginBottom: 32,
  },
  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(239,68,68,0.1)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.25)",
  },
  errorText: { fontSize: 13, color: "#EF4444", flex: 1 },

  // Processing
  processingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 28,
  },
  previewImage: {
    width: 260,
    height: 160,
    borderRadius: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: BORDER,
  },
  processingSpinner: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: PURPLE_DIM,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  processingTitle: {
    fontSize: 19,
    fontWeight: "800",
    color: TEXT_PRIMARY,
    textAlign: "center",
  },
  processingSubtitle: {
    fontSize: 13,
    color: TEXT_SECONDARY,
    textAlign: "center",
    marginTop: 8,
  },

  // Results
  resultsPad: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },
  resultPreview: {
    width: "100%",
    height: 180,
    borderRadius: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: BORDER,
  },
  sectionLabel: {
    color: TEXT_PRIMARY,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2.5,
    opacity: 0.45,
    marginBottom: 10,
    marginTop: 4,
  },
  card: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  infoIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: PURPLE_DIM,
    justifyContent: "center",
    alignItems: "center",
  },
  infoLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: TEXT_MUTED,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: "600",
    color: TEXT_PRIMARY,
    marginTop: 2,
  },
  hospitalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
  },
  hospitalRowBorder: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  hospitalName: {
    fontSize: 14,
    fontWeight: "600",
    color: TEXT_PRIMARY,
    flex: 1,
  },
  noMatchRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 14,
  },
  noMatchText: {
    fontSize: 13,
    color: TEXT_SECONDARY,
    flex: 1,
    lineHeight: 19,
  },
  updateBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(16,185,129,0.1)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.25)",
  },
  updateBannerText: {
    fontSize: 13,
    fontWeight: "600",
    color: GREEN,
  },

  // Buttons
  primaryBtn: {
    backgroundColor: PURPLE,
    borderRadius: 16,
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 10,
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  secondaryBtn: {
    backgroundColor: PURPLE_DIM,
    borderRadius: 16,
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: PURPLE,
    marginBottom: 10,
  },
  secondaryBtnText: { color: PURPLE, fontSize: 16, fontWeight: "600" },
});
