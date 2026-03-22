import { MaterialIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import React, { useState } from "react";
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

const { width, height } = Dimensions.get("window");

// ─── Design tokens (matched to Profile screen) ────────────────────────────────
const APP_BG = "#0F172A"; // same as Profile container
const SURFACE = "#1E293B"; // same as Profile card bg
const BORDER = "#334155"; // same as Profile card border
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

// ─── Types ────────────────────────────────────────────────────────────────────

type FlowStep = "symptom-input" | "questions" | "processing" | "results";
type Severity = "mild" | "moderate" | "urgent";

interface FollowUpQuestion {
  id: number;
  text: string;
  options: string[];
  allowFreeText?: boolean;
}

interface DiagnosisResult {
  severityLevel: Severity;
  likelyCondition: string;
  explanation: string;
  nextSteps: string[];
  disclaimer: string;
}

// ─── Generic Questions ────────────────────────────────────────────────────────

const FOLLOW_UP_QUESTIONS: FollowUpQuestion[] = [
  {
    id: 1,
    text: "How long have you been experiencing this?",
    options: [
      "Less than 1 hour",
      "A few hours",
      "1–2 days",
      "Longer than 2 days",
    ],
  },
  {
    id: 2,
    text: "How would you rate the intensity?",
    options: [
      "Mild – barely noticeable",
      "Moderate – distracting",
      "Severe – hard to function",
      "Unbearable",
    ],
  },
  {
    id: 3,
    text: "Are you experiencing any of these alongside it?",
    options: [
      "Shortness of breath",
      "Nausea or vomiting",
      "Dizziness",
      "None of these",
    ],
    allowFreeText: true,
  },
  {
    id: 4,
    text: "Have you had this before?",
    options: ["Never", "Once or twice", "Occasionally", "Frequently"],
  },
  {
    id: 5,
    text: "Any relevant medical history?",
    options: [
      "Heart condition",
      "Diabetes",
      "Respiratory issues",
      "None / Prefer not to say",
    ],
    allowFreeText: true,
  },
];

// ─── Mock Diagnosis ───────────────────────────────────────────────────────────

const MOCK_DIAGNOSIS: DiagnosisResult = {
  severityLevel: "moderate",
  likelyCondition: "Possible Musculoskeletal or Cardiac Stress",
  explanation:
    "Based on your responses, your symptoms are consistent with either musculoskeletal tension (such as a strained chest muscle) or early signs of cardiac stress. The duration and intensity you described suggest this warrants prompt attention rather than an emergency room visit, but you should not ignore it.",
  nextSteps: [
    "Rest and avoid strenuous activity for the next few hours.",
    "Monitor for worsening symptoms such as spreading pain, sweating, or arm numbness.",
    "Book an appointment with your GP or visit an urgent care clinic today.",
    "If symptoms worsen suddenly, call 911 immediately.",
  ],
  disclaimer:
    "This is not a medical diagnosis. It is an AI-generated assessment for informational purposes only. Always consult a qualified healthcare professional before making any health decisions.",
};

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

// ─── Reusable sub-components ──────────────────────────────────────────────────

const SectionHeader = ({ title }: { title: string }) => (
  <Text style={styles.sectionHeader}>{title}</Text>
);

// ─── Component ────────────────────────────────────────────────────────────────

export default function DiagnoseScreen() {
  const navigation = useNavigation();

  const [symptoms, setSymptoms] = useState("");
  const [flowStep, setFlowStep] = useState<FlowStep>("symptom-input");
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [freeTextAnswers, setFreeTextAnswers] = useState<
    Record<number, string>
  >({});
  const [result, setResult] = useState<DiagnosisResult | null>(null);

  const totalQuestions = FOLLOW_UP_QUESTIONS.length;
  const activeQuestion = FOLLOW_UP_QUESTIONS[currentQuestion];
  const currentAnswer = answers[activeQuestion?.id];
  const isLastQuestion = currentQuestion === totalQuestions - 1;

  // ── Flow ──────────────────────────────────────────────────────────────────

  const goBack = () => navigation.goBack();

  const submitSymptoms = () => {
    if (!symptoms.trim()) return;
    setFlowStep("questions");
    setCurrentQuestion(0);
  };

  const selectAnswer = (questionId: number, answer: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: answer }));
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

  const runDiagnosis = () => {
    setFlowStep("processing");
    setTimeout(() => {
      setResult(MOCK_DIAGNOSIS);
      setFlowStep("results");
    }, 2500);
  };

  const resetFlow = () => {
    setFlowStep("symptom-input");
    setSymptoms("");
    setAnswers({});
    setFreeTextAnswers({});
    setCurrentQuestion(0);
    setResult(null);
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <StatusBar
        style="light"
        backgroundColor="transparent"
        translucent={true}
      />

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
                <View
                  style={[
                    styles.severityIconWrap,
                    { backgroundColor: cfg.dimBg },
                  ]}
                >
                  <MaterialIcons name={cfg.icon} size={26} color={cfg.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.severityLabel, { color: cfg.color }]}>
                    {cfg.label} Concern
                  </Text>
                  <Text style={styles.severityCondition}>
                    {result.likelyCondition}
                  </Text>
                </View>
              </View>
            );
          })()}

          {/* Explanation */}
          <SectionHeader title="WHAT THIS MAY MEAN" />
          <View style={styles.card}>
            <Text style={styles.bodyText}>{result.explanation}</Text>
          </View>

          {/* Next steps */}
          <SectionHeader title="RECOMMENDED NEXT STEPS" />
          <View style={styles.card}>
            {result.nextSteps.map((step, i) => (
              <View key={i}>
                <View style={styles.stepRow}>
                  <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>{i + 1}</Text>
                  </View>
                  <Text style={styles.stepText}>{step}</Text>
                </View>
                {i < result.nextSteps.length - 1 && (
                  <View style={styles.divider} />
                )}
              </View>
            ))}
          </View>

          {/* Emergency CTA */}
          <TouchableOpacity
            style={styles.emergencyResultBtn}
            activeOpacity={0.85}
          >
            <MaterialIcons name="phone" size={18} color="#fff" />
            <Text style={styles.emergencyResultBtnText}>
              Call 911 if symptoms worsen
            </Text>
          </TouchableOpacity>

          {/* Start over */}
          <TouchableOpacity
            style={styles.startOverBtn}
            onPress={resetFlow}
            activeOpacity={0.8}
          >
            <Text style={styles.startOverBtnText}>
              Check different symptoms
            </Text>
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
              <MaterialIcons
                name="arrow-back"
                size={22}
                color={TEXT_SECONDARY}
              />
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
                <MaterialIcons
                  name="error-outline"
                  size={16}
                  color={RED_URGENT}
                />
                <Text style={styles.emergencyBannerText}>
                  If this is life-threatening, please call 911
                </Text>
                <TouchableOpacity
                  style={styles.emergencyCallBtn}
                  activeOpacity={0.85}
                >
                  <Text style={styles.emergencyCallBtnText}>Call 911</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.inputLabel}>
                Describe your symptoms in detail
              </Text>
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
                    style={[
                      styles.chip,
                      symptoms === chip && styles.chipActive,
                    ]}
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
                  !symptoms.trim() && styles.primaryButtonDisabled,
                ]}
                onPress={submitSymptoms}
                disabled={!symptoms.trim()}
                activeOpacity={0.85}
              >
                <Text style={styles.primaryButtonText}>Check my symptoms</Text>
                <MaterialIcons name="arrow-forward" size={20} color="#fff" />
              </TouchableOpacity>

              <Text style={styles.disclaimer}>
                This assessment is for guidance only and is not a medical
                diagnosis.
              </Text>
            </ScrollView>
          )}

          {/* ── QUESTIONS ── */}
          {flowStep === "questions" && activeQuestion && (
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
                    {Math.round(((currentQuestion + 1) / totalQuestions) * 100)}
                    %
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
                <TouchableOpacity
                  style={styles.emergencyInlineBtn}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="phone" size={13} color={RED_URGENT} />
                  <Text style={styles.emergencyInlineText}>
                    Emergency? Call 911
                  </Text>
                </TouchableOpacity>

                <Text style={styles.questionText}>{activeQuestion.text}</Text>

                {/* Option cards */}
                <View style={styles.card}>
                  {activeQuestion.options.map((option, idx) => (
                    <View key={option}>
                      <TouchableOpacity
                        style={styles.optionRow}
                        onPress={() => selectAnswer(activeQuestion.id, option)}
                        activeOpacity={0.75}
                      >
                        <View
                          style={[
                            styles.optionRadio,
                            currentAnswer === option &&
                              styles.optionRadioSelected,
                          ]}
                        >
                          {currentAnswer === option && (
                            <View style={styles.optionRadioDot} />
                          )}
                        </View>
                        <Text
                          style={[
                            styles.optionText,
                            currentAnswer === option &&
                              styles.optionTextSelected,
                          ]}
                        >
                          {option}
                        </Text>
                      </TouchableOpacity>
                      {idx < activeQuestion.options.length - 1 && (
                        <View style={styles.divider} />
                      )}
                    </View>
                  ))}
                </View>

                {activeQuestion.allowFreeText && (
                  <View style={styles.freeTextBox}>
                    <TextInput
                      style={styles.freeTextInput}
                      placeholder="Or describe in your own words…"
                      placeholderTextColor={TEXT_MUTED}
                      value={freeTextAnswers[activeQuestion.id] || ""}
                      onChangeText={(t) =>
                        setFreeTextAnswers((prev) => ({
                          ...prev,
                          [activeQuestion.id]: t,
                        }))
                      }
                      multiline
                    />
                  </View>
                )}

                {/* Navigation buttons */}
                <View style={styles.questionNavButtons}>
                  {currentQuestion > 0 && (
                    <TouchableOpacity
                      style={styles.secondaryButton}
                      onPress={goPrevQuestion}
                      activeOpacity={0.85}
                    >
                      <MaterialIcons
                        name="arrow-back"
                        size={20}
                        color={PURPLE}
                      />
                      <Text style={styles.secondaryButtonText}>Back</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[
                      styles.primaryButton,
                      !currentAnswer && styles.primaryButtonDisabled,
                      currentQuestion === 0 && { flex: 1 },
                    ]}
                    onPress={goNextQuestion}
                    disabled={!currentAnswer}
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
              <Text style={styles.processingTitle}>
                Analysing your symptoms…
              </Text>
              <Text style={styles.processingSubtitle}>
                Reviewing your responses and generating your assessment.
              </Text>
              <View style={styles.card}>
                {[
                  "Reading your responses",
                  "Running symptom analysis",
                  "Generating assessment",
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
                This assessment is for guidance only and is not a medical
                diagnosis.
              </Text>
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </View>
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

  // Top nav — mirrors Profile topNav
  topNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 28,
    paddingTop: Platform.OS === "android" ? 40 : 56,
    height: Platform.OS === "android" ? 88 : 100,
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

  // ── Section header — mirrors Profile sectionHeader ──
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

  // ── Card — mirrors Profile card ──
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

  // Option rows inside a single card — mirrors Profile InfoCard
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 18,
    gap: 14,
  },
  optionRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: BORDER,
    justifyContent: "center",
    alignItems: "center",
  },
  optionRadioSelected: { borderColor: PURPLE },
  optionRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: PURPLE,
  },
  optionText: {
    fontSize: 15,
    color: TEXT_SECONDARY,
    fontWeight: "500",
    flex: 1,
  },
  optionTextSelected: { color: TEXT_PRIMARY, fontWeight: "700" },

  freeTextBox: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    marginBottom: 12,
    marginHorizontal: 28,
  },
  freeTextInput: {
    fontSize: 14,
    color: TEXT_PRIMARY,
    minHeight: 60,
    lineHeight: 20,
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

  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    paddingVertical: 16,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: PURPLE_DIM,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 1,
  },
  stepNumberText: { fontSize: 13, fontWeight: "800", color: PURPLE },
  stepText: { fontSize: 14, color: TEXT_SECONDARY, lineHeight: 22, flex: 1 },

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
