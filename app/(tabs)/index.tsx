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
  FlatList,
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

// ── Overpass API ──────────────────────────────────────────────────────────────
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

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

// ── OSM amenity tag → FilterKey ───────────────────────────────────────────────
const OSM_AMENITY_MAP: Record<string, FilterKey> = {
  hospital: "hospital",
  clinic: "clinic",
  doctors: "doctors",
  dentist: "dentist",
  pharmacy: "pharmacy",
  medical_centre: "clinic",
  health_post: "clinic",
  health_centre: "clinic",
};

// ── Build Overpass QL query ───────────────────────────────────────────────────
function buildOverpassQuery(lat: number, lon: number, radiusM: number): string {
  const amenities = Object.keys(OSM_AMENITY_MAP).join("|");
  return `
[out:json][timeout:25];
(
  node["amenity"~"^(${amenities})$"](around:${radiusM},${lat},${lon});
  way["amenity"~"^(${amenities})$"](around:${radiusM},${lat},${lon});
  relation["amenity"~"^(${amenities})$"](around:${radiusM},${lat},${lon});
);
out center;
`.trim();
}

// ── Parse a single OSM element into NearbyPlace ───────────────────────────────
function parseOsmElement(
  el: any,
  userLat: number,
  userLon: number,
): NearbyPlace | null {
  const tags = el.tags ?? {};
  const amenityRaw: string = tags.amenity ?? "";
  const amenity: FilterKey = OSM_AMENITY_MAP[amenityRaw] ?? "clinic";
  const name: string = tags.name ?? tags["name:en"] ?? amenityRaw;
  if (!name) return null;

  // Coordinates: nodes have direct lat/lon, ways/relations have center
  let lat: number;
  let lon: number;
  if (el.type === "node") {
    lat = el.lat;
    lon = el.lon;
  } else if (el.center) {
    lat = el.center.lat;
    lon = el.center.lon;
  } else {
    return null;
  }

  // Address
  const addrParts: string[] = [];
  if (tags["addr:housenumber"] && tags["addr:street"]) {
    addrParts.push(`${tags["addr:housenumber"]} ${tags["addr:street"]}`);
  } else if (tags["addr:street"]) {
    addrParts.push(tags["addr:street"]);
  }
  if (tags["addr:city"]) addrParts.push(tags["addr:city"]);
  if (tags["addr:state"]) addrParts.push(tags["addr:state"]);
  if (tags["addr:postcode"]) addrParts.push(tags["addr:postcode"]);
  const vicinity = addrParts.join(", ") || "Address unavailable";

  const phone: string | undefined =
    tags.phone ?? tags["contact:phone"] ?? undefined;
  const website: string | undefined =
    tags.website ?? tags["contact:website"] ?? undefined;
  const hoursRaw: string | undefined = tags.opening_hours ?? undefined;

  const open_now = parseOpenNow(hoursRaw);
  const hours_display = hoursRaw;

  return {
    place_id: `osm-${el.type}-${el.id}`,
    name,
    vicinity,
    phone,
    website,
    open_now,
    hours_display,
    geometry: { location: { lat, lng: lon } },
    amenity,
    detailsFetched: true,
  };
}

