import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState, useCallback } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AdminCapacityResponse,
  AdminHospital,
  getAdminCapacity,
} from "../services/api";

const { width } = Dimensions.get("window");

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

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.floor(diffMin / 60)}h ago`;
}

function getOccupancyColor(rate: number): string {
  if (rate < 0.6) return GREEN;
  if (rate < 0.8) return AMBER;
  return RED_URGENT;
}

function getWaitColor(minutes: number): string {
  if (minutes <= 30) return GREEN;
  if (minutes <= 90) return AMBER;
  return RED_URGENT;
}

export default function AdminDashboardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [data, setData] = useState<AdminCapacityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const result = await getAdminCapacity();
      setData(result);
    } catch (e: any) {
      console.error("Admin capacity error:", e);
      setError("Could not load hospital data. Make sure the backend is running.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Auto-refresh every 60 seconds
    const interval = setInterval(() => fetchData(true), 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const SummaryCard = ({ icon, label, value, color, subtitle }: {
    icon: keyof typeof MaterialIcons.glyphMap;
    label: string;
    value: string;
    color: string;
    subtitle?: string;
  }) => (
    <View style={s.summaryCard}>
      <View style={[s.summaryIcon, { backgroundColor: `${color}18` }]}>
        <MaterialIcons name={icon} size={20} color={color} />
      </View>
      <Text style={s.summaryValue}>{value}</Text>
      <Text style={s.summaryLabel}>{label}</Text>
      {subtitle && <Text style={s.summarySubtitle}>{subtitle}</Text>}
    </View>
  );

  const OccupancyBar = ({ rate }: { rate: number }) => {
    const pct = Math.round(rate * 100);
    const color = getOccupancyColor(rate);
    return (
      <View style={s.occBarContainer}>
        <View style={s.occBarTrack}>
          <View style={[s.occBarFill, { width: `${Math.min(100, pct)}%`, backgroundColor: color }]} />
        </View>
        <Text style={[s.occBarLabel, { color }]}>{pct}%</Text>
      </View>
    );
  };

  const renderHospital = ({ item }: { item: AdminHospital }) => {
    const isExpanded = expandedId === item.id;
    const occColor = getOccupancyColor(item.occupancy_rate);
    const waitColor = getWaitColor(item.avg_wait_minutes);

    return (
      <TouchableOpacity
        style={[s.hospitalCard, isExpanded && s.hospitalCardExpanded]}
        onPress={() => setExpandedId(isExpanded ? null : item.id)}
        activeOpacity={0.85}
      >
        {/* Header */}
        <View style={s.hospitalHeader}>
          <View style={{ flex: 1 }}>
            <Text style={s.hospitalName} numberOfLines={1}>{item.name}</Text>
            <Text style={s.hospitalAddress} numberOfLines={1}>{item.address}</Text>
          </View>
          <MaterialIcons name={isExpanded ? "expand-less" : "expand-more"} size={22} color={TEXT_MUTED} />
        </View>

        {/* Key metrics */}
        <View style={s.metricsRow}>
          <View style={s.metricBox}>
            <Text style={s.metricLabel}>Occupancy</Text>
            <OccupancyBar rate={item.occupancy_rate} />
          </View>
          <View style={s.metricDivider} />
          <View style={s.metricBox}>
            <Text style={s.metricLabel}>Avg Wait</Text>
            <Text style={[s.metricBigValue, { color: waitColor }]}>
              {item.avg_wait_minutes}<Text style={s.metricBigUnit}> min</Text>
            </Text>
          </View>
          <View style={s.metricDivider} />
          <View style={s.metricBox}>
            <Text style={s.metricLabel}>Beds Free</Text>
            <Text style={[s.metricBigValue, { color: item.available_beds > 10 ? GREEN : item.available_beds > 3 ? AMBER : RED_URGENT }]}>
              {item.available_beds}<Text style={s.metricBigUnit}>/{item.total_beds}</Text>
            </Text>
          </View>
        </View>

        {/* Expanded department details */}
        {isExpanded && (
          <View style={s.expandedSection}>
            <Text style={s.deptSectionLabel}>DEPARTMENT BREAKDOWN</Text>
            {item.departments.map((dept, i) => (
              <View key={dept.department} style={[s.deptRow, i > 0 && s.deptRowBorder]}>
                <View style={s.deptName}>
                  <MaterialIcons name="local-hospital" size={14} color={PURPLE} />
                  <Text style={s.deptNameText}>{dept.department}</Text>
                </View>
                <View style={s.deptMetrics}>
                  <View style={s.deptMetric}>
                    <MaterialIcons name="hotel" size={12} color={dept.available_beds > 5 ? GREEN : AMBER} />
                    <Text style={s.deptMetricText}>{dept.available_beds} beds</Text>
                  </View>
                  <View style={s.deptMetric}>
                    <MaterialIcons name="schedule" size={12} color={getWaitColor(dept.estimated_wait_minutes)} />
                    <Text style={s.deptMetricText}>{dept.estimated_wait_minutes} min</Text>
                  </View>
                  <View style={[s.sourceBadge, {
                    backgroundColor: dept.source === "hhs" ? "rgba(16,185,129,0.15)" : "rgba(100,116,139,0.15)",
                  }]}>
                    <Text style={[s.sourceText, {
                      color: dept.source === "hhs" ? GREEN : TEXT_MUTED,
                    }]}>{dept.source === "hhs" ? "HHS" : "Live"}</Text>
                  </View>
                </View>
                {dept.last_updated && (
                  <Text style={s.deptUpdated}>{formatTime(dept.last_updated)}</Text>
                )}
              </View>
            ))}

            {/* Insurance */}
            <Text style={[s.deptSectionLabel, { marginTop: 12 }]}>ACCEPTED INSURANCE</Text>
            <View style={s.insuranceRow}>
              {item.accepted_insurances.map((ins) => (
                <View key={ins} style={s.insurancePill}>
                  <Text style={s.insurancePillText}>{ins}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerIconBtn} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={18} color={TEXT_SECONDARY} />
        </TouchableOpacity>
        <View>
          <Text style={s.headerTitle}>Admin Dashboard</Text>
          <Text style={s.headerSubtitle}>Real-time hospital capacity</Text>
        </View>
        <TouchableOpacity
          onPress={() => fetchData(true)}
          style={s.headerIconBtn}
          activeOpacity={0.7}
        >
          <MaterialIcons name="refresh" size={18} color={TEXT_SECONDARY} />
        </TouchableOpacity>
      </View>

      {loading && !data && (
        <View style={s.loadingContainer}>
          <ActivityIndicator size="large" color={PURPLE} />
          <Text style={s.loadingText}>Loading hospital data...</Text>
        </View>
      )}

      {error && !data && (
        <View style={s.loadingContainer}>
          <MaterialIcons name="error-outline" size={48} color={RED_URGENT} />
          <Text style={s.loadingText}>{error}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => fetchData()}>
            <Text style={s.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {data && (
        <FlatList
          data={data.hospitals}
          renderItem={renderHospital}
          keyExtractor={(h) => h.id}
          contentContainerStyle={s.listPad}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchData(true)}
              tintColor={PURPLE}
            />
          }
          ListHeaderComponent={() => (
            <>
              {/* Summary cards */}
              <View style={s.summaryRow}>
                <SummaryCard
                  icon="local-hospital"
                  label="Hospitals"
                  value={String(data.total_hospitals)}
                  color={PURPLE}
                />
                <SummaryCard
                  icon="hotel"
                  label="Beds Available"
                  value={String(data.total_available_beds)}
                  color={GREEN}
                />
                <SummaryCard
                  icon="speed"
                  label="Avg Occupancy"
                  value={`${Math.round(data.avg_occupancy * 100)}%`}
                  color={getOccupancyColor(data.avg_occupancy)}
                />
              </View>

              {/* Status bar */}
              <View style={s.statusBar}>
                <View style={s.statusDot} />
                <Text style={s.statusText}>Live data · Auto-refreshes every 60s</Text>
              </View>

              <Text style={s.sectionLabel}>ALL HOSPITALS</Text>
            </>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: APP_BG },

  // Header
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
  headerSubtitle: { fontSize: 10, color: TEXT_MUTED, marginTop: 1 },
  headerIconBtn: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
    justifyContent: "center", alignItems: "center",
  },

  listPad: { paddingHorizontal: 16, paddingBottom: 40 },

  // Loading
  loadingContainer: {
    flex: 1, justifyContent: "center", alignItems: "center", gap: 12,
  },
  loadingText: { fontSize: 14, color: TEXT_SECONDARY, textAlign: "center" },
  retryBtn: {
    backgroundColor: PURPLE, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 10,
  },
  retryBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },

  // Summary cards
  summaryRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
    marginBottom: 16,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    alignItems: "center",
  },
  summaryIcon: {
    width: 40, height: 40, borderRadius: 12,
    justifyContent: "center", alignItems: "center", marginBottom: 8,
  },
  summaryValue: { fontSize: 22, fontWeight: "900", color: TEXT_PRIMARY },
  summaryLabel: { fontSize: 10, fontWeight: "700", color: TEXT_MUTED, marginTop: 2, textTransform: "uppercase", letterSpacing: 1 },
  summarySubtitle: { fontSize: 9, color: TEXT_MUTED, marginTop: 2 },

  // Status
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(16,185,129,0.08)",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  statusDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: GREEN,
  },
  statusText: { fontSize: 11, fontWeight: "600", color: GREEN },

  sectionLabel: {
    color: TEXT_PRIMARY,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2.5,
    opacity: 0.45,
    marginBottom: 10,
  },

  // Hospital card
  hospitalCard: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    marginBottom: 12,
  },
  hospitalCardExpanded: {
    borderColor: PURPLE,
    backgroundColor: "rgba(124,58,237,0.04)",
  },
  hospitalHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  hospitalName: { fontSize: 14, fontWeight: "700", color: TEXT_PRIMARY },
  hospitalAddress: { fontSize: 11, color: TEXT_SECONDARY, marginTop: 1 },

  // Metrics
  metricsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  metricBox: { flex: 1, alignItems: "center" },
  metricDivider: {
    width: 1, height: 36, backgroundColor: BORDER, marginHorizontal: 8,
  },
  metricLabel: {
    fontSize: 9, fontWeight: "700", color: TEXT_MUTED,
    textTransform: "uppercase", letterSpacing: 1, marginBottom: 6,
  },
  metricBigValue: { fontSize: 18, fontWeight: "900" },
  metricBigUnit: { fontSize: 11, fontWeight: "600", color: TEXT_MUTED },

  // Occupancy bar
  occBarContainer: { flexDirection: "row", alignItems: "center", gap: 6, width: "100%" },
  occBarTrack: {
    flex: 1, height: 8, backgroundColor: SURFACE_LIGHT, borderRadius: 4, overflow: "hidden",
  },
  occBarFill: { height: 8, borderRadius: 4 },
  occBarLabel: { fontSize: 12, fontWeight: "800", width: 36, textAlign: "right" },

  // Expanded
  expandedSection: { marginTop: 14, borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 14 },
  deptSectionLabel: {
    fontSize: 9, fontWeight: "900", color: TEXT_MUTED,
    letterSpacing: 2, marginBottom: 10,
  },
  deptRow: { paddingVertical: 10 },
  deptRowBorder: { borderTopWidth: 1, borderTopColor: BORDER },
  deptName: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  deptNameText: { fontSize: 13, fontWeight: "700", color: TEXT_PRIMARY, textTransform: "capitalize" },
  deptMetrics: { flexDirection: "row", alignItems: "center", gap: 14, marginLeft: 20 },
  deptMetric: { flexDirection: "row", alignItems: "center", gap: 4 },
  deptMetricText: { fontSize: 12, fontWeight: "600", color: TEXT_SECONDARY },
  sourceBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  sourceText: { fontSize: 9, fontWeight: "700" },
  deptUpdated: { fontSize: 10, color: TEXT_MUTED, marginTop: 4, marginLeft: 20 },

  // Insurance pills
  insuranceRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  insurancePill: {
    backgroundColor: SURFACE_LIGHT, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  insurancePillText: { fontSize: 11, fontWeight: "600", color: TEXT_SECONDARY },
});
