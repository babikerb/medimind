import { MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BarChart } from "react-native-chart-kit";
import {
  RecommendedHospital,
  TriageResponse,
  generateReasonString,
} from "../services/api";

const { width } = Dimensions.get("window");

// ─── Design tokens (matches existing app) ────────────────────────────────────
const APP_BG = "#0F172A";
const SURFACE = "#1E293B";
const SURFACE_LIGHT = "#273549";
const BORDER = "#334155";
const PURPLE = "#7C3AED";
const PURPLE_DIM = "rgba(124,58,237,0.12)";
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_SECONDARY = "#94A3B8";
const TEXT_MUTED = "#64748B";
const RED_URGENT = "#EF4444";
const AMBER = "#F59E0B";
const GREEN = "#10B981";
const BLUE = "#3B82F6";

// ─── Score factor colors ──────────────────────────────────────────────────────
const FACTOR_COLORS = {
  availability: PURPLE,
  waitTime: AMBER,
  distance: BLUE,
  insurance: GREEN,
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function ResultsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    triageData: string;
    insuranceProvider: string;
    userId: string;
  }>();

  const triageResponse: TriageResponse = useMemo(
    () => JSON.parse(params.triageData || "{}"),
    [params.triageData]
  );

  const { triage, recommended_hospitals, session_id } = triageResponse;
  const [selectedIdx, setSelectedIdx] = useState(0);
  const selectedHospital = recommended_hospitals[selectedIdx];

  const esiLevel = triage?.esi_level ?? 3;

  // ── Chart data ──────────────────────────────────────────────────────────────
  const waitChartData = {
    labels: recommended_hospitals.map((h) =>
      h.name.length > 12 ? h.name.slice(0, 11) + "…" : h.name
    ),
    datasets: [
      {
        data: recommended_hospitals.map((h) => h.estimated_wait_minutes),
      },
    ],
  };

  const chartConfig = {
    backgroundColor: SURFACE,
    backgroundGradientFrom: SURFACE,
    backgroundGradientTo: SURFACE,
    decimalCount: 0,
    color: (opacity = 1) => `rgba(124, 58, 237, ${opacity})`,
    labelColor: () => TEXT_SECONDARY,
    barPercentage: 0.6,
    propsForLabels: { fontSize: 10 },
  };

  // ── Score breakdown ─────────────────────────────────────────────────────────
  const getScoreBreakdown = (h: RecommendedHospital) => {
    const deptScore = h.department_match ? 100 : 20;
    const bedScore = Math.min(100, (h.available_beds / 50) * 100);
    const availability = deptScore * 0.6 + bedScore * 0.4;

    const maxWait = esiLevel <= 2 ? 30 : esiLevel === 3 ? 90 : 180;
    const waitScore = Math.max(0, 100 - (h.estimated_wait_minutes / maxWait) * 100);

    const distanceScore = Math.max(0, 100 - h.distance_miles * 5);

    const insuranceMatch =
      params.insuranceProvider &&
      h.accepted_insurances?.includes(params.insuranceProvider);
    const insuranceScore = esiLevel <= 2 ? 100 : insuranceMatch ? 100 : 0;

    return { availability, waitScore, distanceScore, insuranceScore };
  };

  // ── Bed gauge ───────────────────────────────────────────────────────────────
  const BedGauge = ({ beds, total = 50 }: { beds: number; total?: number }) => {
    const pct = Math.min(100, (beds / total) * 100);
    const color = pct > 50 ? GREEN : pct > 20 ? AMBER : RED_URGENT;
    return (
      <View style={s.gaugeContainer}>
        <View style={s.gaugeTrack}>
          <View style={[s.gaugeFill, { width: `${pct}%`, backgroundColor: color }]} />
        </View>
        <Text style={[s.gaugeLabel, { color }]}>{beds} beds</Text>
      </View>
    );
  };

  // ── Score bar ───────────────────────────────────────────────────────────────
  const ScoreBar = ({ label, value, color }: { label: string; value: number; color: string }) => (
    <View style={s.scoreBarRow}>
      <Text style={s.scoreBarLabel}>{label}</Text>
      <View style={s.scoreBarTrack}>
        <View style={[s.scoreBarFill, { width: `${Math.max(3, value)}%`, backgroundColor: color }]} />
      </View>
      <Text style={[s.scoreBarValue, { color }]}>{Math.round(value)}</Text>
    </View>
  );

  return (
    <View style={[s.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* ── Header ── */}
      <View style={s.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerIconBtn} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={18} color={TEXT_SECONDARY} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Recommended Hospitals</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollPad}>

        {/* ── ESI summary strip ── */}
        <View style={s.esiStrip}>
          <View style={s.esiStripBadge}>
            <Text style={s.esiStripLabel}>ESI</Text>
            <Text style={s.esiStripValue}>{esiLevel}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.esiStripDept}>{triage?.identified_department}</Text>
            <Text style={s.esiStripSummary} numberOfLines={2}>{triage?.urgency_summary}</Text>
          </View>
        </View>

        {/* ── Hospital selector tabs ── */}
        <View style={s.tabRow}>
          {recommended_hospitals.map((h, i) => (
            <TouchableOpacity
              key={h.id}
              style={[s.tab, i === selectedIdx && s.tabActive]}
              onPress={() => setSelectedIdx(i)}
              activeOpacity={0.7}
            >
              <Text style={[s.tabRank, i === selectedIdx && s.tabRankActive]}>#{i + 1}</Text>
              <Text style={[s.tabName, i === selectedIdx && s.tabNameActive]} numberOfLines={1}>
                {h.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Selected hospital detail ── */}
        {selectedHospital && (
          <>
            {/* Reason string */}
            <View style={s.reasonCard}>
              <MaterialIcons name="auto-awesome" size={16} color={PURPLE} />
              <Text style={s.reasonText}>
                {generateReasonString(selectedHospital, triage, params.insuranceProvider)}
              </Text>
            </View>

            {/* Key metrics row */}
            <View style={s.metricsRow}>
              <View style={s.metricCard}>
                <MaterialIcons name="schedule" size={20} color={AMBER} />
                <Text style={s.metricValue}>{selectedHospital.estimated_wait_minutes}</Text>
                <Text style={s.metricLabel}>min wait</Text>
              </View>
              <View style={s.metricCard}>
                <MaterialIcons name="directions" size={20} color={BLUE} />
                <Text style={s.metricValue}>{selectedHospital.distance_miles}</Text>
                <Text style={s.metricLabel}>miles</Text>
              </View>
              <View style={s.metricCard}>
                <MaterialIcons name="star" size={20} color={PURPLE} />
                <Text style={s.metricValue}>{selectedHospital.score}</Text>
                <Text style={s.metricLabel}>score</Text>
              </View>
            </View>

            {/* Bed availability gauge */}
            <Text style={s.sectionLabel}>BED AVAILABILITY</Text>
            <View style={s.card}>
              <View style={{ paddingVertical: 14 }}>
                <BedGauge beds={selectedHospital.available_beds} />
                <View style={s.bedMeta}>
                  <View style={s.bedMetaItem}>
                    <MaterialIcons
                      name={selectedHospital.department_match ? "check-circle" : "cancel"}
                      size={14}
                      color={selectedHospital.department_match ? GREEN : RED_URGENT}
                    />
                    <Text style={s.bedMetaText}>
                      {selectedHospital.department_match
                        ? `${triage?.identified_department} dept available`
                        : `No ${triage?.identified_department} dept`}
                    </Text>
                  </View>
                  <View style={s.bedMetaItem}>
                    <MaterialIcons name="info-outline" size={14} color={TEXT_MUTED} />
                    <Text style={s.bedMetaText}>
                      Source: {selectedHospital.capacity_source === "monitor_agent" ? "Live agent data" : "Estimated"}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Score breakdown */}
            <Text style={s.sectionLabel}>SCORE BREAKDOWN</Text>
            <View style={s.card}>
              <View style={{ paddingVertical: 14, gap: 12 }}>
                {(() => {
                  const b = getScoreBreakdown(selectedHospital);
                  return (
                    <>
                      <ScoreBar label="Availability" value={b.availability} color={FACTOR_COLORS.availability} />
                      <ScoreBar label="Wait Time" value={b.waitScore} color={FACTOR_COLORS.waitTime} />
                      <ScoreBar label="Distance" value={b.distanceScore} color={FACTOR_COLORS.distance} />
                      <ScoreBar label="Insurance" value={b.insuranceScore} color={FACTOR_COLORS.insurance} />
                    </>
                  );
                })()}
              </View>
            </View>

            {/* Hospital info */}
            <Text style={s.sectionLabel}>HOSPITAL DETAILS</Text>
            <View style={s.card}>
              <View style={s.detailRow}>
                <MaterialIcons name="place" size={16} color={TEXT_MUTED} />
                <Text style={s.detailText}>{selectedHospital.address}</Text>
              </View>
              <View style={s.divider} />
              {selectedHospital.phone && (
                <>
                  <TouchableOpacity
                    style={s.detailRow}
                    onPress={() => selectedHospital.phone && __DEV__ && console.log("call")}
                  >
                    <MaterialIcons name="phone" size={16} color={TEXT_MUTED} />
                    <Text style={[s.detailText, { color: PURPLE }]}>{selectedHospital.phone}</Text>
                  </TouchableOpacity>
                  <View style={s.divider} />
                </>
              )}
              <View style={s.detailRow}>
                <MaterialIcons name="local-hospital" size={16} color={TEXT_MUTED} />
                <Text style={s.detailText}>
                  Departments: {selectedHospital.departments?.join(", ")}
                </Text>
              </View>
              <View style={s.divider} />
              <View style={s.detailRow}>
                <MaterialIcons name="credit-card" size={16} color={TEXT_MUTED} />
                <Text style={s.detailText}>
                  Insurance: {selectedHospital.accepted_insurances?.join(", ")}
                </Text>
              </View>
            </View>
          </>
        )}

        {/* ── Wait time comparison chart ── */}
        {recommended_hospitals.length > 1 && (
          <>
            <Text style={s.sectionLabel}>WAIT TIME COMPARISON</Text>
            <View style={[s.card, { paddingVertical: 14, alignItems: "center" }]}>
              <BarChart
                data={waitChartData}
                width={width - 80}
                height={180}
                chartConfig={chartConfig}
                fromZero
                showValuesOnTopOfBars
                withInnerLines={false}
                yAxisSuffix=" min"
                yAxisLabel=""
                style={{ borderRadius: 12 }}
              />
            </View>
          </>
        )}

        {/* ── Action buttons ── */}
        <TouchableOpacity
          style={s.primaryBtn}
          activeOpacity={0.85}
          onPress={() => {
            if (!selectedHospital) return;
            router.push({
              pathname: "/care-plan",
              params: {
                triageData: JSON.stringify(triage),
                hospitalName: selectedHospital.name,
                userId: params.userId,
                sessionId: session_id,
                hospitalId: selectedHospital.id,
                department: triage?.identified_department || "general",
              },
            });
          }}
        >
          <MaterialIcons name="medical-services" size={18} color="#fff" />
          <Text style={s.primaryBtnText}>Get Follow-Up Care Plan</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.secondaryBtn}
          activeOpacity={0.85}
          onPress={() => {
            if (selectedHospital?.phone) {
              require("react-native").Linking.openURL(`tel:${selectedHospital.phone}`);
            }
          }}
        >
          <MaterialIcons name="phone" size={18} color={PURPLE} />
          <Text style={s.secondaryBtnText}>Call Hospital</Text>
        </TouchableOpacity>

      </ScrollView>
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

  sectionLabel: {
    color: TEXT_PRIMARY, fontSize: 10, fontWeight: "900",
    letterSpacing: 2.5, opacity: 0.45, marginBottom: 10, marginTop: 4,
  },

  card: {
    backgroundColor: SURFACE, borderRadius: 18, borderWidth: 1,
    borderColor: BORDER, paddingHorizontal: 18, marginBottom: 20,
  },

  divider: { height: 1, backgroundColor: BORDER },

  // ESI strip
  esiStrip: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: SURFACE, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: BORDER, marginBottom: 16,
  },
  esiStripBadge: {
    width: 52, height: 52, borderRadius: 14,
    backgroundColor: PURPLE_DIM, justifyContent: "center", alignItems: "center",
  },
  esiStripLabel: { fontSize: 8, fontWeight: "900", color: TEXT_MUTED, letterSpacing: 1.5 },
  esiStripValue: { fontSize: 22, fontWeight: "900", color: PURPLE },
  esiStripDept: { fontSize: 13, fontWeight: "700", color: TEXT_PRIMARY, marginBottom: 2 },
  esiStripSummary: { fontSize: 11, color: TEXT_SECONDARY, lineHeight: 16 },

  // Tabs
  tabRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  tab: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: SURFACE, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12,
    borderWidth: 1, borderColor: BORDER,
  },
  tabActive: { backgroundColor: PURPLE_DIM, borderColor: PURPLE },
  tabRank: { fontSize: 13, fontWeight: "900", color: TEXT_MUTED },
  tabRankActive: { color: PURPLE },
  tabName: { fontSize: 11, fontWeight: "600", color: TEXT_SECONDARY, flex: 1 },
  tabNameActive: { color: PURPLE },

  // Reason card
  reasonCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    backgroundColor: PURPLE_DIM, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: "rgba(124,58,237,0.25)", marginBottom: 16,
  },
  reasonText: { fontSize: 13, color: TEXT_PRIMARY, fontWeight: "600", lineHeight: 19, flex: 1 },

  // Metrics
  metricsRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  metricCard: {
    flex: 1, backgroundColor: SURFACE, borderRadius: 14, borderWidth: 1,
    borderColor: BORDER, padding: 14, alignItems: "center", gap: 4,
  },
  metricValue: { fontSize: 22, fontWeight: "900", color: TEXT_PRIMARY },
  metricLabel: { fontSize: 10, fontWeight: "600", color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: 1 },

  // Bed gauge
  gaugeContainer: { flexDirection: "row", alignItems: "center", gap: 12 },
  gaugeTrack: {
    flex: 1, height: 10, backgroundColor: SURFACE_LIGHT,
    borderRadius: 5, overflow: "hidden",
  },
  gaugeFill: { height: 10, borderRadius: 5 },
  gaugeLabel: { fontSize: 13, fontWeight: "700", width: 60, textAlign: "right" },

  bedMeta: { marginTop: 12, gap: 6 },
  bedMetaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  bedMetaText: { fontSize: 12, color: TEXT_SECONDARY },

  // Score bars
  scoreBarRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  scoreBarLabel: { fontSize: 11, fontWeight: "600", color: TEXT_SECONDARY, width: 80 },
  scoreBarTrack: {
    flex: 1, height: 8, backgroundColor: SURFACE_LIGHT,
    borderRadius: 4, overflow: "hidden",
  },
  scoreBarFill: { height: 8, borderRadius: 4 },
  scoreBarValue: { fontSize: 12, fontWeight: "700", width: 30, textAlign: "right" },

  // Details
  detailRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 13 },
  detailText: { fontSize: 13, color: TEXT_SECONDARY, flex: 1, lineHeight: 18 },

  // Buttons
  primaryBtn: {
    backgroundColor: PURPLE, borderRadius: 16, height: 54,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, marginBottom: 10,
  },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  secondaryBtn: {
    backgroundColor: PURPLE_DIM, borderRadius: 16, height: 54,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, marginBottom: 20, borderWidth: 1, borderColor: PURPLE,
  },
  secondaryBtnText: { color: PURPLE, fontSize: 15, fontWeight: "600" },
});
