import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const { width, height } = Dimensions.get("window");

// ─── Design tokens ────────────────────────────────────────────────────────────
const APP_BG = "#0F172A";
const SURFACE = "#1E293B";
const BORDER = "#334155";
const PURPLE = "#7C3AED";
const PURPLE_DIM = "rgba(124,58,237,0.12)";
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_SECONDARY = "#94A3B8";
const TEXT_MUTED = "#64748B";
const RED_URGENT = "#EF4444";
const RED_DIM = "rgba(239,68,68,0.12)";
const RED_BORDER = "#7F1D1D";
const AMBER = "#F59E0B";
const GREEN = "#10B981";

const API_BASE = "http://192.168.1.105:8080";

// ─── Types ────────────────────────────────────────────────────────────────────
type FlowStep = "symptom-input" | "questions" | "processing" | "results";
type Severity = "mild" | "moderate" | "urgent";

interface RecommendedHospital {
  hospital_id: string;
  name: string;
  distance_miles: number;
  available_beds: number;
  estimated_wait_minutes: number;
  score: number;
}

interface DiagnosisResult {
  severityLevel: Severity;
  esiLevel: number;
  identifiedDepartment: string;
  urgencySummary: string;
  call911: boolean;
  recommendedHospitals: RecommendedHospital[];
  sessionId: string;
  disclaimer: string;
}

// ─── Severity Config ──────────────────────────────────────────────────────────
const SEVERITY_CONFIG: Record<
  Severity,
  {
    color: string;
    label: string;
    icon: "check-circle" | "warning" | "error";
    dimBg: string;
    borderColor: string;
  }
> = {
  mild: {
    color: GREEN,
    label: "Mild",
    icon: "check-circle",
    dimBg: "rgba(16,185,129,0.10)",
    borderColor: "rgba(16,185,129,0.25)",
  },
  moderate: {
    color: AMBER,
    label: "Moderate",
    icon: "warning",
    dimBg: "rgba(245,158,11,0.10)",
    borderColor: "rgba(245,158,11,0.25)",
  },
  urgent: {
    color: RED_URGENT,
    label: "Urgent",
    icon: "error",
    dimBg: RED_DIM,
    borderColor: "rgba(239,68,68,0.25)",
  },
};

const esiToSeverity = (esi: number): Severity => {
  if (esi <= 2) return "urgent";
  if (esi === 3) return "moderate";
  return "mild";
};

// ─── Props ────────────────────────────────────────────────────────────────────
interface DiagnoseContentProps {
  onClose: () => void;
  initialSymptom?: string;
}

