import { MaterialIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { StatusBar, setStatusBarStyle } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
  Linking,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../../supabase";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";

const { width, height } = Dimensions.get("window");

const APP_BG_COLOR = "#0f172a";
const PURPLE = "#7C3AED";
const RED_URGENT = "#EF4444";
const CARD_BG = "#FFFFFF";

// ── Bottom sheet geometry ─────────────────────────────────────────────────────
const SHEET_HEIGHT = height * 0.82;
const SHEET_PEEK = 290; // visible height when collapsed
const SNAP_EXPANDED = 0;
const SNAP_COLLAPSED = SHEET_HEIGHT - SHEET_PEEK;

// ── Overpass mirrors (tried in order until one succeeds) ─────────────────────
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

// ── Filter categories ─────────────────────────────────────────────────────────
type FilterKey =
  | "all"
  | "hospital"
  | "clinic"
  | "pharmacy"
  | "doctors"
  | "dentist";

const FILTERS: { key: FilterKey; label: string; icon: string }[] = [
  { key: "all", label: "All", icon: "local-hospital" },
  { key: "hospital", label: "Hospitals", icon: "local-hospital" },
  { key: "clinic", label: "Clinics", icon: "healing" },
  { key: "pharmacy", label: "Pharmacy", icon: "local-pharmacy" },
  { key: "doctors", label: "Doctors", icon: "person" },
  { key: "dentist", label: "Dentist", icon: "medical-services" },
];

// ── Types ─────────────────────────────────────────────────────────────────────
interface NearbyPlace {
  place_id: string;
  name: string;
  vicinity: string;
  phone?: string;
  website?: string;
  open_now?: boolean;
  hours_display?: string;
  geometry: { location: { lat: number; lng: number } };
  amenity: FilterKey;
  detailsFetched: boolean;
}

// ── OSM amenity → FilterKey ───────────────────────────────────────────────────
const OSM_AMENITY_MAP: Record<string, FilterKey> = {
  hospital: "hospital",
  clinic: "clinic",
  doctors: "doctors",
  dentist: "dentist",
  pharmacy: "pharmacy",
  physiotherapist: "clinic",
  medical_lab: "clinic",
  urgent_care: "clinic",
  nursing_home: "clinic",
  health_centre: "clinic",
};

// ── Build Overpass QL query for medical facilities ────────────────────────────
function buildOverpassQuery(lat: number, lon: number, r: number): string {
  const amenities = Object.keys(OSM_AMENITY_MAP).join("|");
  return `
[out:json][timeout:25];
(
  node["amenity"~"^(${amenities})$"](around:${r},${lat},${lon});
  way["amenity"~"^(${amenities})$"](around:${r},${lat},${lon});
  relation["amenity"~"^(${amenities})$"](around:${r},${lat},${lon});
);
out center;
`.trim();
}

// ── OSM opening_hours parser ──────────────────────────────────────────────────
// Handles: "24/7", "Mo-Fr 09:00-17:00", "Mo-Sa 08:00-20:00; Su 10:00-16:00"
const OSM_DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function parseOpeningHours(raw: string | undefined): {
  open_now: boolean | undefined;
  hours_display: string | undefined;
} {
  if (!raw) return { open_now: undefined, hours_display: undefined };
  const normalized = raw.trim();

  if (normalized === "24/7" || normalized === "Mo-Su 00:00-24:00") {
    return { open_now: true, hours_display: "Open 24 hours" };
  }

  // JS: 0=Sun…6=Sat → OSM: 0=Mo…6=Su
  const jsDay = new Date().getDay();
  const osmToday = jsDay === 0 ? 6 : jsDay - 1;
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  const fmt = (h: number, m: number) => {
    const ampm = h >= 12 ? "PM" : "AM";
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
  };

  for (const rule of normalized.split(";").map((r) => r.trim())) {
    // Match optional day part + time range: "Mo-Fr 09:00-17:00" or "09:00-17:00"
    const m = rule.match(/^([A-Za-z ,\-]+?)?\s*(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
    if (!m) continue;

    const dayPart = m[1]?.trim();
    const [sh, sm, eh, em] = [+m[2], +m[3], +m[4], +m[5]];

    // If no day part, rule applies every day
    let appliesToday = !dayPart;

    if (dayPart) {
      for (const segment of dayPart.split(",").map((s) => s.trim())) {
        const parts = segment.split("-");
        if (parts.length === 1) {
          if (OSM_DAYS.indexOf(parts[0]) === osmToday) appliesToday = true;
        } else {
          const start = OSM_DAYS.indexOf(parts[0]);
          const end = OSM_DAYS.indexOf(parts[1]);
          if (start !== -1 && end !== -1) {
            if (start <= end ? osmToday >= start && osmToday <= end
                             : osmToday >= start || osmToday <= end)
              appliesToday = true;
          }
        }
      }
    }

    if (appliesToday) {
      const startMins = sh * 60 + sm;
      const endMins = eh * 60 + em;
      return {
        open_now: nowMins >= startMins && nowMins < endMins,
        hours_display: `${fmt(sh, sm)}–${fmt(eh, em)}`,
      };
    }
  }

  return { open_now: undefined, hours_display: undefined };
}

// ── Parse a single Overpass element into NearbyPlace ─────────────────────────
function parseOsmElement(el: any): NearbyPlace | null {
  const tags = el.tags ?? {};
  const name = tags.name;
  if (!name) return null;

  const lat: number = el.type === "node" ? el.lat : el.center?.lat;
  const lng: number = el.type === "node" ? el.lon : el.center?.lon;
  if (!lat || !lng) return null;

  const amenityRaw: string = tags.amenity ?? "";
  const amenity: FilterKey = OSM_AMENITY_MAP[amenityRaw] ?? "clinic";

  const addressParts = [
    tags["addr:housenumber"],
    tags["addr:street"],
    tags["addr:city"],
    tags["addr:state"],
  ].filter(Boolean);
  const vicinity =
    addressParts.length >= 2 ? addressParts.join(" ") : "Address unavailable";

  const { open_now, hours_display } = parseOpeningHours(tags.opening_hours);

  return {
    place_id: `osm-${el.type}-${el.id}`,
    name,
    vicinity,
    phone: tags.phone ?? tags["contact:phone"] ?? undefined,
    website: tags.website ?? tags["contact:website"] ?? undefined,
    open_now,
    hours_display,
    geometry: { location: { lat, lng } },
    amenity,
    detailsFetched: true,
  };
}

// ── Nominatim reverse geocode fallback (free, no key) ────────────────────────
async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await Promise.race([
      fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      ),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
    ]);
    if (!res.ok) return null;
    const json = await res.json();
    const a = json.address ?? {};

    const street = [a.house_number, a.road ?? a.pedestrian ?? a.footway]
      .filter(Boolean)
      .join(" ");
    const city = a.city ?? a.town ?? a.village ?? a.suburb ?? a.county ?? "";
    const state = a.state ?? "";

    const parts = [street, city, state].filter(Boolean);
    if (parts.length > 0) return parts.join(", ");

    // Last resort: first 3 segments of display_name
    if (json.display_name) {
      return json.display_name.split(",").slice(0, 3).join(",").trim();
    }
    return null;
  } catch {
    return null;
  }
}

