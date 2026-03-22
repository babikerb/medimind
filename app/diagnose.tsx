import { MaterialIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

const { width, height } = Dimensions.get("window");

// ─── Design tokens ────────────────────────────────────────────────────────────
const APP_BG = "#0F172A";
const SURFACE = "#1E293B";
const BORDER = "#334155";
const PURPLE = "#7C3AED";
const PURPLE_DIM = "rgba(124,58,237,0.12)";
const PURPLE_SOFT = "rgba(124,58,237,0.18)";
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

// ─── Reusable sub-components ──────────────────────────────────────────────────

const SectionHeader = ({ title }: { title: string }) => (
  <Text style={styles.sectionHeader}>{title}</Text>
);

// ─── Component ────────────────────────────────────────────────────────────────

export default function DiagnoseScreen() {
  const navigation = useNavigation();

  // generate a stable session user_id
  const userId = useRef(
    `user_${Math.random().toString(36).slice(2, 10)}`
  ).current;

  const [symptoms, setSymptoms] = useState("");
  const [flowStep, setFlowStep] = useState<FlowStep>("symptom-input");
  const [currentQuestion, setCurrentQuestion] = useState(0);

  // backend-fetched questions (plain strings)
  const [questions, setQuestions] = useState<string[]>([]);
  // one free-text answer per question
  const [answers, setAnswers] = useState<string[]>([]);

  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalQuestions = questions.length;
  const currentAnswerText = answers[currentQuestion] ?? "";
  const isLastQuestion = currentQuestion === totalQuestions - 1;

  // ── Flow ──────────────────────────────────────────────────────────────────

  const goBack = () => navigation.goBack();

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
    } catch (e: any) {
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
          user_latitude: 34.0522,   // default: LA
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
          data.triage?.urgency_summary ?? "Based on your symptoms, further evaluation is recommended.",
        call911: data.triage?.call_911 ?? false,
        recommendedHospitals: data.recommended_hospitals ?? [],
        sessionId: data.session_id ?? "",
        disclaimer:
          "This is not a medical diagnosis. It is an AI-generated assessment for informational purposes only. Always consult a qualified healthcare professional.",
      });
      setFlowStep("results");
    } catch (e: any) {
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
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" backgroundColor="#0F172A" translucent={false} />

      {/* ── RESULTS ── */}
      {flowStep === "results" && result && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.resultsScroll}
        >
          <View style={styles.topNav}>
            <TouchableOpacity
              onPress={resetFlow}
              style={styles.backBtn}
              activeOpacity={0.8}
            >
              <MaterialIcons name="arrow-back" size={20} color={TEXT_PRIMARY} />
            </TouchableOpacity>
            <Text style={styles.navTitle}>ASSESSMENT</Text>
            <View style={{ width: 38 }} />
          </View>

          {/* ESI badge */}
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
              <View
                style={[
                  styles.severityCard,
                  { backgroundColor: cfg.dimBg, borderColor: cfg.borderColor },
                ]}
              >
                <View style={[styles.severityIconWrap, { backgroundColor: cfg.dimBg }]}>
                  <MaterialIcons name={cfg.icon} size={26} color={cfg.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.severityLabel, { color: cfg.color }]}>
                    {cfg.label} Concern
                  </Text>
                  <Text style={styles.severityCondition}>
                    {result.identifiedDepartment}
                  </Text>
                </View>
              </View>
            );
          })()}

          {/* Urgency summary */}
          <SectionHeader title="WHAT THIS MAY MEAN" />
          <View style={styles.card}>
            <Text style={styles.bodyText}>{result.urgencySummary}</Text>
          </View>

          {/* Recommended hospitals */}
          {result.recommendedHospitals.length > 0 && (
            <>
              <SectionHeader title="RECOMMENDED HOSPITALS" />
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
                          <Text style={styles.hospitalMetaText}>
                            {h.estimated_wait_minutes} min wait
                          </Text>
                          <MaterialIcons name="place" size={12} color={TEXT_MUTED} />
                          <Text style={styles.hospitalMetaText}>
                            {h.distance_miles?.toFixed(1)} mi
                          </Text>
                          <MaterialIcons name="hotel" size={12} color={TEXT_MUTED} />
                          <Text style={styles.hospitalMetaText}>
                            {h.available_beds} beds
                          </Text>
                        </View>
                      </View>
                    </View>
                    {i < result.recommendedHospitals.length - 1 && (
                      <View style={styles.divider} />
                    )}
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Emergency CTA — always shown, more prominent if call_911 */}
          <TouchableOpacity
            style={[
              styles.emergencyResultBtn,
              result.call911 && styles.emergencyResultBtnPulsing,
            ]}
            activeOpacity={0.85}
          >
            <MaterialIcons name="phone" size={18} color="#fff" />
            <Text style={styles.emergencyResultBtnText}>
              {result.call911
                ? "CALL 911 NOW — Emergency Care Required"
                : "Call 911 if symptoms worsen"}
            </Text>
          </TouchableOpacity>

          {/* Start over */}
          <TouchableOpacity
            style={styles.startOverBtn}
            onPress={resetFlow}
            activeOpacity={0.8}
          >
            <Text style={styles.startOverBtnText}>Check different symptoms</Text>
          </TouchableOpacity>

          {/* Disclaimer */}
          <View style={styles.disclaimerBox}>
            <MaterialIcons name="info-outline" size={14} color={TEXT_MUTED} />
            <Text style={styles.disclaimerText}>{result.disclaimer}</Text>
          </View>
        </ScrollView>
      )}

      {/* ── QUESTIONNAIRE FLOW ── */}
      {flowStep !== "results" && (
        <KeyboardAvoidingView
          style={styles.flexContainer}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
        >
          {/* Top nav */}
          <View style={styles.topNav}>
            <TouchableOpacity
              onPress={goBack}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialIcons name="arrow-back" size={22} color={TEXT_SECONDARY} />
            </TouchableOpacity>
            <Text style={styles.navTitle}>SYMPTOM CHECKER</Text>
            <View style={{ width: 22 }} />
          </View>

          {/* ── SYMPTOM INPUT ── */}
          {flowStep === "symptom-input" && (
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.scrollContent}
            >
              {/* Emergency banner */}
              <View style={styles.emergencyBanner}>
                <MaterialIcons name="error-outline" size={16} color={RED_URGENT} />
                <Text style={styles.emergencyBannerText}>
                  If this is life-threatening, please call 911
                </Text>
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

              <Text style={styles.inputLabel}>Describe your symptoms in detail</Text>
              <View style={styles.symptomInputBox}>
                <TextInput
                  style={styles.symptomTextArea}
                  placeholder="e.g. My chest hurts and I feel short of breath…"
                  placeholderTextColor={TEXT_MUTED}
                  multiline
                  value={symptoms}
                  onChangeText={setSymptoms}
                  autoFocus
                />
                <TouchableOpacity style={styles.micButton} activeOpacity={0.7}>
                  <MaterialIcons name="mic" size={20} color={PURPLE} />
                </TouchableOpacity>
              </View>

              <Text style={styles.quickLabel}>Common symptoms</Text>
              <View style={styles.chipsRow}>
                {[
                  "Chest pain",
                  "Headache",
                  "Fever",
                  "Nausea",
                  "Dizziness",
                  "Back pain",
                  "Fatigue",
                  "Shortness of breath",
                ].map((chip) => (
                  <TouchableOpacity
                    key={chip}
                    style={[styles.chip, symptoms === chip && styles.chipActive]}
                    onPress={() => setSymptoms(chip)}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        symptoms === chip && styles.chipTextActive,
                      ]}
                    >
                      {chip}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  (!symptoms.trim() || isLoading) && styles.primaryButtonDisabled,
                ]}
                onPress={submitSymptoms}
                disabled={!symptoms.trim() || isLoading}
                activeOpacity={0.85}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Text style={styles.primaryButtonText}>Check my symptoms</Text>
                    <MaterialIcons name="arrow-forward" size={20} color="#fff" />
                  </>
                )}
              </TouchableOpacity>

              <Text style={styles.disclaimer}>
                This assessment is for guidance only and is not a medical diagnosis.
              </Text>
            </ScrollView>
          )}

          {/* ── QUESTIONS ── */}
          {flowStep === "questions" && questions.length > 0 && (
            <View style={styles.questionContainer}>
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
              >
                {/* Progress */}
                <View style={styles.progressRow}>
                  <Text style={styles.progressLabel}>
                    Question {currentQuestion + 1} of {totalQuestions}
                  </Text>
                  <Text style={styles.progressPercent}>
                    {Math.round(((currentQuestion + 1) / totalQuestions) * 100)}%
                  </Text>
                </View>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${((currentQuestion + 1) / totalQuestions) * 100}%`,
                      },
                    ]}
                  />
                </View>

                {/* Emergency inline */}
                <TouchableOpacity style={styles.emergencyInlineBtn} activeOpacity={0.85}>
                  <MaterialIcons name="phone" size={13} color={RED_URGENT} />
                  <Text style={styles.emergencyInlineText}>Emergency? Call 911</Text>
                </TouchableOpacity>

                <Text style={styles.questionText}>
                  {questions[currentQuestion]}
                </Text>

                {error && (
                  <View style={[styles.errorBox, { marginBottom: 16 }]}>
                    <MaterialIcons name="error-outline" size={14} color={RED_URGENT} />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}

                {/* Free-text answer input */}
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

                {/* Navigation buttons */}
                <View style={styles.questionNavButtons}>
                  {currentQuestion > 0 && (
                    <TouchableOpacity
                      style={styles.secondaryButton}
                      onPress={goPrevQuestion}
                      activeOpacity={0.85}
                    >
                      <MaterialIcons name="arrow-back" size={20} color={PURPLE} />
                      <Text style={styles.secondaryButtonText}>Back</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[
                      styles.primaryButton,
                      !currentAnswerText.trim() && styles.primaryButtonDisabled,
                      currentQuestion === 0 && { flex: 1 },
                    ]}
                    onPress={goNextQuestion}
                    disabled={!currentAnswerText.trim()}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.primaryButtonText}>
                      {isLastQuestion ? "Get my assessment" : "Next"}
                    </Text>
                    <MaterialIcons
                      name={isLastQuestion ? "check" : "arrow-forward"}
                      size={20}
                      color="#fff"
                    />
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          )}

          {/* ── PROCESSING ── */}
          {flowStep === "processing" && (
            <View style={styles.processingContainer}>
              <ActivityIndicator size="large" color={PURPLE} />
              <Text style={styles.processingTitle}>Analysing your symptoms…</Text>
              <Text style={styles.processingSubtitle}>
                Our AI is reviewing your responses and generating your assessment.
              </Text>
              <View style={styles.card}>
                {[
                  "Reading your responses",
                  "Running symptom analysis",
                  "Ranking nearby hospitals",
                ].map((step, i) => (
                  <View key={step}>
                    <View style={styles.processingStep}>
                      <MaterialIcons
                        name="check-circle"
                        size={16}
                        color={i === 2 ? BORDER : GREEN}
                      />
                      <Text
                        style={[
                          styles.processingStepText,
                          i === 2 && { color: TEXT_MUTED },
                        ]}
                      >
                        {step}
                      </Text>
                    </View>
                    {i < 2 && <View style={styles.divider} />}
                  </View>
                ))}
              </View>
              <Text style={styles.disclaimer}>
                This assessment is for guidance only and is not a medical diagnosis.
              </Text>
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: APP_BG,
  },
  flexContainer: {
    flex: 1,
  },

  topNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 28,
    paddingTop: Platform.OS === "android" ? 16 : 10,
    paddingBottom: 12,
    height: 60,
  },
  navTitle: {
    color: TEXT_PRIMARY,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 4,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    justifyContent: "center",
    alignItems: "center",
  },

  scrollContent: {
    paddingHorizontal: 28,
    paddingBottom: 40,
  },
  resultsScroll: {
    paddingBottom: 48,
  },

  sectionHeader: {
    color: TEXT_PRIMARY,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 3,
    opacity: 0.5,
    marginBottom: 12,
    marginTop: 4,
    marginHorizontal: 28,
  },

  card: {
    backgroundColor: SURFACE,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 20,
    marginBottom: 24,
    marginHorizontal: 28,
  },

  divider: {
    height: 1,
    backgroundColor: BORDER,
  },

  // ── Error box ──
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: RED_DIM,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.25)",
  },
  errorText: {
    color: RED_URGENT,
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
    lineHeight: 18,
  },

  // ── Emergency banner ──
  emergencyBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: RED_DIM,
    borderRadius: 16,
    padding: 14,
    gap: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.25)",
  },
  emergencyBannerText: {
    color: RED_URGENT,
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
    lineHeight: 18,
  },
  emergencyCallBtn: {
    backgroundColor: RED_URGENT,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  emergencyCallBtnText: { color: "#fff", fontWeight: "800", fontSize: 12 },

  // ── Symptom input ──
  inputLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: TEXT_SECONDARY,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  symptomInputBox: {
    backgroundColor: SURFACE,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    minHeight: 110,
    marginBottom: 24,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  symptomTextArea: {
    flex: 1,
    fontSize: 15,
    color: TEXT_PRIMARY,
    lineHeight: 22,
    minHeight: 80,
  },
  micButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: PURPLE_DIM,
    justifyContent: "center",
    alignItems: "center",
  },

  quickLabel: {
    fontSize: 11,
    fontWeight: "900",
    color: TEXT_PRIMARY,
    textTransform: "uppercase",
    letterSpacing: 3,
    opacity: 0.5,
    marginBottom: 12,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 28,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
  },
  chipActive: { backgroundColor: PURPLE_DIM, borderColor: PURPLE },
  chipText: { fontSize: 13, color: TEXT_SECONDARY, fontWeight: "500" },
  chipTextActive: { color: PURPLE, fontWeight: "700" },

  // ── Buttons ──
  primaryButton: {
    backgroundColor: PURPLE,
    borderRadius: 18,
    height: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flex: 1,
  },
  primaryButtonDisabled: { opacity: 0.35 },
  primaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  secondaryButton: {
    backgroundColor: PURPLE_DIM,
    borderRadius: 18,
    height: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flex: 1,
    borderWidth: 1,
    borderColor: PURPLE,
  },
  secondaryButtonText: { color: PURPLE, fontSize: 16, fontWeight: "600" },

  disclaimer: {
    fontSize: 11,
    color: TEXT_MUTED,
    textAlign: "center",
    marginTop: 16,
    lineHeight: 16,
  },

  // ── Questions ──
  questionContainer: { flex: 1 },
  progressRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  progressLabel: { fontSize: 13, color: TEXT_SECONDARY, fontWeight: "500" },
  progressPercent: { fontSize: 13, color: PURPLE, fontWeight: "700" },
  progressTrack: {
    height: 4,
    backgroundColor: SURFACE,
    borderRadius: 2,
    marginBottom: 20,
  },
  progressFill: { height: 4, backgroundColor: PURPLE, borderRadius: 2 },

  emergencyInlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    marginBottom: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: RED_DIM,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.2)",
  },
  emergencyInlineText: { fontSize: 12, fontWeight: "700", color: RED_URGENT },

  questionText: {
    fontSize: 20,
    fontWeight: "800",
    color: TEXT_PRIMARY,
    marginBottom: 18,
    lineHeight: 28,
  },

  // Free-text answer input
  answerInputBox: {
    backgroundColor: SURFACE,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    minHeight: 120,
    marginBottom: 20,
  },
  answerTextInput: {
    fontSize: 15,
    color: TEXT_PRIMARY,
    lineHeight: 22,
    minHeight: 90,
  },

  questionNavButtons: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },

  // ── Processing ──
  processingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingHorizontal: 28,
    paddingVertical: 40,
  },
  processingTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: TEXT_PRIMARY,
    marginTop: 12,
  },
  processingSubtitle: {
    fontSize: 14,
    color: TEXT_SECONDARY,
    textAlign: "center",
    lineHeight: 20,
  },
  processingStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 16,
  },
  processingStepText: { fontSize: 15, color: TEXT_PRIMARY, fontWeight: "500" },

  // ── Results ──
  esiBadgeRow: {
    flexDirection: "row",
    gap: 12,
    marginHorizontal: 28,
    marginBottom: 16,
    marginTop: 8,
  },
  esiBadge: {
    flex: 1,
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    alignItems: "center",
  },
  esiBadgeLabel: {
    fontSize: 10,
    fontWeight: "900",
    color: TEXT_MUTED,
    letterSpacing: 2,
    marginBottom: 6,
  },
  esiBadgeValue: {
    fontSize: 28,
    fontWeight: "900",
    color: PURPLE,
  },
  esiBadgeDept: {
    fontSize: 13,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    textAlign: "center",
  },

  severityCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginHorizontal: 28,
    marginBottom: 28,
    marginTop: 8,
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
  },
  severityIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  severityLabel: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  severityCondition: {
    fontSize: 16,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    lineHeight: 22,
  },

  bodyText: {
    fontSize: 15,
    color: TEXT_SECONDARY,
    lineHeight: 24,
    paddingVertical: 18,
  },

  // Hospital rows
  hospitalRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    paddingVertical: 16,
  },
  hospitalRank: {
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: PURPLE_DIM,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 2,
  },
  hospitalRankText: { fontSize: 13, fontWeight: "800", color: PURPLE },
  hospitalName: {
    fontSize: 14,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    marginBottom: 6,
    lineHeight: 20,
  },
  hospitalMeta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
  },
  hospitalMetaText: {
    fontSize: 12,
    color: TEXT_MUTED,
    marginRight: 8,
  },

  emergencyResultBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: RED_URGENT,
    marginHorizontal: 28,
    marginBottom: 12,
    borderRadius: 18,
    height: 58,
  },
  emergencyResultBtnPulsing: {
    backgroundColor: "#DC2626",
    borderWidth: 2,
    borderColor: "#FCA5A5",
  },
  emergencyResultBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  startOverBtn: {
    marginHorizontal: 28,
    marginBottom: 20,
    borderRadius: 18,
    height: 58,
    borderWidth: 1,
    borderColor: RED_BORDER,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  startOverBtnText: { fontSize: 15, fontWeight: "700", color: "#F87171" },

  disclaimerBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginHorizontal: 28,
    padding: 16,
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },
  disclaimerText: { fontSize: 11, color: TEXT_MUTED, lineHeight: 16, flex: 1 },
});
