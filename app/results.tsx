import { MaterialIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  Linking,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  MapView,
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
} from "../components/MapViewWrapper";
import {
  RecommendedHospital,
  TriageResponse,
  generateReasonString,
  getRoute,
} from "../services/api";

const { width, height } = Dimensions.get("window");

// ─── Polyline decoder (Google Encoded Polyline Algorithm) ────────────────────
function decodePolyline(encoded: string): { latitude: number; longitude: number }[] {
  const points: { latitude: number; longitude: number }[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

// ─── Route fetching (via backend → Valhalla, follows real roads) ────────────

/** Decode Valhalla encoded polyline (precision 6) */
function decodePolyline6(encoded: string): { latitude: number; longitude: number }[] {
  const points: { latitude: number; longitude: number }[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, byte: number;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ latitude: lat / 1e6, longitude: lng / 1e6 });
  }
  return points;
}

/** Fetch road-following route via backend (backend calls Valhalla) */
async function fetchRoadRoute(
  origin: { latitude: number; longitude: number },
  dest: { latitude: number; longitude: number }
): Promise<{ coords: { latitude: number; longitude: number }[]; durationMin?: number; distanceMi?: number }> {
  try {
    const data = await getRoute(origin.latitude, origin.longitude, dest.latitude, dest.longitude);
    const coords = decodePolyline6(data.shape);
    const durationMin = Math.round(data.duration_sec / 60);
    console.log(`Route: ${durationMin}min, ${data.distance_miles}mi, ${coords.length} points`);
    return { coords, durationMin, distanceMi: data.distance_miles };
  } catch (e) {
    console.warn("Backend route failed:", e);
    return { coords: [origin, dest] };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function formatLastUpdated(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// ─── Design tokens ───────────────────────────────────────────────────────────
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

// ─── Bottom sheet geometry ───────────────────────────────────────────────────
const CARD_WIDTH = width - 56;
const CARD_GAP = 12;
const SHEET_HEIGHT = height * 0.78;
const SHEET_PEEK = 340;
const SNAP_EXPANDED = 0;
const SNAP_COLLAPSED = SHEET_HEIGHT - SHEET_PEEK;

// ─── Score factor colors ─────────────────────────────────────────────────────
const FACTOR_COLORS = {
  availability: PURPLE,
  waitTime: AMBER,
  distance: BLUE,
  insurance: GREEN,
};

// ─── Dark map style ──────────────────────────────────────────────────────────
const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0F172A" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#94A3B8" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0F172A" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#1E293B" }] },
  { featureType: "administrative.country", elementType: "labels.text.fill", stylers: [{ color: "#94A3B8" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#CBD5E1" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#64748B" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#132027" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#475569" }] },
  { featureType: "poi.park", elementType: "labels.text.stroke", stylers: [{ color: "#0F172A" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1E293B" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0F172A" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#94A3B8" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#253547" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#2D3F55" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1A2A3A" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#CBD5E1" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#1E293B" }] },
  { featureType: "transit.station", elementType: "labels.text.fill", stylers: [{ color: "#64748B" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0A1628" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#475569" }] },
];

// ─── Component ───────────────────────────────────────────────────────────────
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
  const selectedHospital = recommended_hospitals?.[selectedIdx];
  const esiLevel = triage?.esi_level ?? 3;

  // ── Location ─────────────────────────────────────────────────────────────
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc = await Location.getCurrentPositionAsync({});
      setUserLocation({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
    })();
  }, []);

  // ── Route coordinates ─────────────────────────────────────────────────────
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);

  // ── Map ref + fit to route ───────────────────────────────────────────────
  const mapRef = useRef<any>(null);
  const flatListRef = useRef<FlatList>(null);

  // Track live drive times and cached route coords from Valhalla
  const [liveDriveTimes, setLiveDriveTimes] = useState<Record<string, number>>({});
  const [cachedRoutes, setCachedRoutes] = useState<Record<string, { latitude: number; longitude: number }[]>>({});

  // Prefetch real road routes + drive times for all hospitals on load
  useEffect(() => {
    if (!userLocation || !recommended_hospitals?.length) return;
    recommended_hospitals.forEach((h) => {
      if (h.encoded_polyline) return; // already has Google traffic data
      fetchRoadRoute(userLocation, {
        latitude: h.latitude,
        longitude: h.longitude,
      }).then((result) => {
        if (result.durationMin) {
          setLiveDriveTimes((prev) => ({ ...prev, [h.id]: result.durationMin! }));
        }
        if (result.coords.length > 2) {
          setCachedRoutes((prev) => ({ ...prev, [h.id]: result.coords }));
        }
      });
    });
  }, [userLocation, recommended_hospitals]);

  // Show route for the selected hospital (use cache if available)
  useEffect(() => {
    if (!userLocation || !selectedHospital) return;
    let cancelled = false;

    // Use backend Google polyline if available
    if (selectedHospital.encoded_polyline) {
      const coords = decodePolyline(selectedHospital.encoded_polyline);
      if (!cancelled) setRouteCoords(coords);
      return () => { cancelled = true; };
    }

    // Use cached Valhalla route if already fetched
    const cached = cachedRoutes[selectedHospital.id];
    if (cached) {
      if (!cancelled) setRouteCoords(cached);
      return () => { cancelled = true; };
    }

    // Fetch fresh from Valhalla
    fetchRoadRoute(userLocation, {
      latitude: selectedHospital.latitude,
      longitude: selectedHospital.longitude,
    }).then((result) => {
      if (!cancelled) {
        setRouteCoords(result.coords);
        if (result.durationMin) {
          setLiveDriveTimes((prev) => ({ ...prev, [selectedHospital.id]: result.durationMin! }));
        }
        if (result.coords.length > 2) {
          setCachedRoutes((prev) => ({ ...prev, [selectedHospital.id]: result.coords }));
        }
      }
    });
    return () => { cancelled = true; };
  }, [selectedIdx, userLocation, selectedHospital, cachedRoutes]);

  // Fit map to the route
  useEffect(() => {
    if (!routeCoords.length || !mapRef.current) return;
    const timer = setTimeout(() => {
      mapRef.current?.fitToCoordinates(routeCoords, {
        edgePadding: { top: 120, right: 60, bottom: SHEET_PEEK + 60, left: 60 },
        animated: true,
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [routeCoords]);

  // ── Bottom sheet animation ───────────────────────────────────────────────
  const translateY = useRef(new Animated.Value(SNAP_COLLAPSED)).current;
  const lastY = useRef(SNAP_COLLAPSED);
  const gestureStartY = useRef(SNAP_COLLAPSED);
  const isExpandedRef = useRef(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const id = translateY.addListener(({ value }) => {
      lastY.current = value;
    });
    return () => translateY.removeListener(id);
  }, [translateY]);

  const snapTo = useCallback(
    (expanded: boolean) => {
      isExpandedRef.current = expanded;
      setIsExpanded(expanded);
      Animated.spring(translateY, {
        toValue: expanded ? SNAP_EXPANDED : SNAP_COLLAPSED,
        useNativeDriver: true,
        damping: 28,
        stiffness: 280,
        mass: 0.7,
      }).start();
    },
    [translateY]
  );

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, gs) =>
        Math.abs(gs.dy) > 5 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onPanResponderGrant: () => {
        translateY.stopAnimation();
        gestureStartY.current = lastY.current;
      },
      onPanResponderMove: (_e, gs) => {
        const next = Math.max(
          SNAP_EXPANDED,
          Math.min(SNAP_COLLAPSED, gestureStartY.current + gs.dy)
        );
        translateY.setValue(next);
      },
      onPanResponderRelease: (_e, gs) => {
        if (gs.vy < -0.3) { snapTo(true); return; }
        if (gs.vy > 0.3) { snapTo(false); return; }
        const mid = (SNAP_EXPANDED + SNAP_COLLAPSED) / 2;
        snapTo(lastY.current < mid);
      },
      onPanResponderTerminate: () => {
        snapTo(isExpandedRef.current);
      },
    })
  ).current;

  // ── Carousel scroll sync ─────────────────────────────────────────────────
  const onScrollEnd = useCallback(
    (e: any) => {
      const offsetX = e.nativeEvent.contentOffset.x;
      const newIdx = Math.round(offsetX / (CARD_WIDTH + CARD_GAP));
      if (newIdx !== selectedIdx && newIdx >= 0 && newIdx < recommended_hospitals.length) {
        setSelectedIdx(newIdx);
      }
    },
    [selectedIdx, recommended_hospitals.length]
  );

  const onMarkerPress = useCallback(
    (idx: number) => {
      setSelectedIdx(idx);
      flatListRef.current?.scrollToIndex({ index: idx, animated: true });
    },
    []
  );

  // ── Score breakdown ────────────────────────────────────────────────────────
  const getScoreBreakdown = (h: RecommendedHospital) => {
    const deptScore = h.department_match ? 100 : 20;
    const bedScore = Math.min(100, (h.available_beds / Math.max(h.total_beds, 1)) * 100);
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

  // ── Sub-components ─────────────────────────────────────────────────────────
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

  const ScoreBar = ({ label, value, color }: { label: string; value: number; color: string }) => (
    <View style={s.scoreBarRow}>
      <Text style={s.scoreBarLabel}>{label}</Text>
      <View style={s.scoreBarTrack}>
        <View style={[s.scoreBarFill, { width: `${Math.max(3, value)}%`, backgroundColor: color }]} />
      </View>
      <Text style={[s.scoreBarValue, { color }]}>{Math.round(value)}</Text>
    </View>
  );

  // ── Render hospital card ───────────────────────────────────────────────────
  const renderCard = ({ item, index }: { item: RecommendedHospital; index: number }) => {
    const isSelected = index === selectedIdx;
    const b = getScoreBreakdown(item);

    return (
      <TouchableOpacity
        activeOpacity={0.95}
        onPress={() => onMarkerPress(index)}
        style={[
          s.card,
          isSelected && s.cardSelected,
          { width: CARD_WIDTH, marginLeft: index === 0 ? 28 : CARD_GAP / 2, marginRight: index === recommended_hospitals.length - 1 ? 28 : CARD_GAP / 2 },
        ]}
      >
        {/* Rank + Name */}
        <View style={s.cardHeader}>
          <View style={[s.rankBadge, isSelected && s.rankBadgeSelected]}>
            <Text style={[s.rankText, isSelected && s.rankTextSelected]}>#{index + 1}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.cardName} numberOfLines={1}>{item.name}</Text>
            <Text style={s.cardAddress} numberOfLines={1}>{item.address}</Text>
          </View>
        </View>

        {/* AI reason */}
        <View style={s.reasonStrip}>
          <MaterialIcons name="auto-awesome" size={12} color={PURPLE} />
          <Text style={s.reasonText} numberOfLines={2}>
            {generateReasonString(item, triage, params.insuranceProvider)}
          </Text>
        </View>

        {/* Metrics row */}
        {(() => {
          const liveTime = liveDriveTimes[item.id];
          const driveMin = liveTime || item.drive_time_minutes || Math.round(item.distance_miles / 30 * 60);
          const hasLiveRoute = !!liveTime || !!item.encoded_polyline;
          return (
            <>
              <View style={s.metricsRow}>
                <View style={s.metricPill}>
                  <MaterialIcons name="schedule" size={14} color={AMBER} />
                  <Text style={s.metricValue}>{item.estimated_wait_minutes}</Text>
                  <Text style={s.metricUnit}>min wait</Text>
                </View>
                <View style={s.metricPill}>
                  <MaterialIcons name="drive-eta" size={14} color={BLUE} />
                  <Text style={s.metricValue}>{driveMin}</Text>
                  <Text style={s.metricUnit}>{hasLiveRoute ? "min ETA" : "min est"}</Text>
                </View>
                <View style={s.metricPill}>
                  <MaterialIcons name="star" size={14} color={PURPLE} />
                  <Text style={s.metricValue}>{item.score}</Text>
                  <Text style={s.metricUnit}>score</Text>
                </View>
              </View>
            </>
          );
        })()}

        {/* Traffic-aware ETA */}
        {(() => {
          const liveTime = liveDriveTimes[item.id];
          const driveMin = liveTime || item.drive_time_minutes || Math.round(item.distance_miles / 30 * 60);
          const arrivalTime = new Date(Date.now() + driveMin * 60000);
          const arrivalStr = arrivalTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
          const isTrafficAware = !!item.encoded_polyline || !!liveTime;
          const etaColor = driveMin <= 15 ? GREEN : driveMin <= 30 ? AMBER : RED_URGENT;
          return (
            <View style={s.etaStrip}>
              <MaterialIcons name="navigation" size={13} color={etaColor} />
              <Text style={[s.etaText, { color: etaColor }]}>
                Arrive by {arrivalStr}
              </Text>
              <Text style={s.etaSeparator}>·</Text>
              <Text style={s.etaDistance}>{item.distance_miles} mi</Text>
              {isTrafficAware && (
                <View style={s.trafficBadge}>
                  <MaterialIcons name="traffic" size={10} color={BLUE} />
                  <Text style={s.trafficBadgeText}>Live traffic</Text>
                </View>
              )}
            </View>
          );
        })()}

        {/* Bed gauge */}
        <View style={{ marginTop: 10 }}>
          <BedGauge beds={item.available_beds} total={item.total_beds} />
        </View>

        {/* Department + insurance match */}
        <View style={s.tagRow}>
          <View style={[s.tag, { borderColor: item.department_match ? GREEN : RED_URGENT }]}>
            <MaterialIcons
              name={item.department_match ? "check-circle" : "cancel"}
              size={11}
              color={item.department_match ? GREEN : RED_URGENT}
            />
            <Text style={[s.tagText, { color: item.department_match ? GREEN : RED_URGENT }]}>
              {triage?.identified_department}
            </Text>
          </View>
          <View style={[s.tag, { borderColor: item.capacity_source === "hhs" ? GREEN : TEXT_MUTED }]}>
            <MaterialIcons
              name={item.capacity_source === "hhs" ? "verified" : "info-outline"}
              size={11}
              color={item.capacity_source === "hhs" ? GREEN : TEXT_MUTED}
            />
            <Text style={[s.tagText, { color: item.capacity_source === "hhs" ? GREEN : TEXT_MUTED }]}>
              {item.capacity_source === "hhs" ? "HHS Verified" : item.capacity_source === "monitor_agent" ? "Live data" : "Estimated"}
            </Text>
          </View>
        </View>

        {/* Last updated */}
        {item.last_updated && (
          <Text style={s.lastUpdated}>
            Updated {formatLastUpdated(item.last_updated)}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={s.container}>
      {/* ── MAP ── */}
      {userLocation ? (
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={StyleSheet.absoluteFill}
          showsUserLocation
          showsMyLocationButton={false}
          customMapStyle={DARK_MAP_STYLE}
          initialRegion={{
            latitude: userLocation.latitude,
            longitude: userLocation.longitude,
            latitudeDelta: 0.15,
            longitudeDelta: 0.15,
          }}
        >
          {/* Hospital markers */}
          {recommended_hospitals.map((h, i) => (
            <Marker
              key={h.id}
              coordinate={{ latitude: h.latitude, longitude: h.longitude }}
              title={h.name}
              description={`${h.estimated_wait_minutes} min wait - ${h.distance_miles} mi`}
              pinColor={i === selectedIdx ? PURPLE : BLUE}
              onPress={() => onMarkerPress(i)}
            />
          ))}

          {/* Driving route polyline to selected hospital */}
          {routeCoords.length > 1 && (
            <>
              {/* Route outline for visibility */}
              <Polyline
                coordinates={routeCoords}
                strokeColor="rgba(0,0,0,0.4)"
                strokeWidth={7}
              />
              {/* Main route line */}
              <Polyline
                coordinates={routeCoords}
                strokeColor={PURPLE}
                strokeWidth={5}
                lineDashPattern={selectedHospital?.encoded_polyline ? undefined : [0]}
              />
            </>
          )}
        </MapView>
      ) : (
        <View style={s.mapLoading}>
          <ActivityIndicator size="large" color={PURPLE} />
        </View>
      )}

      {/* ── Floating back button ── */}
      <TouchableOpacity
        onPress={() => router.back()}
        style={[s.floatingBackBtn, { top: insets.top + 10 }]}
        activeOpacity={0.8}
      >
        <MaterialIcons name="arrow-back" size={20} color={TEXT_PRIMARY} />
      </TouchableOpacity>

      {/* ── Floating ESI badge ── */}
      <View style={[s.floatingEsi, { top: insets.top + 10 }]}>
        <View style={s.esiBadgeSmall}>
          <Text style={s.esiBadgeLabel}>ESI</Text>
          <Text style={s.esiBadgeValue}>{esiLevel}</Text>
        </View>
        <View>
          <Text style={s.esiDeptText}>{triage?.identified_department}</Text>
          <Text style={s.esiCareText}>{triage?.recommended_care_type?.replace(/_/g, " ")}</Text>
        </View>
      </View>

      {/* ── BOTTOM SHEET ── */}
      <Animated.View
        style={[
          s.sheet,
          {
            height: SHEET_HEIGHT,
            transform: [{ translateY }],
            paddingBottom: insets.bottom,
          },
        ]}
      >
        {/* Drag handle */}
        <View {...panResponder.panHandlers} style={s.handleArea}>
          <View style={s.handle} />
          <Text style={s.sheetTitle}>Recommended Hospitals</Text>
          <Text style={s.sheetSubtitle}>
            Swipe to compare {recommended_hospitals.length} options
          </Text>
        </View>

        {/* Hospital card carousel */}
        <FlatList
          ref={flatListRef}
          data={recommended_hospitals}
          renderItem={renderCard}
          keyExtractor={(h) => h.id}
          horizontal
          pagingEnabled={false}
          snapToInterval={CARD_WIDTH + CARD_GAP}
          snapToAlignment="start"
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingRight: 0 }}
          onMomentumScrollEnd={onScrollEnd}
          onScrollEndDrag={onScrollEnd}
          getItemLayout={(_, index) => ({
            length: CARD_WIDTH + CARD_GAP,
            offset: (CARD_WIDTH + CARD_GAP) * index,
            index,
          })}
          style={{ flexGrow: 0 }}
        />

        {/* Page dots */}
        <View style={s.dotsRow}>
          {recommended_hospitals.map((_, i) => (
            <View
              key={i}
              style={[s.dot, i === selectedIdx && s.dotActive]}
            />
          ))}
        </View>

        {/* Action buttons */}
        <View style={s.actionArea}>
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
                Linking.openURL(`tel:${selectedHospital.phone}`);
              }
            }}
          >
            <MaterialIcons name="phone" size={18} color={PURPLE} />
            <Text style={s.secondaryBtnText}>Call Hospital</Text>
          </TouchableOpacity>
        </View>

        {/* ── Expanded details (visible when sheet is pulled up) ── */}
        {selectedHospital && (
          <ScrollView
            style={s.expandedScroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40 }}
          >
            {/* Score breakdown */}
            <Text style={s.sectionLabel}>SCORE BREAKDOWN</Text>
            <View style={s.detailCard}>
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

            {/* Traffic-aware route info */}
            <Text style={s.sectionLabel}>ROUTE INFORMATION</Text>
            <View style={s.detailCard}>
              <View style={s.detailRow}>
                <MaterialIcons name="drive-eta" size={16} color={BLUE} />
                <Text style={s.detailText}>
                  {selectedHospital.drive_time_minutes || Math.round(selectedHospital.distance_miles / 30 * 60)} min drive ({selectedHospital.distance_miles} mi)
                </Text>
              </View>
              <View style={s.divider} />
              <View style={s.detailRow}>
                <MaterialIcons name="access-time" size={16} color={AMBER} />
                <Text style={s.detailText}>
                  Estimated arrival: {new Date(Date.now() + (selectedHospital.drive_time_minutes || Math.round(selectedHospital.distance_miles / 30 * 60)) * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </Text>
              </View>
              <View style={s.divider} />
              <View style={s.detailRow}>
                <MaterialIcons name={selectedHospital.encoded_polyline ? "traffic" : "info-outline"} size={16} color={selectedHospital.encoded_polyline ? GREEN : TEXT_MUTED} />
                <Text style={[s.detailText, { color: selectedHospital.encoded_polyline ? GREEN : TEXT_MUTED }]}>
                  {selectedHospital.encoded_polyline ? "Traffic-aware routing via Google Maps" : "Estimated route (no live traffic data)"}
                </Text>
              </View>
            </View>

            {/* Hospital details */}
            <Text style={s.sectionLabel}>HOSPITAL DETAILS</Text>
            <View style={s.detailCard}>
              <View style={s.detailRow}>
                <MaterialIcons name="place" size={16} color={TEXT_MUTED} />
                <Text style={s.detailText}>{selectedHospital.address}</Text>
              </View>
              <View style={s.divider} />
              {selectedHospital.phone && (
                <>
                  <TouchableOpacity
                    style={s.detailRow}
                    onPress={() => Linking.openURL(`tel:${selectedHospital.phone}`)}
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
          </ScrollView>
        )}
      </Animated.View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: APP_BG },

  // Map
  mapLoading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: APP_BG,
    justifyContent: "center",
    alignItems: "center",
  },

  // Floating controls
  floatingBackBtn: {
    position: "absolute",
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  floatingEsi: {
    position: "absolute",
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    paddingVertical: 8,
    zIndex: 10,
  },
  esiBadgeSmall: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: PURPLE_DIM,
    justifyContent: "center",
    alignItems: "center",
  },
  esiBadgeLabel: { fontSize: 7, fontWeight: "900", color: TEXT_MUTED, letterSpacing: 1.2 },
  esiBadgeValue: { fontSize: 18, fontWeight: "900", color: PURPLE },
  esiDeptText: { fontSize: 11, fontWeight: "700", color: TEXT_PRIMARY },
  esiCareText: { fontSize: 9, fontWeight: "600", color: TEXT_SECONDARY, textTransform: "capitalize" },

  // Bottom sheet
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: APP_BG,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: BORDER,
    overflow: "hidden",
  },
  handleArea: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: BORDER,
    marginBottom: 10,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: TEXT_PRIMARY,
    letterSpacing: 0.2,
  },
  sheetSubtitle: {
    fontSize: 11,
    color: TEXT_MUTED,
    marginTop: 2,
  },

  // Hospital cards
  card: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
  },
  cardSelected: {
    borderColor: PURPLE,
    backgroundColor: "rgba(124,58,237,0.06)",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
  },
  rankBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: SURFACE_LIGHT,
    justifyContent: "center",
    alignItems: "center",
  },
  rankBadgeSelected: {
    backgroundColor: PURPLE_DIM,
  },
  rankText: {
    fontSize: 14,
    fontWeight: "900",
    color: TEXT_MUTED,
  },
  rankTextSelected: {
    color: PURPLE,
  },
  cardName: {
    fontSize: 14,
    fontWeight: "700",
    color: TEXT_PRIMARY,
  },
  cardAddress: {
    fontSize: 11,
    color: TEXT_SECONDARY,
    marginTop: 1,
  },

  // Reason strip
  reasonStrip: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: PURPLE_DIM,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  reasonText: {
    fontSize: 11,
    fontWeight: "600",
    color: TEXT_PRIMARY,
    lineHeight: 16,
    flex: 1,
  },

  // Metrics
  metricsRow: {
    flexDirection: "row",
    gap: 8,
  },
  metricPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: SURFACE_LIGHT,
    borderRadius: 10,
    paddingVertical: 8,
  },
  metricValue: {
    fontSize: 14,
    fontWeight: "900",
    color: TEXT_PRIMARY,
  },
  metricUnit: {
    fontSize: 9,
    fontWeight: "600",
    color: TEXT_MUTED,
    textTransform: "uppercase",
  },

  // Bed gauge
  gaugeContainer: { flexDirection: "row", alignItems: "center", gap: 10 },
  gaugeTrack: {
    flex: 1,
    height: 8,
    backgroundColor: SURFACE_LIGHT,
    borderRadius: 4,
    overflow: "hidden",
  },
  gaugeFill: { height: 8, borderRadius: 4 },
  gaugeLabel: { fontSize: 11, fontWeight: "700", width: 55, textAlign: "right" },

  // Tags
  tagRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tagText: {
    fontSize: 10,
    fontWeight: "600",
  },
  lastUpdated: {
    fontSize: 10,
    color: "#64748B",
    marginTop: 6,
    textAlign: "right",
  },

  // Traffic-aware ETA
  etaStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 8,
    backgroundColor: "rgba(15,23,42,0.5)",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  etaText: {
    fontSize: 12,
    fontWeight: "700",
  },
  etaSeparator: {
    fontSize: 10,
    color: "#64748B",
  },
  etaDistance: {
    fontSize: 11,
    fontWeight: "600",
    color: "#94A3B8",
  },
  trafficBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(59,130,246,0.15)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: "auto",
  },
  trafficBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#3B82F6",
  },

  // Page dots
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
    marginBottom: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: BORDER,
  },
  dotActive: {
    backgroundColor: PURPLE,
    width: 18,
  },

  // Action buttons
  actionArea: {
    paddingHorizontal: 24,
    paddingTop: 8,
    gap: 8,
  },
  primaryBtn: {
    backgroundColor: PURPLE,
    borderRadius: 16,
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  secondaryBtn: {
    backgroundColor: PURPLE_DIM,
    borderRadius: 16,
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: PURPLE,
  },
  secondaryBtnText: { color: PURPLE, fontSize: 15, fontWeight: "600" },

  // Expanded content
  expandedScroll: {
    flex: 1,
    paddingHorizontal: 24,
    marginTop: 16,
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
  detailCard: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 18,
    marginBottom: 20,
  },
  divider: { height: 1, backgroundColor: BORDER },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 13 },
  detailText: { fontSize: 13, color: TEXT_SECONDARY, flex: 1, lineHeight: 18 },

  // Score bars
  scoreBarRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  scoreBarLabel: { fontSize: 11, fontWeight: "600", color: TEXT_SECONDARY, width: 80 },
  scoreBarTrack: {
    flex: 1,
    height: 8,
    backgroundColor: SURFACE_LIGHT,
    borderRadius: 4,
    overflow: "hidden",
  },
  scoreBarFill: { height: 8, borderRadius: 4 },
  scoreBarValue: { fontSize: 12, fontWeight: "700", width: 30, textAlign: "right" },
});