// ── Basic opening_hours parser ────────────────────────────────────────────────
// Handles "24/7" and common patterns like "Mo-Fr 08:00-18:00; Sa 09:00-13:00"
function parseOpenNow(ohStr: string | undefined): boolean | undefined {
  if (!ohStr) return undefined;
  if (ohStr.trim() === "24/7") return true;

  const now = new Date();
  const dayOrder = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  // getDay(): 0=Sun … 6=Sat — remap to dayOrder indices
  const todayIdx = [6, 0, 1, 2, 3, 4, 5][now.getDay()];
  const nowMins = now.getHours() * 60 + now.getMinutes();

  const rules = ohStr.split(";").map((s) => s.trim());
  for (const rule of rules) {
    // "Mo-Fr 08:00-18:00" or "Sa 09:00-13:00"
    const m = rule.match(
      /^([A-Za-z]{2})(?:-([A-Za-z]{2}))?\s+(\d{2}:\d{2})-(\d{2}:\d{2})$/,
    );
    if (!m) continue;
    const [, d1, d2, tOpen, tClose] = m;
    const startIdx = dayOrder.indexOf(d1);
    const endIdx = d2 ? dayOrder.indexOf(d2) : startIdx;
    if (startIdx < 0 || endIdx < 0) continue;

    const inDay =
      startIdx <= endIdx
        ? todayIdx >= startIdx && todayIdx <= endIdx
        : todayIdx >= startIdx || todayIdx <= endIdx; // wrap e.g. Fr-Mo
    if (!inDay) continue;

    const [oh, om] = tOpen.split(":").map(Number);
    const [ch, cm] = tClose.split(":").map(Number);
    if (nowMins >= oh * 60 + om && nowMins < ch * 60 + cm) return true;
  }
  return false;
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

// ── Fetch nearby medical facilities via Overpass + OSM ────────────────────────
async function fetchNearbyFacilities(
  lat: number,
  lon: number,
  radiusMeters = 5000,
): Promise<NearbyPlace[]> {
  const query = buildOverpassQuery(lat, lon, radiusMeters);
  console.log("Fetching from Overpass API...");

  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!res.ok) {
      console.error("Overpass request failed:", res.status);
      return [];
    }

    const json = await res.json();
    const elements: any[] = json.elements ?? [];

    // Parse elements and drop nulls
    const parsed: NearbyPlace[] = elements
      .map((el) => parseOsmElement(el, lat, lon))
      .filter((p): p is NearbyPlace => p !== null);

    // Deduplicate: same name within ~100 m grid cell (0.001° ≈ 111 m)
    const seen = new Set<string>();
    const deduped = parsed.filter((p) => {
      const gridLat = Math.round(p.geometry.location.lat / 0.001);
      const gridLon = Math.round(p.geometry.location.lng / 0.001);
      const key = `${p.name.toLowerCase()}|${gridLat}|${gridLon}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by distance (closest first)
    deduped.sort((a, b) => {
      const dA =
        (a.geometry.location.lat - lat) ** 2 +
        (a.geometry.location.lng - lon) ** 2;
      const dB =
        (b.geometry.location.lat - lat) ** 2 +
        (b.geometry.location.lng - lon) ** 2;
      return dA - dB;
    });

    return deduped;
  } catch (err) {
    console.error("Overpass fetch error:", err);
    return [];
  }
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

  // Force dark (light-icon) status bar every time this screen gains focus,
  // overriding whatever another screen may have set while we were away.
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle("light");
    }, []),
  );

  useEffect(() => {
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
  }, []);

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

  // ── Action helpers ────────────────────────────────────────────────────────
  const callPlace = (phone: string) =>
    Linking.openURL(`tel:${phone.replace(/\s+/g, "")}`);

  const directionsTo = (place: NearbyPlace) => {
    const { lat, lng } = place.geometry.location;
    const url = Platform.select({
      ios: `maps:0,0?q=${encodeURIComponent(place.name)}&ll=${lat},${lng}`,
      android: `geo:${lat},${lng}?q=${encodeURIComponent(place.name)}`,
    });
    if (url) Linking.openURL(url);
  };

  const openWebsite = (url: string) =>
    Linking.openURL(url.startsWith("http") ? url : `https://${url}`);

  // ── Expanded list card ────────────────────────────────────────────────────
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
        {/* Top: icon + primary info */}
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
              <Text style={styles.listName} numberOfLines={1}>
                {item.name}
              </Text>
              {!!dist && <Text style={styles.listDist}>{dist}</Text>}
            </View>

            {/* Type + status inline */}
            <View style={styles.listMeta}>
              <Text style={styles.listType}>{item.amenity}</Text>
              {item.open_now !== undefined && (
                <>
                  <Text style={styles.listMetaDot}>·</Text>
                  <View style={listStatusDot(item.open_now)} />
                  <Text
                    style={[
                      styles.listStatusText,
                      { color: item.open_now ? "#16A34A" : "#DC2626" },
                    ]}
                  >
                    {item.open_now ? "Open" : "Closed"}
                  </Text>
                </>
              )}
            </View>
          </View>
        </View>

        {/* Detail rows */}
        {(item.vicinity !== "Address unavailable" || item.phone || item.hours_display) && (
          <View style={styles.listDetails}>
            {item.vicinity !== "Address unavailable" && (
              <View style={styles.listDetailRow}>
                <MaterialIcons name="location-on" size={13} color="#94A3B8" />
                <Text style={styles.listDetailText} numberOfLines={1}>
                  {item.vicinity}
                </Text>
              </View>
            )}
            {item.phone ? (
              <TouchableOpacity
                style={styles.listDetailRow}
                onPress={() => callPlace(item.phone!)}
                activeOpacity={0.7}
              >
                <MaterialIcons name="phone" size={13} color={PURPLE} />
                <Text style={[styles.listDetailText, { color: PURPLE }]} numberOfLines={1}>
                  {item.phone}
                </Text>
              </TouchableOpacity>
            ) : null}
            {item.hours_display ? (
              <View style={styles.listDetailRow}>
                <MaterialIcons name="schedule" size={13} color="#94A3B8" />
                <Text style={styles.listDetailText} numberOfLines={1}>
                  {item.hours_display}
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {/* Action footer */}
        <View style={styles.listFooter}>
          <TouchableOpacity
            style={styles.listActionPrimary}
            onPress={() => directionsTo(item)}
            activeOpacity={0.82}
          >
            <MaterialIcons name="directions" size={15} color="#fff" />
            <Text style={styles.listActionPrimaryText}>Directions</Text>
          </TouchableOpacity>
          {item.phone ? (
            <TouchableOpacity
              style={styles.listActionSecondary}
              onPress={() => callPlace(item.phone!)}
              activeOpacity={0.82}
            >
              <MaterialIcons name="call" size={15} color={PURPLE} />
              <Text style={styles.listActionSecondaryText}>Call</Text>
            </TouchableOpacity>
          ) : null}
          {item.website ? (
            <TouchableOpacity
              style={styles.listActionSecondary}
              onPress={() => openWebsite(item.website!)}
              activeOpacity={0.82}
            >
              <MaterialIcons name="language" size={15} color={PURPLE} />
              <Text style={styles.listActionSecondaryText}>Website</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  // ── Compact horizontal card (collapsed peek) ──────────────────────────────
  const renderCompactCard = useCallback(
    ({ item }: { item: NearbyPlace }) => {
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
          style={[styles.card, isSelected && styles.cardSelected]}
          onPress={() => focusPlace(item)}
          activeOpacity={0.88}
        >
          {/* Type label */}
          <Text style={styles.cardType}>{item.amenity.toUpperCase()}</Text>

          {/* Icon + name block */}
          <View style={styles.cardIconRow}>
            <View style={[styles.cardIconBadge, isSelected && styles.cardIconBadgeSelected]}>
              <MaterialIcons
                name={facilityIcon(item.amenity)}
                size={22}
                color={isSelected ? "#fff" : PURPLE}
              />
            </View>
            <Text style={styles.cardName} numberOfLines={2}>
              {item.name}
            </Text>
          </View>

          {/* Distance + status */}
          <View style={styles.cardStatusRow}>
            {!!dist && (
              <View style={styles.cardDistBadge}>
                <MaterialIcons name="near-me" size={11} color="#64748B" />
                <Text style={styles.cardDistText}>{dist}</Text>
              </View>
            )}
            {item.open_now !== undefined && (
              <View style={cardOpenBadge(item.open_now)}>
                <View style={cardOpenDot(item.open_now)} />
                <Text style={cardOpenText(item.open_now)}>
                  {item.open_now ? "Open" : "Closed"}
                </Text>
              </View>
            )}
          </View>

          {/* Divider + actions */}
          <View style={styles.cardDivider} />
          <View style={styles.cardActions}>
            <TouchableOpacity
              style={styles.cardPrimaryBtn}
              onPress={() => directionsTo(item)}
              activeOpacity={0.82}
            >
              <MaterialIcons name="directions" size={14} color="#fff" />
              <Text style={styles.cardPrimaryBtnText}>Directions</Text>
            </TouchableOpacity>
            {item.phone ? (
              <TouchableOpacity
                style={styles.cardIconBtn}
                onPress={() => callPlace(item.phone!)}
                activeOpacity={0.82}
              >
                <MaterialIcons name="call" size={16} color={PURPLE} />
              </TouchableOpacity>
            ) : null}
          </View>
        </TouchableOpacity>
      );
    },
    [selectedPlace, location, focusPlace],
  );

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
        ) : isExpanded ? (
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
        ) : (
          <FlatList
            data={filteredPlaces}
            keyExtractor={(item) => item.place_id}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.cardList}
            renderItem={renderCompactCard}
            windowSize={5}
            maxToRenderPerBatch={6}
            initialNumToRender={4}
            removeClippedSubviews
          />
        )}
      </Animated.View>
    </View>
  );
}

// ── Dynamic style helpers ─────────────────────────────────────────────────────
const cardOpenBadge = (open: boolean) => ({
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 4,
  backgroundColor: open ? "#F0FDF4" : "#FEF2F2",
  paddingHorizontal: 7,
  paddingVertical: 3,
  borderRadius: 100,
});
const cardOpenDot = (open: boolean) => ({
  width: 6,
  height: 6,
  borderRadius: 3,
  backgroundColor: open ? "#16A34A" : "#DC2626",
});
const cardOpenText = (open: boolean) => ({
  fontSize: 11,
  fontWeight: "700" as const,
  color: open ? "#16A34A" : "#DC2626",
});
const listStatusDot = (open: boolean) => ({
  width: 6,
  height: 6,
  borderRadius: 3,
  backgroundColor: open ? "#16A34A" : "#DC2626",
});

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

  // ── Compact horizontal cards (collapsed peek) ─────────────────────────────
  cardList: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 10,
  },
  card: {
    width: 200,
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 14,
    shadowColor: "#64748B",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 10,
    elevation: 3,
  },
  cardSelected: {
    shadowColor: PURPLE,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 5,
  },
  cardType: {
    fontSize: 10,
    fontWeight: "700",
    color: PURPLE,
    letterSpacing: 1.2,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  cardIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  cardIconBadge: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: "#EDE9FE",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  cardIconBadgeSelected: { backgroundColor: PURPLE },
  cardName: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
    lineHeight: 19,
  },
  cardStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
  },
  cardDistBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 100,
  },
  cardDistText: { fontSize: 11, color: "#64748B", fontWeight: "600" },
  cardDivider: {
    height: 1,
    backgroundColor: "#F1F5F9",
    marginBottom: 10,
  },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardPrimaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PURPLE,
    borderRadius: 100,
    paddingVertical: 8,
    gap: 5,
  },
  cardPrimaryBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  cardIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#EDE9FE",
    justifyContent: "center",
    alignItems: "center",
  },

  // ── Expanded list cards ────────────────────────────────────────────────────
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
  listMetaDot: { fontSize: 12, color: "#CBD5E1" },
  listStatusText: { fontSize: 12, fontWeight: "700" },

  listDetails: {
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
    paddingTop: 10,
    marginBottom: 12,
    gap: 6,
  },
  listDetailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  listDetailText: {
    fontSize: 13,
    color: "#475569",
    flex: 1,
    lineHeight: 18,
  },

  listFooter: {
    flexDirection: "row",
    gap: 8,
  },
  listActionPrimary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PURPLE,
    borderRadius: 100,
    paddingVertical: 10,
    gap: 6,
  },
  listActionPrimaryText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  listActionSecondary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    borderRadius: 100,
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 5,
  },
  listActionSecondaryText: { color: PURPLE, fontSize: 13, fontWeight: "700" },
});