// ── Fetch nearby facilities via Overpass (tries all mirrors) ─────────────────
async function fetchNearbyFacilities(
  userLat: number,
  userLon: number,
  radiusMeters = 5000,
): Promise<NearbyPlace[]> {
  const query = buildOverpassQuery(userLat, userLon, radiusMeters);
  const body = `data=${encodeURIComponent(query)}`;

  const timeout = (ms: number) =>
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms),
    );

  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const res = await Promise.race([
        fetch(mirror, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        }),
        timeout(20000),
      ]);

      if (!res.ok) {
        console.warn(`Overpass mirror ${mirror} returned ${res.status}, trying next…`);
        continue;
      }

      const json = await res.json();
      const elements: any[] = json.elements ?? [];

      const parsed: NearbyPlace[] = elements
        .map((el) => parseOsmElement(el))
        .filter((p): p is NearbyPlace => p !== null);

      // Deduplicate by name within ~100 m grid cell
      const seen = new Set<string>();
      const deduped = parsed.filter((p) => {
        const key = `${p.name.toLowerCase()}|${Math.round(p.geometry.location.lat / 0.001)}|${Math.round(p.geometry.location.lng / 0.001)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      deduped.sort((a, b) => {
        const dA = (a.geometry.location.lat - userLat) ** 2 + (a.geometry.location.lng - userLon) ** 2;
        const dB = (b.geometry.location.lat - userLat) ** 2 + (b.geometry.location.lng - userLon) ** 2;
        return dA - dB;
      });

      return deduped;
    } catch (err: any) {
      console.warn(`Overpass mirror ${mirror} failed:`, err?.message ?? err);
    }
  }

  console.error("All Overpass mirrors failed.");
  return [];
}


// ── Wait time estimator ───────────────────────────────────────────────────────
// No free real-time API exists for facility wait times.
// Estimate using: base wait by type + time-of-day curve + day-of-week + stable
// per-facility hash so each place has a consistent offset within a session.
const BASE_WAIT: Record<FilterKey, number> = {
  all: 30,
  hospital: 110,
  clinic: 38,
  pharmacy: 10,
  doctors: 22,
  dentist: 14,
};

function estimateWaitMinutes(place: NearbyPlace): number {
  const base = BASE_WAIT[place.amenity] ?? 30;

  const hour = new Date().getHours();
  const day  = new Date().getDay(); // 0=Sun

  const timeMultiplier =
    hour >= 9  && hour < 11 ? 1.55 :  // morning rush
    hour >= 11 && hour < 13 ? 1.30 :  // pre-lunch
    hour >= 17 && hour < 19 ? 1.45 :  // after-work rush
    hour >= 7  && hour < 9  ? 0.80 :  // early morning
    hour >= 19 || hour < 7  ? 0.55 :  // evening / closed-ish
    1.0;

  const dayMultiplier =
    day === 1 ? 1.30 :  // Monday (post-weekend backlog)
    day === 5 ? 1.10 :  // Friday
    day === 0 || day === 6 ? 0.80 :
    1.0;

  // Stable per-facility jitter (±20%) derived from place_id
  let hash = 0;
  for (const c of place.place_id) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  const jitter = 0.82 + (hash % 100) / 265;

  return Math.max(5, Math.round(base * timeMultiplier * dayMultiplier * jitter));
}

function formatWait(mins: number): string {
  if (mins < 60) return `~${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `~${h}h ${m}m` : `~${h}h`;
}

function waitColor(mins: number): string {
  if (mins <= 15) return "#16A34A";
  if (mins <= 45) return "#D97706";
  return "#DC2626";
}

// ── Distance helper ───────────────────────────────────────────────────────────
function distanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): string {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return d < 0.1 ? `${Math.round(d * 5280)} ft` : `${d.toFixed(1)} mi`;
}

// ── Facility icon helper ──────────────────────────────────────────────────────
function facilityIcon(amenity: FilterKey): any {
  if (amenity === "hospital") return "local-hospital";
  if (amenity === "pharmacy") return "local-pharmacy";
  if (amenity === "doctors") return "person";
  if (amenity === "dentist") return "medical-services";
  return "healing";
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const mapRef = useRef<MapView>(null);
  const router = useRouter();

  const [location, setLocation] = useState<Location.LocationObject | null>(
    null,
  );
  const [places, setPlaces] = useState<NearbyPlace[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<NearbyPlace | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarInitials, setAvatarInitials] = useState<string>("");

  // Re-runs every time this screen gains focus:
  // 1. Forces the dark status bar back (in case another screen changed it)
  // 2. Re-fetches the avatar so changes made in profile screen show immediately
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle("light");

      supabase.auth.getUser().then(({ data: { user } }) => {
        if (!user) return;
        supabase
          .from("profiles")
          .select("avatar_url, first_name, last_name")
          .eq("id", user.id)
          .single()
          .then(({ data }) => {
            if (!data) return;
            setAvatarUrl(data.avatar_url ?? null);
            const initials =
              (data.first_name?.[0] ?? "") + (data.last_name?.[0] ?? "");
            setAvatarInitials(initials.toUpperCase());
          });
      });
    }, []),
  );

  // ── Bottom-sheet animation (translateY, native driver) ────────────────────
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
        damping: 22,
        stiffness: 200,
        mass: 0.85,
      }).start();
    },
    [translateY],
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
          Math.min(SNAP_COLLAPSED, gestureStartY.current + gs.dy),
        );
        translateY.setValue(next);
      },
      onPanResponderRelease: (_e, gs) => {
        const mid = (SNAP_EXPANDED + SNAP_COLLAPSED) / 2;
        snapTo(lastY.current < mid || gs.vy < -0.4);
      },
      onPanResponderTerminate: () => {
        snapTo(isExpandedRef.current);
      },
    }),
  ).current;

  const filteredPlaces =
    activeFilter === "all"
      ? places
      : places.filter((p) => p.amenity === activeFilter);

  // ── Location + places fetch ───────────────────────────────────────────────
  const updateLocation = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return;

    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    setLocation(loc);
    centerMap(loc.coords.latitude, loc.coords.longitude);
    setLoadingPlaces(true);
    setPlaces([]);

    const results = await fetchNearbyFacilities(
      loc.coords.latitude,
      loc.coords.longitude,
    );

    setPlaces(results);
    setLoadingPlaces(false);

    // Background pass: reverse-geocode places missing an address, one at a time
    const missing = results.filter((p) => p.vicinity === "Address unavailable");
    for (const place of missing) {
      const address = await reverseGeocode(
        place.geometry.location.lat,
        place.geometry.location.lng,
      );
      if (address) {
        setPlaces((prev) =>
          prev.map((p) =>
            p.place_id === place.place_id ? { ...p, vicinity: address } : p,
          ),
        );
      }
      // Nominatim rate limit: 1 req/sec
      await new Promise((r) => setTimeout(r, 1100));
    }
  }, []);

  useEffect(() => {
    updateLocation();
  }, []); // eslint-disable-line

  // ── Map helpers ───────────────────────────────────────────────────────────
  const centerMap = (lat: number, lon: number) =>
    mapRef.current?.animateToRegion(
      { latitude: lat, longitude: lon, latitudeDelta: 0.04, longitudeDelta: 0.04 },
      800,
    );

  const handleZoom = (type: "in" | "out") =>
    mapRef.current?.getCamera().then((cam) => {
      if (cam.zoom !== undefined) {
        cam.zoom += type === "in" ? 1 : -1;
        mapRef.current?.animateCamera(cam);
      } else {
        mapRef.current?.animateToRegion({
          latitude: cam.center.latitude,
          longitude: cam.center.longitude,
          latitudeDelta: type === "in" ? 0.005 : 0.05,
          longitudeDelta: type === "in" ? 0.005 : 0.05,
        });
      }
    });

  const focusPlace = useCallback((place: NearbyPlace) => {
    setSelectedPlace(place);
    centerMap(place.geometry.location.lat, place.geometry.location.lng);
  }, []);

  // ── Open place in device maps app ────────────────────────────────────────
  const openInMaps = (place: NearbyPlace) => {
    const { lat, lng } = place.geometry.location;
    const url = Platform.select({
      ios: `maps:0,0?q=${encodeURIComponent(place.name)}&ll=${lat},${lng}`,
      android: `geo:${lat},${lng}?q=${encodeURIComponent(place.name)}`,
    });
    if (url) Linking.openURL(url);
  };

  // ── List card ─────────────────────────────────────────────────────────────
  const renderRowCard = (item: NearbyPlace) => {
    const isSelected = selectedPlace?.place_id === item.place_id;
    const dist = location
      ? distanceMiles(
          location.coords.latitude,
          location.coords.longitude,
          item.geometry.location.lat,
          item.geometry.location.lng,
        )
      : "";
    return (
      <TouchableOpacity
        key={item.place_id}
        style={[styles.listCard, isSelected && styles.listCardSelected]}
        onPress={() => focusPlace(item)}
        activeOpacity={0.88}
      >
        {/* Icon + name + distance */}
        <View style={styles.listTop}>
          <View style={[styles.listIcon, isSelected && styles.listIconSelected]}>
            <MaterialIcons
              name={facilityIcon(item.amenity)}
              size={24}
              color={isSelected ? "#fff" : PURPLE}
            />
          </View>
          <View style={styles.listInfo}>
            <View style={styles.listTitleRow}>
              <Text style={styles.listName} numberOfLines={1}>{item.name}</Text>
              {!!dist && <Text style={styles.listDist}>{dist}</Text>}
            </View>
            <Text style={styles.listType}>{item.amenity}</Text>
          </View>
        </View>

        {/* Wait time + address row */}
        <View style={styles.listMeta}>
          {(() => {
            const mins = estimateWaitMinutes(item);
            const color = waitColor(mins);
            return (
              <View style={[styles.waitBadge, { backgroundColor: color + "1A", borderColor: color + "55" }]}>
                <MaterialIcons name="schedule" size={12} color={color} />
                <Text style={[styles.waitText, { color }]}>{formatWait(mins)}</Text>
                <Text style={[styles.waitLabel, { color }]}>est. wait</Text>
              </View>
            );
          })()}
          {item.vicinity !== "Address unavailable" && (
            <View style={styles.listDetailRow}>
              <MaterialIcons name="location-on" size={12} color="#94A3B8" />
              <Text style={styles.listDetailText} numberOfLines={1}>{item.vicinity}</Text>
            </View>
          )}
        </View>

        {/* Get More Info button */}
        <TouchableOpacity
          style={styles.moreInfoBtn}
          onPress={() => openInMaps(item)}
          activeOpacity={0.82}
        >
          <MaterialIcons name="open-in-new" size={14} color="#fff" />
          <Text style={styles.moreInfoText}>Get More Info</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  // ── Compact horizontal card (collapsed peek) ──────────────────────────────

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar style="light" translucent backgroundColor="transparent" />

      {/* MAP — full screen */}
      {location ? (
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={StyleSheet.absoluteFill}
          showsUserLocation
          showsMyLocationButton={false}
          initialRegion={{
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.04,
            longitudeDelta: 0.04,
          }}
        >
          {filteredPlaces.map((place) => (
            <Marker
              key={place.place_id}
              coordinate={{
                latitude: place.geometry.location.lat,
                longitude: place.geometry.location.lng,
              }}
              title={place.name}
              description={place.vicinity}
              pinColor={
                selectedPlace?.place_id === place.place_id ? PURPLE : "#3B82F6"
              }
              onPress={() => focusPlace(place)}
            />
          ))}
        </MapView>
      ) : (
        <View style={styles.mapLoading}>
          <ActivityIndicator size="large" color={PURPLE} />
        </View>
      )}

      {/* TOP BAR — search + profile button */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.searchBar}
          onPress={() => router.push("/diagnose")}
          activeOpacity={0.88}
        >
          <MaterialIcons name="healing" size={20} color={PURPLE} />
          <Text style={styles.searchHint}>Enter symptoms…</Text>
          <MaterialIcons name="mic" size={18} color="#94A3B8" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.profileBtn}
          onPress={() => router.push("/(tabs)/profile")}
          activeOpacity={0.82}
        >
          {avatarUrl ? (
            <Image
              source={{ uri: avatarUrl }}
              style={styles.profileAvatar}
            />
          ) : avatarInitials ? (
            <View style={styles.profileInitials}>
              <Text style={styles.profileInitialsText}>{avatarInitials}</Text>
            </View>
          ) : (
            <MaterialIcons name="account-circle" size={30} color={PURPLE} />
          )}
        </TouchableOpacity>
      </View>

      {/* MAP CONTROLS — fixed right side */}
      <View style={styles.mapControls}>
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={() =>
            location &&
            centerMap(location.coords.latitude, location.coords.longitude)
          }
          activeOpacity={0.75}
        >
          <MaterialIcons name="my-location" size={22} color={PURPLE} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.controlBtn, { marginTop: 10 }]}
          onPress={() => handleZoom("in")}
          activeOpacity={0.75}
        >
          <MaterialIcons name="add" size={22} color={PURPLE} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.controlBtn, { marginTop: 10 }]}
          onPress={() => handleZoom("out")}
          activeOpacity={0.75}
        >
          <MaterialIcons name="remove" size={22} color={PURPLE} />
        </TouchableOpacity>
      </View>

      {/* EMERGENCY PILL — fixed just above sheet peek */}
      <View
        style={[styles.emergencyWrapper, { bottom: SHEET_PEEK + 10 }]}
        pointerEvents="box-none"
      >
        <TouchableOpacity
          style={styles.emergencyPill}
          onPress={() => Linking.openURL("tel:911")}
          activeOpacity={0.85}
        >
          <MaterialIcons name="error-outline" size={14} color={RED_URGENT} />
          <Text style={styles.emergencyText}>Life-threatening? </Text>
          <Text style={styles.emergencyCall}>Call 911</Text>
        </TouchableOpacity>
      </View>

      {/* BOTTOM SHEET */}
      <Animated.View
        style={[styles.sheet, { transform: [{ translateY }] }]}
      >
        {/* ── Drag handle (pan responder lives here only) ── */}
        <View {...panResponder.panHandlers} style={styles.handleArea}>
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.sheetTitle}>
                {loadingPlaces
                  ? "Finding nearby…"
                  : `${filteredPlaces.length} Facilities`}
              </Text>
              {!loadingPlaces && activeFilter !== "all" && (
                <Text style={styles.sheetSub}>
                  {places.length} total · {activeFilter}
                </Text>
              )}
            </View>
            <View style={styles.headerRight}>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={updateLocation}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <MaterialIcons name="refresh" size={20} color={PURPLE} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => snapTo(!isExpanded)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <MaterialIcons
                  name={isExpanded ? "keyboard-arrow-down" : "keyboard-arrow-up"}
                  size={26}
                  color={PURPLE}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Filter chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
            style={styles.filterScroll}
          >
            {FILTERS.map((f) => {
              const count =
                f.key === "all"
                  ? places.length
                  : places.filter((p) => p.amenity === f.key).length;
              const active = activeFilter === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  onPress={() => setActiveFilter(f.key)}
                  activeOpacity={0.8}
                >
                  <MaterialIcons
                    name={f.icon as any}
                    size={12}
                    color={active ? "#fff" : PURPLE}
                  />
                  <Text
                    style={[
                      styles.filterChipText,
                      active && styles.filterChipTextActive,
                    ]}
                  >
                    {f.label}
                  </Text>
                  {count > 0 && (
                    <View
                      style={[
                        styles.filterBadge,
                        active && styles.filterBadgeActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.filterBadgeText,
                          active && styles.filterBadgeTextActive,
                        ]}
                      >
                        {count}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* ── Content area ── */}
        {loadingPlaces ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={PURPLE} />
            <Text style={styles.loadingLabel}>Searching nearby facilities…</Text>
          </View>
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.expandedList}
            showsVerticalScrollIndicator={false}
          >
            {filteredPlaces.length === 0 ? (
              <Text style={styles.emptyText}>No facilities found for this filter.</Text>
            ) : (
              filteredPlaces.map((item) => renderRowCard(item))
            )}
          </ScrollView>
        )}
      </Animated.View>
    </View>
  );
}


// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },

  mapLoading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: APP_BG_COLOR,
  },

  // Top bar
  topBar: {
    position: "absolute",
    top: Platform.OS === "ios" ? 58 : 46,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 5,
  },
  searchHint: { flex: 1, fontSize: 15, color: "#94A3B8" },
  profileBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 5,
    overflow: "hidden",
  },
  profileAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  profileInitials: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#EDE9FE",
    justifyContent: "center",
    alignItems: "center",
  },
  profileInitialsText: {
    color: PURPLE,
    fontSize: 16,
    fontWeight: "800",
  },

  // Map controls
  mapControls: {
    position: "absolute",
    right: 16,
    bottom: SHEET_PEEK + 60,
  },
  controlBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 4,
  },

  // Emergency pill
  emergencyWrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  emergencyPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF1F2",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "#FECDD3",
    gap: 5,
    shadowColor: RED_URGENT,
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 4,
  },
  emergencyText: { fontSize: 13, color: "#64748B" },
  emergencyCall: { fontSize: 13, color: RED_URGENT, fontWeight: "800" },

  // Bottom sheet
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_HEIGHT,
    backgroundColor: "#F7F8FC",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 14,
    overflow: "hidden",
  },
  handleArea: {
    backgroundColor: "#fff",
    paddingTop: 10,
    paddingBottom: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#CBD5E1",
    alignSelf: "center",
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  sheetTitle: { fontSize: 17, fontWeight: "800", color: "#0F172A", letterSpacing: -0.3 },
  sheetSub: { fontSize: 12, color: "#94A3B8", marginTop: 1 },
  headerRight: { flexDirection: "row", alignItems: "center" },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F1F5F9",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 6,
  },

  // Filter chips
  filterScroll: {
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  filterRow: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    paddingTop: 2,
    gap: 7,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 5,
  },
  filterChipActive: { backgroundColor: PURPLE },
  filterChipText: { fontSize: 12, color: "#475569", fontWeight: "600" },
  filterChipTextActive: { color: "#fff" },
  filterBadge: {
    backgroundColor: "rgba(71,85,105,0.15)",
    borderRadius: 9,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: "center",
  },
  filterBadgeActive: { backgroundColor: "rgba(255,255,255,0.28)" },
  filterBadgeText: { fontSize: 10, color: "#475569", fontWeight: "700" },
  filterBadgeTextActive: { color: "#fff" },

  // Loading / empty states
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 32,
  },
  loadingLabel: { fontSize: 14, color: "#94A3B8" },
  emptyText: { textAlign: "center", color: "#94A3B8", marginTop: 40, fontSize: 14 },

  // ── List cards ────────────────────────────────────────────────────────────
  expandedList: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 36, gap: 10 },
  listCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 16,
    shadowColor: "#64748B",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 10,
    elevation: 3,
  },
  listCardSelected: {
    shadowColor: PURPLE,
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 5,
  },
  listTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    marginBottom: 12,
  },
  listIcon: {
    width: 50,
    height: 50,
    borderRadius: 15,
    backgroundColor: "#EDE9FE",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  listIconSelected: { backgroundColor: PURPLE },
  listInfo: { flex: 1 },
  listTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 4,
  },
  listName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.2,
    lineHeight: 20,
  },
  listDist: { fontSize: 12, color: "#94A3B8", fontWeight: "600", marginTop: 2 },
  listMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  listType: {
    fontSize: 12,
    color: "#64748B",
    fontWeight: "600",
    textTransform: "capitalize",
  },
  listMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    marginBottom: 2,
    flexWrap: "wrap",
  },
  waitBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  waitText: {
    fontSize: 12,
    fontWeight: "800",
  },
  waitLabel: {
    fontSize: 11,
    fontWeight: "500",
    opacity: 0.8,
  },
  listDetailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flex: 1,
    minWidth: 0,
  },
  listDetailText: {
    fontSize: 12,
    color: "#64748B",
    flex: 1,
    lineHeight: 16,
  },

  moreInfoBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PURPLE,
    borderRadius: 100,
    paddingVertical: 10,
    marginTop: 12,
    gap: 6,
  },
  moreInfoText: { color: "#fff", fontSize: 13, fontWeight: "700" },
});
