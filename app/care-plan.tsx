import { MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CarePlan,
  getFollowUpCare,
  subscribeAlert,
  getAlertStatus,
  AlertStatusResponse,
} from "../services/api";

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
const BLUE = "#3B82F6";

// ─── Component ────────────────────────────────────────────────────────────────
export default function CarePlanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    triageData: string;
    hospitalName: string;
    userId: string;
    sessionId: string;
    hospitalId: string;
    department: string;
  }>();

  const [carePlan, setCarePlan] = useState<CarePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Alert state
  const [alertSubscribed, setAlertSubscribed] = useState(false);
  const [alertStatus, setAlertStatus] = useState<AlertStatusResponse | null>(null);
  const [alertLoading, setAlertLoading] = useState(false);

  const triage = JSON.parse(params.triageData || "{}");

  // ── Load care plan ──────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await getFollowUpCare({
          user_id: params.userId,
          triage,
          hospital_name: params.hospitalName,
        });
        setCarePlan(res.care_plan);
      } catch (e: any) {
        console.error("getFollowUpCare error:", e);
        setError("Could not load care plan. Please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Poll alert status ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!alertSubscribed || !params.sessionId) return;
    const interval = setInterval(async () => {
      try {
        const status = await getAlertStatus(params.sessionId);
        setAlertStatus(status);
      } catch (e) {
        console.error("getAlertStatus error:", e);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [alertSubscribed, params.sessionId]);

  // ── Subscribe to alerts ─────────────────────────────────────────────────────
  const handleSubscribeAlert = async () => {
    setAlertLoading(true);
    try {
      await subscribeAlert({
        user_id: params.userId,
        session_id: params.sessionId,
        hospital_id: params.hospitalId,
        department: params.department,
      });
      setAlertSubscribed(true);
      // Fetch initial status
      const status = await getAlertStatus(params.sessionId);
      setAlertStatus(status);
    } catch (e: any) {
      console.error("subscribeAlert error:", e);
    } finally {
      setAlertLoading(false);
    }
  };

  // ── Section component ───────────────────────────────────────────────────────
  const PlanSection = ({
    icon,
    title,
    items,
    color = PURPLE,
  }: {
    icon: keyof typeof MaterialIcons.glyphMap;
    title: string;
    items: string[];
    color?: string;
  }) => {
    if (!items || items.length === 0) return null;
    return (
      <View style={s.planSection}>
        <View style={s.planSectionHeader}>
          <View style={[s.planIconWrap, { backgroundColor: `${color}18` }]}>
            <MaterialIcons name={icon} size={18} color={color} />
          </View>
          <Text style={s.planSectionTitle}>{title}</Text>
        </View>
        {items.map((item, i) => (
          <View key={i} style={s.planItem}>
            <View style={[s.planBullet, { backgroundColor: color }]} />
            <Text style={s.planItemText}>{item}</Text>
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={[s.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* ── Header ── */}
      <View style={s.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerIconBtn} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={18} color={TEXT_SECONDARY} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Follow-Up Care Plan</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading && (
        <View style={s.loadingContainer}>
          <View style={s.loadingSpinner}>
            <ActivityIndicator size="large" color={PURPLE} />
          </View>
          <Text style={s.loadingTitle}>Generating your care plan…</Text>
          <Text style={s.loadingSubtitle}>
            Our AI agent is creating personalised follow-up recommendations based on your triage.
          </Text>
        </View>
      )}

      {error && !loading && (
        <View style={s.loadingContainer}>
          <MaterialIcons name="error-outline" size={48} color={RED_URGENT} />
          <Text style={s.loadingTitle}>{error}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => router.back()}>
            <Text style={s.retryBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {carePlan && !loading && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollPad}>

          {/* Hospital context */}
          <View style={s.contextCard}>
            <MaterialIcons name="local-hospital" size={18} color={PURPLE} />
            <View style={{ flex: 1 }}>
              <Text style={s.contextHospital}>{params.hospitalName}</Text>
              <Text style={s.contextMeta}>
                ESI {triage.esi_level} · {triage.identified_department}
              </Text>
            </View>
          </View>

          {/* Alert subscription */}
          <View style={s.alertCard}>
            <View style={s.alertHeader}>
              <MaterialIcons name="notifications-active" size={18} color={AMBER} />
              <Text style={s.alertTitle}>Wait Time Alerts</Text>
            </View>
            {alertSubscribed ? (
              <View style={s.alertActive}>
                <MaterialIcons name="check-circle" size={16} color={GREEN} />
                <Text style={s.alertActiveText}>Monitoring wait times</Text>
                {alertStatus && alertStatus.estimated_wait_minutes !== undefined && (
                  <View style={s.alertWaitBadge}>
                    <Text style={s.alertWaitText}>
                      {alertStatus.estimated_wait_minutes} min
                    </Text>
                  </View>
                )}
              </View>
            ) : (
              <TouchableOpacity
                style={s.alertBtn}
                onPress={handleSubscribeAlert}
                disabled={alertLoading}
                activeOpacity={0.85}
              >
                {alertLoading ? (
                  <ActivityIndicator size="small" color={AMBER} />
                ) : (
                  <>
                    <MaterialIcons name="add-alert" size={16} color={AMBER} />
                    <Text style={s.alertBtnText}>Get notified when wait time changes</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* Timeline */}
          {carePlan.follow_up_timeline && (
            <View style={s.timelineCard}>
              <View style={s.timelineIcon}>
                <MaterialIcons name="event" size={20} color={PURPLE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.timelineLabel}>FOLLOW-UP TIMELINE</Text>
                <Text style={s.timelineText}>{carePlan.follow_up_timeline}</Text>
              </View>
            </View>
          )}

          {/* Plan sections */}
          <PlanSection
            icon="person-search"
            title="Specialist Referrals"
            items={carePlan.specialist_referrals}
            color={PURPLE}
          />

          <PlanSection
            icon="medication"
            title="Medications to Discuss"
            items={carePlan.medications_to_discuss}
            color={BLUE}
          />

          <PlanSection
            icon="warning"
            title="Warning Signs — Return to ER"
            items={carePlan.warning_signs}
            color={RED_URGENT}
          />

          <PlanSection
            icon="home"
            title="Home Care Instructions"
            items={carePlan.home_care_instructions}
            color={GREEN}
          />

          <PlanSection
            icon="fitness-center"
            title="Lifestyle Recommendations"
            items={carePlan.lifestyle_recommendations}
            color={AMBER}
          />

          {/* Disclaimer */}
          <View style={s.disclaimerBox}>
            <MaterialIcons name="info-outline" size={13} color={TEXT_MUTED} />
            <Text style={s.disclaimerText}>
              This care plan is AI-generated for informational purposes only. Always follow the specific instructions given by your treating physician.
            </Text>
          </View>

          {/* Done */}
          <TouchableOpacity
            style={s.doneBtn}
            activeOpacity={0.85}
            onPress={() => router.replace("/(tabs)")}
          >
            <MaterialIcons name="home" size={18} color="#fff" />
            <Text style={s.doneBtnText}>Return Home</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
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

  scrollPad: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 60 },

  // Loading
  loadingContainer: {
    flex: 1, alignItems: "center", justifyContent: "center",
    gap: 12, paddingHorizontal: 24,
  },
  loadingSpinner: {
    width: 64, height: 64, borderRadius: 20,
    backgroundColor: PURPLE_DIM, justifyContent: "center", alignItems: "center",
    marginBottom: 4,
  },
  loadingTitle: { fontSize: 19, fontWeight: "800", color: TEXT_PRIMARY, textAlign: "center" },
  loadingSubtitle: { fontSize: 13, color: TEXT_SECONDARY, textAlign: "center", lineHeight: 19 },

  retryBtn: {
    backgroundColor: PURPLE, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, marginTop: 12,
  },
  retryBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },

  // Context
  contextCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: SURFACE, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: BORDER, marginBottom: 14,
  },
  contextHospital: { fontSize: 14, fontWeight: "700", color: TEXT_PRIMARY },
  contextMeta: { fontSize: 11, color: TEXT_SECONDARY, marginTop: 2 },

  // Alert
  alertCard: {
    backgroundColor: SURFACE, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: BORDER, marginBottom: 16,
  },
  alertHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  alertTitle: { fontSize: 13, fontWeight: "700", color: TEXT_PRIMARY },
  alertActive: { flexDirection: "row", alignItems: "center", gap: 8 },
  alertActiveText: { fontSize: 12, color: GREEN, fontWeight: "600", flex: 1 },
  alertWaitBadge: {
    backgroundColor: "rgba(245,158,11,0.15)", borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  alertWaitText: { fontSize: 12, fontWeight: "700", color: AMBER },
  alertBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(245,158,11,0.10)", borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 14,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.25)",
  },
  alertBtnText: { fontSize: 12, color: AMBER, fontWeight: "600" },

  // Timeline
  timelineCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: PURPLE_DIM, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: "rgba(124,58,237,0.25)", marginBottom: 20,
  },
  timelineIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: "rgba(124,58,237,0.20)", justifyContent: "center", alignItems: "center",
  },
  timelineLabel: {
    fontSize: 9, fontWeight: "900", color: TEXT_MUTED,
    letterSpacing: 2, marginBottom: 4,
  },
  timelineText: { fontSize: 14, fontWeight: "700", color: TEXT_PRIMARY, lineHeight: 20 },

  // Plan sections
  planSection: { marginBottom: 20 },
  planSectionHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  planIconWrap: {
    width: 32, height: 32, borderRadius: 8,
    justifyContent: "center", alignItems: "center",
  },
  planSectionTitle: { fontSize: 14, fontWeight: "700", color: TEXT_PRIMARY },
  planItem: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    backgroundColor: SURFACE, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: BORDER, marginBottom: 6,
  },
  planBullet: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  planItemText: { fontSize: 13, color: TEXT_SECONDARY, lineHeight: 19, flex: 1 },

  // Disclaimer
  disclaimerBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 7,
    padding: 14, backgroundColor: SURFACE, borderRadius: 14,
    borderWidth: 1, borderColor: BORDER, marginBottom: 16,
  },
  disclaimerText: { fontSize: 10, color: TEXT_MUTED, lineHeight: 15, flex: 1 },

  // Done button
  doneBtn: {
    backgroundColor: PURPLE, borderRadius: 16, height: 54,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, marginBottom: 20,
  },
  doneBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