// ─── Named export (used inline from index.tsx) ────────────────────────────────
export function DiagnoseContent({ onClose, initialSymptom = "" }: DiagnoseContentProps) {
  const insets = useSafeAreaInsets();
  const userId = useRef(`user_${Math.random().toString(36).slice(2, 10)}`).current;

  const [symptoms, setSymptoms] = useState(initialSymptom);
  const [flowStep, setFlowStep] = useState<FlowStep>("symptom-input");
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalQuestions = questions.length;
  const currentAnswerText = answers[currentQuestion] ?? "";
  const isLastQuestion = currentQuestion === totalQuestions - 1;

  // ── Flow ──────────────────────────────────────────────────────────────────

  const submitSymptoms = async () => {
    if (!symptoms.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/symptoms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          symptom_input: symptoms,
          patient_profile: {},
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      const fetched: string[] = data.questions ?? [];
      setQuestions(fetched);
      setAnswers(new Array(fetched.length).fill(""));
      setCurrentQuestion(0);
      setFlowStep("questions");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const updateAnswer = (text: string) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[currentQuestion] = text;
      return next;
    });
  };

  const goNextQuestion = () => {
    if (currentQuestion < totalQuestions - 1) {
      setCurrentQuestion((q) => q + 1);
    } else {
      runDiagnosis();
    }
  };

  const goPrevQuestion = () => {
    if (currentQuestion > 0) setCurrentQuestion((q) => q - 1);
  };

  const runDiagnosis = async () => {
    setFlowStep("processing");
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          symptom_input: symptoms,
          questions,
          answers,
          patient_profile: {},
          user_latitude: 34.0522,
          user_longitude: -118.2437,
          insurance_provider: "",
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();

      const esi: number = data.triage?.esi_level ?? 3;
      setResult({
        severityLevel: esiToSeverity(esi),
        esiLevel: esi,
        identifiedDepartment: data.triage?.identified_department ?? "General",
        urgencySummary:
          data.triage?.urgency_summary ??
          "Based on your symptoms, further evaluation is recommended.",
        call911: data.triage?.call_911 ?? false,
        recommendedHospitals: data.recommended_hospitals ?? [],
        sessionId: data.session_id ?? "",
        disclaimer:
          "This is not a medical diagnosis. It is an AI-generated assessment for informational purposes only. Always consult a qualified healthcare professional.",
      });
      setFlowStep("results");
    } catch {
      setError("Failed to get your assessment. Please try again.");
      setFlowStep("questions");
    }
  };

  const resetFlow = () => {
    setFlowStep("symptom-input");
    setSymptoms("");
    setQuestions([]);
    setAnswers([]);
    setCurrentQuestion(0);
    setResult(null);
    setError(null);
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* ── Header bar ── */}
      <View style={styles.headerBar}>
        {flowStep !== "symptom-input" && flowStep !== "results" ? (
          <TouchableOpacity
            onPress={flowStep === "questions" ? goPrevQuestion : undefined}
            style={styles.headerIconBtn}
            activeOpacity={0.7}
            disabled={flowStep === "processing"}
          >
            {flowStep === "questions" && currentQuestion > 0 ? (
              <MaterialIcons name="arrow-back" size={18} color={TEXT_SECONDARY} />
            ) : (
              <View style={{ width: 32 }} />
            )}
          </TouchableOpacity>
        ) : (
          <View style={{ width: 32 }} />
        )}

        <Text style={styles.headerTitle}>
          {flowStep === "results"
            ? "Your Assessment"
            : flowStep === "processing"
            ? "Analysing…"
            : flowStep === "questions"
            ? `Question ${currentQuestion + 1} of ${totalQuestions}`
            : "Symptom Checker"}
        </Text>

        <TouchableOpacity
          onPress={flowStep === "results" ? resetFlow : onClose}
          style={styles.headerIconBtn}
          activeOpacity={0.7}
        >
          <MaterialIcons
            name={flowStep === "results" ? "refresh" : "close"}
            size={18}
            color={TEXT_SECONDARY}
          />
        </TouchableOpacity>
      </View>

      {/* ── RESULTS ── */}
      {flowStep === "results" && result && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollPad}
        >
          {/* ESI + department row */}
          <View style={styles.esiBadgeRow}>
            <View style={styles.esiBadge}>
              <Text style={styles.esiBadgeLabel}>ESI LEVEL</Text>
              <Text style={styles.esiBadgeValue}>{result.esiLevel}</Text>
            </View>
            <View style={styles.esiBadge}>
              <Text style={styles.esiBadgeLabel}>DEPARTMENT</Text>
              <Text style={styles.esiBadgeDept}>{result.identifiedDepartment}</Text>
            </View>
          </View>

          {/* Severity card */}
          {(() => {
            const cfg = SEVERITY_CONFIG[result.severityLevel];
            return (
              <View style={[styles.severityCard, { backgroundColor: cfg.dimBg, borderColor: cfg.borderColor }]}>
                <View style={[styles.severityIconWrap, { backgroundColor: cfg.dimBg }]}>
                  <MaterialIcons name={cfg.icon} size={26} color={cfg.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.severityLabel, { color: cfg.color }]}>
                    {cfg.label} Concern
                  </Text>
                  <Text style={styles.severityCondition}>{result.identifiedDepartment}</Text>
                </View>
              </View>
            );
          })()}

          {/* Urgency summary */}
          <Text style={styles.sectionLabel}>WHAT THIS MAY MEAN</Text>
          <View style={styles.card}>
            <Text style={styles.bodyText}>{result.urgencySummary}</Text>
          </View>

          {/* Recommended hospitals */}
          {result.recommendedHospitals.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>RECOMMENDED HOSPITALS</Text>
              <View style={styles.card}>
                {result.recommendedHospitals.map((h, i) => (
                  <View key={h.hospital_id}>
                    <View style={styles.hospitalRow}>
                      <View style={styles.hospitalRank}>
                        <Text style={styles.hospitalRankText}>{i + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.hospitalName}>{h.name}</Text>
                        <View style={styles.hospitalMeta}>
                          <MaterialIcons name="access-time" size={12} color={TEXT_MUTED} />
                          <Text style={styles.hospitalMetaText}>{h.estimated_wait_minutes} min wait</Text>
                          <MaterialIcons name="place" size={12} color={TEXT_MUTED} />
                          <Text style={styles.hospitalMetaText}>{h.distance_miles?.toFixed(1)} mi</Text>
                          <MaterialIcons name="hotel" size={12} color={TEXT_MUTED} />
                          <Text style={styles.hospitalMetaText}>{h.available_beds} beds</Text>
                        </View>
                      </View>
                    </View>
                    {i < result.recommendedHospitals.length - 1 && <View style={styles.divider} />}
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Emergency CTA */}
          <TouchableOpacity
            style={[styles.emergencyBtn, result.call911 && styles.emergencyBtnUrgent]}
            activeOpacity={0.85}
          >
            <MaterialIcons name="phone" size={18} color="#fff" />
            <Text style={styles.emergencyBtnText}>
              {result.call911 ? "CALL 911 NOW — Emergency Care Required" : "Call 911 if symptoms worsen"}
            </Text>
          </TouchableOpacity>

          {/* Disclaimer */}
          <View style={styles.disclaimerBox}>
            <MaterialIcons name="info-outline" size={13} color={TEXT_MUTED} />
            <Text style={styles.disclaimerText}>{result.disclaimer}</Text>
          </View>
        </ScrollView>
      )}

      {/* ── SYMPTOM INPUT / QUESTIONS / PROCESSING ── */}
      {flowStep !== "results" && (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
        >
          {/* ── SYMPTOM INPUT ── */}
          {flowStep === "symptom-input" && (
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.scrollPad}
            >
              <View style={styles.emergencyBanner}>
                <MaterialIcons name="error-outline" size={15} color={RED_URGENT} />
                <Text style={styles.emergencyBannerText}>Life-threatening? Call 911 immediately</Text>
                <TouchableOpacity style={styles.emergencyCallBtn} activeOpacity={0.85}>
                  <Text style={styles.emergencyCallBtnText}>Call 911</Text>
                </TouchableOpacity>
              </View>

              {error && (
                <View style={styles.errorBox}>
                  <MaterialIcons name="error-outline" size={14} color={RED_URGENT} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              <Text style={styles.inputLabel}>Describe your symptoms</Text>
              <View style={styles.symptomInputBox}>
                <TextInput
                  style={styles.symptomTextArea}
                  placeholder="e.g. I have chest tightness and shortness of breath…"
                  placeholderTextColor={TEXT_MUTED}
                  multiline
                  value={symptoms}
                  onChangeText={setSymptoms}
                  autoFocus
                />
                <TouchableOpacity style={styles.micBtn} activeOpacity={0.7}>
                  <MaterialIcons name="mic" size={18} color={PURPLE} />
                </TouchableOpacity>
              </View>

              <Text style={styles.quickLabel}>Common symptoms</Text>
              <View style={styles.chipsRow}>
                {["Chest pain", "Headache", "Fever", "Nausea", "Dizziness", "Back pain", "Fatigue", "Shortness of breath"].map(
                  (chip) => (
                    <TouchableOpacity
                      key={chip}
                      style={[styles.chip, symptoms === chip && styles.chipActive]}
                      onPress={() => setSymptoms(chip)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.chipText, symptoms === chip && styles.chipTextActive]}>
                        {chip}
                      </Text>
                    </TouchableOpacity>
                  )
                )}
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, (!symptoms.trim() || isLoading) && styles.primaryBtnDisabled]}
                onPress={submitSymptoms}
                disabled={!symptoms.trim() || isLoading}
                activeOpacity={0.85}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Text style={styles.primaryBtnText}>Analyse my symptoms</Text>
                    <MaterialIcons name="arrow-forward" size={20} color="#fff" />
                  </>
                )}
              </TouchableOpacity>

              <Text style={styles.disclaimer}>
                For guidance only — not a medical diagnosis.
              </Text>
            </ScrollView>
          )}

          {/* ── QUESTIONS ── */}
          {flowStep === "questions" && questions.length > 0 && (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollPad}
              keyboardShouldPersistTaps="handled"
            >
              {/* Progress track */}
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${((currentQuestion + 1) / totalQuestions) * 100}%` },
                  ]}
                />
              </View>

              <Text style={styles.questionText}>{questions[currentQuestion]}</Text>

              {error && (
                <View style={[styles.errorBox, { marginBottom: 16 }]}>
                  <MaterialIcons name="error-outline" size={14} color={RED_URGENT} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              <View style={styles.answerInputBox}>
                <TextInput
                  style={styles.answerTextInput}
                  placeholder="Type your answer here…"
                  placeholderTextColor={TEXT_MUTED}
                  multiline
                  value={currentAnswerText}
                  onChangeText={updateAnswer}
                  autoFocus
                />
              </View>

              <View style={styles.navBtns}>
                {currentQuestion > 0 && (
                  <TouchableOpacity style={styles.secondaryBtn} onPress={goPrevQuestion} activeOpacity={0.85}>
                    <MaterialIcons name="arrow-back" size={18} color={PURPLE} />
                    <Text style={styles.secondaryBtnText}>Back</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[
                    styles.primaryBtn,
                    !currentAnswerText.trim() && styles.primaryBtnDisabled,
                    currentQuestion === 0 && { flex: 1 },
                  ]}
                  onPress={goNextQuestion}
                  disabled={!currentAnswerText.trim()}
                  activeOpacity={0.85}
                >
                  <Text style={styles.primaryBtnText}>
                    {isLastQuestion ? "Get assessment" : "Next"}
                  </Text>
                  <MaterialIcons
                    name={isLastQuestion ? "check" : "arrow-forward"}
                    size={20}
                    color="#fff"
                  />
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}

          {/* ── PROCESSING ── */}
          {flowStep === "processing" && (
            <View style={styles.processingContainer}>
              <ActivityIndicator size="large" color={PURPLE} />
              <Text style={styles.processingTitle}>Analysing your symptoms…</Text>
              <Text style={styles.processingSubtitle}>
                Our AI is reviewing your responses and ranking nearby hospitals.
              </Text>
              <View style={styles.card}>
                {["Reading your responses", "Running symptom analysis", "Ranking nearby hospitals"].map(
                  (step, i) => (
                    <View key={step}>
                      <View style={styles.processingStep}>
                        <MaterialIcons
                          name="check-circle"
                          size={16}
                          color={i === 2 ? BORDER : GREEN}
                        />
                        <Text style={[styles.processingStepText, i === 2 && { color: TEXT_MUTED }]}>
                          {step}
                        </Text>
                      </View>
                      {i < 2 && <View style={styles.divider} />}
                    </View>
                  )
                )}
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

// ─── Default export (used when navigated to as a route) ───────────────────────
export default function DiagnoseScreen() {
  const router = useRouter();
  return <DiagnoseContent onClose={() => router.back()} />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: APP_BG,
  },

  // ── Header ──
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: TEXT_PRIMARY,
    letterSpacing: 0.2,
  },
  headerIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    justifyContent: "center",
    alignItems: "center",
  },

  scrollPad: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 48,
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
    paddingHorizontal: 18,
    marginBottom: 20,
  },

  divider: { height: 1, backgroundColor: BORDER },

  // ── Error ──
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: RED_DIM,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.25)",
  },
  errorText: { color: RED_URGENT, fontSize: 13, fontWeight: "600", flex: 1, lineHeight: 18 },

  // ── Emergency banner ──
  emergencyBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: RED_DIM,
    borderRadius: 14,
    padding: 12,
    gap: 8,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.25)",
  },
  emergencyBannerText: { color: RED_URGENT, fontSize: 12, fontWeight: "600", flex: 1, lineHeight: 17 },
  emergencyCallBtn: {
    backgroundColor: RED_URGENT,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  emergencyCallBtnText: { color: "#fff", fontWeight: "800", fontSize: 11 },

  // ── Symptom input ──
  inputLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: TEXT_SECONDARY,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  symptomInputBox: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    minHeight: 100,
    marginBottom: 20,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  symptomTextArea: { flex: 1, fontSize: 15, color: TEXT_PRIMARY, lineHeight: 22, minHeight: 70 },
  micBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: PURPLE_DIM,
    justifyContent: "center",
    alignItems: "center",
  },

  quickLabel: {
    fontSize: 10,
    fontWeight: "900",
    color: TEXT_PRIMARY,
    textTransform: "uppercase",
    letterSpacing: 2.5,
    opacity: 0.45,
    marginBottom: 10,
  },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 24 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 100,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
  },
  chipActive: { backgroundColor: PURPLE_DIM, borderColor: PURPLE },
  chipText: { fontSize: 12, color: TEXT_SECONDARY, fontWeight: "500" },
  chipTextActive: { color: PURPLE, fontWeight: "700" },

  // ── Buttons ──
  primaryBtn: {
    backgroundColor: PURPLE,
    borderRadius: 16,
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flex: 1,
  },
  primaryBtnDisabled: { opacity: 0.35 },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  secondaryBtn: {
    backgroundColor: PURPLE_DIM,
    borderRadius: 16,
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flex: 1,
    borderWidth: 1,
    borderColor: PURPLE,
  },
  secondaryBtnText: { color: PURPLE, fontSize: 15, fontWeight: "600" },

  disclaimer: { fontSize: 11, color: TEXT_MUTED, textAlign: "center", marginTop: 14, lineHeight: 15 },

  // ── Questions ──
  progressTrack: { height: 3, backgroundColor: SURFACE, borderRadius: 2, marginBottom: 24 },
  progressFill: { height: 3, backgroundColor: PURPLE, borderRadius: 2 },

  questionText: {
    fontSize: 20,
    fontWeight: "800",
    color: TEXT_PRIMARY,
    marginBottom: 16,
    lineHeight: 28,
  },
  answerInputBox: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    minHeight: 110,
    marginBottom: 18,
  },
  answerTextInput: { fontSize: 15, color: TEXT_PRIMARY, lineHeight: 22, minHeight: 80 },
  navBtns: { flexDirection: "row", gap: 10, marginTop: 4 },

  // ── Processing ──
  processingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 24,
  },
  processingTitle: { fontSize: 19, fontWeight: "800", color: TEXT_PRIMARY, marginTop: 10 },
  processingSubtitle: { fontSize: 13, color: TEXT_SECONDARY, textAlign: "center", lineHeight: 19 },
  processingStep: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 15 },
  processingStepText: { fontSize: 14, color: TEXT_PRIMARY, fontWeight: "500" },

  // ── Results ──
  esiBadgeRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  esiBadge: {
    flex: 1,
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
    alignItems: "center",
  },
  esiBadgeLabel: { fontSize: 9, fontWeight: "900", color: TEXT_MUTED, letterSpacing: 2, marginBottom: 5 },
  esiBadgeValue: { fontSize: 26, fontWeight: "900", color: PURPLE },
  esiBadgeDept: { fontSize: 12, fontWeight: "700", color: TEXT_PRIMARY, textAlign: "center" },

  severityCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
  },
  severityIconWrap: { width: 44, height: 44, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  severityLabel: { fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 3 },
  severityCondition: { fontSize: 15, fontWeight: "700", color: TEXT_PRIMARY, lineHeight: 20 },

  bodyText: { fontSize: 14, color: TEXT_SECONDARY, lineHeight: 22, paddingVertical: 16 },

  hospitalRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 14 },
  hospitalRank: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: PURPLE_DIM,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 2,
  },
  hospitalRankText: { fontSize: 12, fontWeight: "800", color: PURPLE },
  hospitalName: { fontSize: 13, fontWeight: "700", color: TEXT_PRIMARY, marginBottom: 5, lineHeight: 18 },
  hospitalMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 3 },
  hospitalMetaText: { fontSize: 11, color: TEXT_MUTED, marginRight: 6 },

  emergencyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: RED_URGENT,
    marginBottom: 10,
    borderRadius: 16,
    height: 54,
  },
  emergencyBtnUrgent: { backgroundColor: "#DC2626", borderWidth: 2, borderColor: "#FCA5A5" },
  emergencyBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },

  disclaimerBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    padding: 14,
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 8,
  },
  disclaimerText: { fontSize: 10, color: TEXT_MUTED, lineHeight: 15, flex: 1 },
});
