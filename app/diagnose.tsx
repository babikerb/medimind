import { MaterialIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../supabase";
import {
  submitSymptoms as apiSubmitSymptoms,
  submitTriage as apiSubmitTriage,
  TriageResponse,
} from "../services/api";

const { width } = Dimensions.get("window");

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
const AMBER = "#F59E0B";
const GREEN = "#10B981";

// ─── Types ────────────────────────────────────────────────────────────────────
type FlowStep = "symptom-input" | "loading-questions" | "questions" | "processing" | "results";
type Severity = "mild" | "moderate" | "urgent";

interface DiagnosisResult {
  severityLevel: Severity;
  esiLevel: number;
  identifiedDepartment: string;
  urgencySummary: string;
  call911: boolean;
  recommendedCareType?: string;
}

// ─── Severity config ──────────────────────────────────────────────────────────
const SEVERITY_CONFIG: Record<
  Severity,
  { color: string; label: string; icon: "check-circle" | "warning" | "error"; dimBg: string; borderColor: string }
> = {
  mild:     { color: GREEN,      label: "Mild",     icon: "check-circle", dimBg: "rgba(16,185,129,0.10)",  borderColor: "rgba(16,185,129,0.25)"  },
  moderate: { color: AMBER,      label: "Moderate", icon: "warning",      dimBg: "rgba(245,158,11,0.10)", borderColor: "rgba(245,158,11,0.25)" },
  urgent:   { color: RED_URGENT, label: "Urgent",   icon: "error",        dimBg: RED_DIM,                borderColor: "rgba(239,68,68,0.25)"  },
};

const esiToSeverity = (esi: number): Severity => {
  if (esi <= 2) return "urgent";
  if (esi === 3) return "moderate";
  return "mild";
};

// ─── Quick-answer chips ───────────────────────────────────────────────────────
function getQuickAnswers(question: string): string[] {
  const q = question.toLowerCase();
  if (/how long|duration|since|started|began/.test(q))
    return ["< 1 hour", "A few hours", "1–2 days", "3+ days"];
  if (/scale|rate|severe|1 to 10|intensity/.test(q))
    return ["1–3 (mild)", "4–6 (moderate)", "7–10 (severe)"];
  if (/fever|chills|sweat|temperature/.test(q))
    return ["No fever", "Low (99–100 °F)", "High (101–103 °F)", "104 °F+"];
  if (/medication|taken|tried|relieve|treatment/.test(q))
    return ["Yes, it helped", "Yes, no relief", "No medication taken"];
  if (/condition|allerg|existing|medical history|chronic/.test(q))
    return ["None", "Diabetes", "Heart condition", "Hypertension", "Asthma", "Other"];
  if (/sharp|dull|type|nature|character/.test(q))
    return ["Sharp", "Dull/aching", "Burning", "Throbbing"];
  if (/worsen|better|change|improve/.test(q))
    return ["Getting worse", "Staying the same", "Getting better"];
  return [];
}

// ─── Processing steps ─────────────────────────────────────────────────────────
const PROCESSING_STEPS = [
  "Sending to AI triage agent",
  "Scoring emergency severity",
  "Finding best hospitals near you",
];

// ─── Props ────────────────────────────────────────────────────────────────────
interface DiagnoseContentProps {
  onClose: () => void;
  initialSymptom?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function DiagnoseContent({ onClose, initialSymptom = "" }: DiagnoseContentProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [symptoms, setSymptoms] = useState(initialSymptom);
  const [flowStep, setFlowStep] = useState<FlowStep>("symptom-input");
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [triageResponse, setTriageResponse] = useState<TriageResponse | null>(null);
  const [processStep, setProcessStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // User context
  const [userId, setUserId] = useState<string>("");
  const [userLat, setUserLat] = useState<number>(0);
  const [userLon, setUserLon] = useState<number>(0);
  const [insuranceProvider, setInsuranceProvider] = useState<string | undefined>();
  const [patientProfile, setPatientProfile] = useState<Record<string, unknown> | undefined>();

  const totalQuestions = questions.length;
  const currentAnswerText = answers[currentQuestion] ?? "";
  const isLastQuestion = currentQuestion === totalQuestions - 1;

  // ── Load user context on mount ────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      // Get user ID
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
        // Load profile for insurance + patient info
        const { data: profile } = await supabase
          .from("profiles")
          .select("insurance_provider, dob, gender, language")
          .eq("id", user.id)
          .single();
        if (profile) {
          setInsuranceProvider(profile.insurance_provider || undefined);
          const age = profile.dob
            ? Math.floor((Date.now() - new Date(profile.dob).getTime()) / 31557600000)
            : undefined;
          setPatientProfile({
            ...(age ? { age } : {}),
            ...(profile.gender ? { gender: profile.gender } : {}),
          });
        }
      }

      // Get location
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({});
        setUserLat(loc.coords.latitude);
        setUserLon(loc.coords.longitude);
      }
    })();
  }, []);

  // ── Processing animation ───────────────────────────────────────────────────
  useEffect(() => {
    if (flowStep !== "processing") { setProcessStep(0); return; }
    const t1 = setTimeout(() => setProcessStep(1), 1200);
    const t2 = setTimeout(() => setProcessStep(2), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [flowStep]);

  // ── Flow ──────────────────────────────────────────────────────────────────
  const handleSubmitSymptoms = async () => {
    if (!symptoms.trim()) return;
    setError(null);
    setFlowStep("loading-questions");

    try {
      const res = await apiSubmitSymptoms({
        user_id: userId,
        symptom_input: symptoms,
        patient_profile: patientProfile as any,
      });

      const q = res.questions;
      if (!q || q.length === 0) {
        setError("No follow-up questions received. Please try again.");
        setFlowStep("symptom-input");
        return;
      }

      setQuestions(q);
      setAnswers(new Array(q.length).fill(""));
      setCurrentQuestion(0);
      setFlowStep("questions");
    } catch (e: any) {
      console.error("submitSymptoms error:", e);
      setError("Could not reach AI agent. Please check your connection and try again.");
      setFlowStep("symptom-input");
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
    if (currentQuestion > 0) {
      setCurrentQuestion((q) => q - 1);
    } else {
      setFlowStep("symptom-input");
    }
  };

  const runDiagnosis = async () => {
    setFlowStep("processing");
    setProcessStep(0);
    setError(null);

    try {
      const res = await apiSubmitTriage({
        user_id: userId,
        symptom_input: symptoms,
        questions,
        answers,
        patient_profile: patientProfile as any,
        user_latitude: userLat,
        user_longitude: userLon,
        insurance_provider: insuranceProvider,
      });

      setTriageResponse(res);

      const triage = res.triage;
      const call911 = triage.flags?.call_911 || triage.call_911 || false;

      setResult({
        esiLevel: triage.esi_level,
        identifiedDepartment: triage.identified_department,
        urgencySummary: triage.urgency_summary,
        call911,
        severityLevel: esiToSeverity(triage.esi_level),
        recommendedCareType: triage.recommended_care_type,
      });
      setFlowStep("results");
    } catch (e: any) {
      console.error("submitTriage error:", e);
      setError("Triage failed. Please try again.");
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
    setTriageResponse(null);
    setError(null);
  };

  const toggleSymptomChip = (chip: string) => {
    setSymptoms((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return chip;
      if (trimmed === chip) return "";
      if (trimmed.endsWith(`, ${chip}`)) return trimmed.slice(0, -(`, ${chip}`).length);
      return `${trimmed}, ${chip}`;
    });
  };

  const viewHospitals = () => {
    if (!triageResponse) return;
    router.push({
      pathname: "/results",
      params: {
        triageData: JSON.stringify(triageResponse),
        insuranceProvider: insuranceProvider || "",
        userId,
      },
    });
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>

      {/* ── Header ── */}
      <View style={styles.headerBar}>
        {(flowStep === "questions" || flowStep === "results") ? (
          <TouchableOpacity
            onPress={flowStep === "results" ? resetFlow : goPrevQuestion}
            style={styles.headerIconBtn}
            activeOpacity={0.7}
          >
            <MaterialIcons name="arrow-back" size={18} color={TEXT_SECONDARY} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 32 }} />
        )}

        <Text style={styles.headerTitle}>
          {flowStep === "results"          ? "Your Assessment"
           : flowStep === "processing"     ? "Analysing…"
           : flowStep === "loading-questions" ? "Preparing…"
           : flowStep === "questions"      ? `Question ${currentQuestion + 1} of ${totalQuestions}`
           : "Symptom Checker"}
        </Text>

        {(flowStep === "processing" || flowStep === "loading-questions") ? (
          <View style={{ width: 32 }} />
        ) : (
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
        )}
      </View>

      {/* ── Error banner ── */}
      {error && (
        <View style={styles.errorBanner}>
          <MaterialIcons name="error-outline" size={15} color={RED_URGENT} />
          <Text style={styles.errorBannerText}>{error}</Text>
          <TouchableOpacity onPress={() => setError(null)}>
            <MaterialIcons name="close" size={16} color={TEXT_MUTED} />
          </TouchableOpacity>
        </View>
      )}

      {/* ── RESULTS ── */}
      {flowStep === "results" && result && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollPad}>

          {/* ESI + department */}
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
                  <Text style={[styles.severityLabel, { color: cfg.color }]}>{cfg.label} Concern</Text>
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

          {/* Care type badge */}
          {result.recommendedCareType && (
            <View style={styles.careTypePill}>
              <MaterialIcons name="medical-services" size={14} color={PURPLE} />
              <Text style={styles.careTypePillText}>
                Recommended: {result.recommendedCareType.replace(/_/g, " ")}
              </Text>
            </View>
          )}

          {/* Emergency CTA */}
          <TouchableOpacity
            style={[styles.emergencyBtn, result.call911 && styles.emergencyBtnUrgent]}
            activeOpacity={0.85}
            onPress={() => Linking.openURL("tel:911")}
          >
            <MaterialIcons name="phone" size={18} color="#fff" />
            <Text style={styles.emergencyBtnText}>
              {result.call911 ? "CALL 911 NOW — Emergency Care Required" : "Call 911 if symptoms worsen"}
            </Text>
          </TouchableOpacity>

          {/* View recommended hospitals */}
          {triageResponse && triageResponse.recommended_hospitals.length > 0 && (
            <TouchableOpacity
              style={styles.hospitalBtn}
              activeOpacity={0.85}
              onPress={viewHospitals}
            >
              <MaterialIcons name="local-hospital" size={18} color="#fff" />
              <Text style={styles.hospitalBtnText}>
                View {triageResponse.recommended_hospitals.length} Recommended Hospitals
              </Text>
              <MaterialIcons name="chevron-right" size={20} color="#fff" />
            </TouchableOpacity>
          )}

          {/* Find nearby care (fallback) */}
          <TouchableOpacity
            style={styles.nearbyBtn}
            activeOpacity={0.85}
            onPress={() => { onClose(); router.replace("/(tabs)"); }}
          >
            <MaterialIcons name="explore" size={18} color={PURPLE} />
            <Text style={styles.nearbyBtnText}>Browse Nearby Facilities</Text>
            <MaterialIcons name="chevron-right" size={20} color={PURPLE} />
          </TouchableOpacity>

          {/* Disclaimer */}
          <View style={styles.disclaimerBox}>
            <MaterialIcons name="info-outline" size={13} color={TEXT_MUTED} />
            <Text style={styles.disclaimerText}>
              This is not a medical diagnosis. It is an AI-assisted assessment for informational purposes only. Always consult a qualified healthcare professional.
            </Text>
          </View>
        </ScrollView>
      )}

      {/* ── NON-RESULTS STEPS ── */}
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
                <TouchableOpacity
                  style={styles.emergencyCallBtn}
                  activeOpacity={0.85}
                  onPress={() => Linking.openURL("tel:911")}
                >
                  <Text style={styles.emergencyCallBtnText}>Call 911</Text>
                </TouchableOpacity>
              </View>

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
                {["Chest pain", "Headache", "Fever", "Nausea", "Dizziness", "Back pain", "Fatigue", "Shortness of breath"].map((chip) => {
                  const isActive = symptoms.includes(chip);
                  return (
                    <TouchableOpacity
                      key={chip}
                      style={[styles.chip, isActive && styles.chipActive]}
                      onPress={() => toggleSymptomChip(chip)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{chip}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, !symptoms.trim() && styles.primaryBtnDisabled]}
                onPress={handleSubmitSymptoms}
                disabled={!symptoms.trim()}
                activeOpacity={0.85}
              >
                <Text style={styles.primaryBtnText}>Analyse my symptoms</Text>
                <MaterialIcons name="arrow-forward" size={20} color="#fff" />
              </TouchableOpacity>

              <Text style={styles.disclaimer}>For guidance only — not a medical diagnosis.</Text>
            </ScrollView>
          )}

          {/* ── LOADING QUESTIONS ── */}
          {flowStep === "loading-questions" && (
            <View style={styles.processingContainer}>
              <View style={styles.processingSpinner}>
                <ActivityIndicator size="large" color={PURPLE} />
              </View>
              <Text style={styles.processingTitle}>Generating follow-up questions…</Text>
              <Text style={styles.processingSubtitle}>
                Our AI agent is analysing your symptoms to ask the right questions.
              </Text>
            </View>
          )}

          {/* ── QUESTIONS ── */}
          {flowStep === "questions" && questions.length > 0 && (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollPad}
              keyboardShouldPersistTaps="handled"
            >
              {/* Progress bar */}
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${((currentQuestion + 1) / totalQuestions) * 100}%` }]} />
              </View>

              {/* Symptom context pill */}
              <View style={styles.contextPill}>
                <MaterialIcons name="healing" size={12} color={PURPLE} />
                <Text style={styles.contextPillText} numberOfLines={1}>{symptoms}</Text>
              </View>

              <Text style={styles.questionText}>{questions[currentQuestion]}</Text>

              {/* Quick-answer chips */}
              {(() => {
                const chips = getQuickAnswers(questions[currentQuestion]);
                if (!chips.length) return null;
                return (
                  <View style={styles.quickAnswerRow}>
                    {chips.map((chip) => (
                      <TouchableOpacity
                        key={chip}
                        style={[styles.quickAnswerChip, currentAnswerText === chip && styles.quickAnswerChipActive]}
                        onPress={() => updateAnswer(chip)}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.quickAnswerText, currentAnswerText === chip && styles.quickAnswerTextActive]}>
                          {chip}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                );
              })()}

              <View style={styles.answerInputBox}>
                <TextInput
                  style={styles.answerTextInput}
                  placeholder={
                    getQuickAnswers(questions[currentQuestion]).length > 0
                      ? "Or describe in your own words…"
                      : "Type your answer here…"
                  }
                  placeholderTextColor={TEXT_MUTED}
                  multiline
                  value={currentAnswerText}
                  onChangeText={updateAnswer}
                  autoFocus={getQuickAnswers(questions[currentQuestion]).length === 0}
                />
              </View>

              <View style={styles.navBtns}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={goPrevQuestion} activeOpacity={0.85}>
                  <MaterialIcons name="arrow-back" size={18} color={PURPLE} />
                  <Text style={styles.secondaryBtnText}>{currentQuestion === 0 ? "Edit" : "Back"}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.primaryBtn,
                    !currentAnswerText.trim() && styles.primaryBtnDisabled,
                  ]}
                  onPress={goNextQuestion}
                  disabled={!currentAnswerText.trim()}
                  activeOpacity={0.85}
                >
                  <Text style={styles.primaryBtnText}>{isLastQuestion ? "Get assessment" : "Next"}</Text>
                  <MaterialIcons name={isLastQuestion ? "check" : "arrow-forward"} size={20} color="#fff" />
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}

          {/* ── PROCESSING ── */}
          {flowStep === "processing" && (
            <View style={styles.processingContainer}>
              <View style={styles.processingSpinner}>
                <MaterialIcons name="favorite" size={32} color={PURPLE} />
              </View>
              <Text style={styles.processingTitle}>Analysing your symptoms…</Text>
              <Text style={styles.processingSubtitle}>
                AI agents are scoring urgency and finding the best hospitals near you.
              </Text>
              <View style={styles.card}>
                {PROCESSING_STEPS.map((step, i) => {
                  const done = i < processStep;
                  const active = i === processStep;
                  return (
                    <View key={step}>
                      <View style={styles.processingStep}>
                        <MaterialIcons
                          name={done ? "check-circle" : active ? "radio-button-on" : "radio-button-unchecked"}
                          size={16}
                          color={done ? GREEN : active ? PURPLE : BORDER}
                        />
                        <Text style={[styles.processingStepText, !done && !active && { color: TEXT_MUTED }]}>
                          {step}
                        </Text>
                      </View>
                      {i < PROCESSING_STEPS.length - 1 && <View style={styles.divider} />}
                    </View>
                  );
                })}
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

// ─── Default export ───────────────────────────────────────────────────────────
export default function DiagnoseScreen() {
  const router = useRouter();
  return <DiagnoseContent onClose={() => router.back()} />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: APP_BG },

  headerBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerTitle: { fontSize: 15, fontWeight: "800", color: TEXT_PRIMARY, letterSpacing: 0.2 },
  headerIconBtn: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
    justifyContent: "center", alignItems: "center",
  },

  scrollPad: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 60 },

  sectionLabel: {
    color: TEXT_PRIMARY, fontSize: 10, fontWeight: "900",
    letterSpacing: 2.5, opacity: 0.45, marginBottom: 10, marginTop: 4,
  },

  card: {
    backgroundColor: SURFACE, borderRadius: 18, borderWidth: 1,
    borderColor: BORDER, paddingHorizontal: 18, paddingVertical: 4, marginBottom: 20,
  },

  divider: { height: 1, backgroundColor: BORDER },

  // Error banner
  errorBanner: {
    flexDirection: "row", alignItems: "center", backgroundColor: RED_DIM,
    paddingHorizontal: 16, paddingVertical: 10, gap: 8,
    borderBottomWidth: 1, borderBottomColor: "rgba(239,68,68,0.25)",
  },
  errorBannerText: { color: RED_URGENT, fontSize: 12, fontWeight: "600", flex: 1, lineHeight: 17 },

  // Emergency banner
  emergencyBanner: {
    flexDirection: "row", alignItems: "center", backgroundColor: RED_DIM,
    borderRadius: 14, padding: 12, gap: 8, marginBottom: 18,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.25)",
  },
  emergencyBannerText: { color: RED_URGENT, fontSize: 12, fontWeight: "600", flex: 1, lineHeight: 17 },
  emergencyCallBtn: { backgroundColor: RED_URGENT, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  emergencyCallBtnText: { color: "#fff", fontWeight: "800", fontSize: 11 },

  // Symptom input
  inputLabel: {
    fontSize: 11, fontWeight: "700", color: TEXT_SECONDARY,
    letterSpacing: 1, textTransform: "uppercase", marginBottom: 8,
  },
  symptomInputBox: {
    backgroundColor: SURFACE, borderRadius: 18, borderWidth: 1, borderColor: BORDER,
    padding: 14, minHeight: 90, marginBottom: 18,
    flexDirection: "row", alignItems: "flex-start", gap: 10,
  },
  symptomTextArea: { flex: 1, fontSize: 15, color: TEXT_PRIMARY, lineHeight: 22, minHeight: 60 },
  micBtn: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: PURPLE_DIM, justifyContent: "center", alignItems: "center",
  },

  quickLabel: {
    fontSize: 10, fontWeight: "900", color: TEXT_PRIMARY,
    textTransform: "uppercase", letterSpacing: 2.5, opacity: 0.45, marginBottom: 10,
  },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 24 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 100,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
  },
  chipActive: { backgroundColor: PURPLE_DIM, borderColor: PURPLE },
  chipText: { fontSize: 12, color: TEXT_SECONDARY, fontWeight: "500" },
  chipTextActive: { color: PURPLE, fontWeight: "700" },

  // Buttons
  primaryBtn: {
    backgroundColor: PURPLE, borderRadius: 16, height: 54,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, flex: 1,
  },
  primaryBtnDisabled: { opacity: 0.35 },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  secondaryBtn: {
    backgroundColor: PURPLE_DIM, borderRadius: 16, height: 54,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, flex: 1, borderWidth: 1, borderColor: PURPLE,
  },
  secondaryBtnText: { color: PURPLE, fontSize: 15, fontWeight: "600" },

  disclaimer: { fontSize: 11, color: TEXT_MUTED, textAlign: "center", marginTop: 14, lineHeight: 15 },

  // Questions
  progressTrack: { height: 3, backgroundColor: SURFACE, borderRadius: 2, marginBottom: 16 },
  progressFill: { height: 3, backgroundColor: PURPLE, borderRadius: 2 },

  contextPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: PURPLE_DIM, borderRadius: 100,
    paddingHorizontal: 10, paddingVertical: 5,
    alignSelf: "flex-start", marginBottom: 16,
    borderWidth: 1, borderColor: "rgba(124,58,237,0.25)",
  },
  contextPillText: { fontSize: 11, color: PURPLE, fontWeight: "600", maxWidth: width * 0.7 },

  questionText: { fontSize: 20, fontWeight: "800", color: TEXT_PRIMARY, marginBottom: 16, lineHeight: 28 },

  quickAnswerRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  quickAnswerChip: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 100,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
  },
  quickAnswerChipActive: { backgroundColor: PURPLE_DIM, borderColor: PURPLE },
  quickAnswerText: { fontSize: 13, color: TEXT_SECONDARY, fontWeight: "500" },
  quickAnswerTextActive: { color: PURPLE, fontWeight: "700" },

  answerInputBox: {
    backgroundColor: SURFACE, borderRadius: 18, borderWidth: 1, borderColor: BORDER,
    padding: 14, minHeight: 80, marginBottom: 14,
  },
  answerTextInput: { fontSize: 15, color: TEXT_PRIMARY, lineHeight: 22, minHeight: 52 },
  navBtns: { flexDirection: "row", gap: 8, marginTop: 6 },

  // Processing
  processingContainer: {
    flex: 1, alignItems: "center", justifyContent: "center",
    gap: 12, paddingHorizontal: 24,
  },
  processingSpinner: {
    width: 64, height: 64, borderRadius: 20,
    backgroundColor: PURPLE_DIM, justifyContent: "center", alignItems: "center",
    marginBottom: 4,
  },
  processingTitle: { fontSize: 19, fontWeight: "800", color: TEXT_PRIMARY },
  processingSubtitle: { fontSize: 13, color: TEXT_SECONDARY, textAlign: "center", lineHeight: 19 },
  processingStep: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 15 },
  processingStepText: { fontSize: 14, color: TEXT_PRIMARY, fontWeight: "500" },

  // Results
  esiBadgeRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  esiBadge: {
    flex: 1, backgroundColor: SURFACE, borderRadius: 14, borderWidth: 1,
    borderColor: BORDER, padding: 12, alignItems: "center",
  },
  esiBadgeLabel: { fontSize: 9, fontWeight: "900", color: TEXT_MUTED, letterSpacing: 2, marginBottom: 5 },
  esiBadgeValue: { fontSize: 26, fontWeight: "900", color: PURPLE },
  esiBadgeDept: { fontSize: 12, fontWeight: "700", color: TEXT_PRIMARY, textAlign: "center" },

  severityCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginBottom: 20, padding: 16, borderRadius: 18, borderWidth: 1,
  },
  severityIconWrap: { width: 44, height: 44, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  severityLabel: { fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 3 },
  severityCondition: { fontSize: 15, fontWeight: "700", color: TEXT_PRIMARY, lineHeight: 20 },

  bodyText: { fontSize: 14, color: TEXT_SECONDARY, lineHeight: 22, paddingVertical: 16 },

  careTypePill: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: PURPLE_DIM, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    marginBottom: 16, borderWidth: 1, borderColor: "rgba(124,58,237,0.25)",
  },
  careTypePillText: { color: PURPLE, fontSize: 13, fontWeight: "600", textTransform: "capitalize" },

  emergencyBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: RED_URGENT, marginBottom: 10, borderRadius: 16, height: 54,
  },
  emergencyBtnUrgent: { backgroundColor: "#DC2626", borderWidth: 2, borderColor: "#FCA5A5" },
  emergencyBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },

  hospitalBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, backgroundColor: PURPLE, borderRadius: 16, height: 54,
    marginBottom: 10,
  },
  hospitalBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  nearbyBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, backgroundColor: PURPLE_DIM, borderRadius: 16, height: 54,
    marginBottom: 12, borderWidth: 1, borderColor: "rgba(124,58,237,0.35)",
  },
  nearbyBtnText: { color: PURPLE, fontSize: 15, fontWeight: "700" },

  disclaimerBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 7,
    padding: 14, backgroundColor: SURFACE, borderRadius: 14,
    borderWidth: 1, borderColor: BORDER, marginBottom: 8,
  },
  disclaimerText: { fontSize: 10, color: TEXT_MUTED, lineHeight: 15, flex: 1 },
});
