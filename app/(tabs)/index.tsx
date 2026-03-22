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
  Modal,
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
import { DiagnoseContent } from "../diagnose";

const { width, height } = Dimensions.get("window");

const APP_BG_COLOR = "#0F172A";
const CARD_BG = "#1E293B";
const BORDER_COLOR = "#334155";
const PURPLE = "#7C3AED";
const RED_URGENT = "#EF4444";

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
  | "pharmacy";

const FILTERS: { key: FilterKey; label: string; icon: string }[] = [
  { key: "all", label: "All", icon: "local-hospital" },
  { key: "hospital", label: "Hospitals", icon: "local-hospital" },
  { key: "clinic", label: "Clinics", icon: "healing" },
  { key: "pharmacy", label: "Pharmacy", icon: "medication" },
];

// ── Types ─────────────────────────────────────────────────────────────────────
interface NearbyPlace {
  place_id: string;
  name: string;
  vicinity: string;
  zip?: string;
  houseNumber?: string;
  street?: string;
  phone?: string;
  website?: string;
  wikidataId?: string;
  open_now?: boolean;
  hours_display?: string;
  isMockPhone?: boolean;
  isMockHours?: boolean;
  geometry: { location: { lat: number; lng: number } };
  amenity: FilterKey;
  detailsFetched: boolean;
}

// ── OSM amenity → FilterKey ───────────────────────────────────────────────────
const OSM_AMENITY_MAP: Record<string, FilterKey> = {
  hospital: "hospital",
  clinic: "clinic",
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
  const normalized = normalizeToOsmHours(raw);

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

  let anyRuleParsed = false;
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

    anyRuleParsed = true;
  }

  // Rules exist but none apply today → place is closed today; still show something
  if (anyRuleParsed) {
    return { open_now: false, hours_display: "Closed today" };
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

  // Check tags in priority order, then fall back to free-text extraction
  const rawHours =
    tags.opening_hours ??
    tags["opening_hours:covid19"] ??
    tags.service_times ??
    tags.hours ??
    tags["business:hours"] ??
    tags["contact:hours"] ??
    extractHoursFromText(tags.description) ??
    extractHoursFromText(tags.note);
  const { open_now, hours_display } = parseOpeningHours(rawHours);

  return {
    place_id: `osm-${el.type}-${el.id}`,
    name,
    vicinity,
    zip: tags["addr:postcode"] ?? undefined,
    houseNumber: tags["addr:housenumber"] ?? undefined,
    street: tags["addr:street"] ?? undefined,
    wikidataId: tags.wikidata ?? undefined,
    phone: tags.phone ?? tags["contact:phone"] ?? tags["contact:mobile"] ?? tags["phone:mobile"] ?? undefined,
    website: tags.website ?? tags["contact:website"] ?? undefined,
    open_now,
    hours_display,
    geometry: { location: { lat, lng } },
    amenity,
    detailsFetched: true,
  };
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


// ── Batch-fetch opening_hours for places that missed it ──────────────────────
// Issues a single Overpass query using element IDs instead of per-element calls.
async function fetchHoursFallback(
  missing: NearbyPlace[],
): Promise<Map<string, string>> {
  const byType: Record<string, string[]> = { node: [], way: [], relation: [] };
  for (const p of missing) {
    const parts = p.place_id.split("-"); // "osm-node-12345"
    if (parts.length >= 3 && byType[parts[1]]) byType[parts[1]].push(parts[2]);
  }

  const unions = (Object.entries(byType) as [string, string[]][])
    .filter(([, ids]) => ids.length > 0)
    .map(([type, ids]) => `${type}(id:${ids.join(",")});`)
    .join("\n  ");

  if (!unions) return new Map();

  const query = `[out:json][timeout:20];\n(\n  ${unions}\n);\nout;`;
  const body = `data=${encodeURIComponent(query)}`;
  const timeout = (ms: number) =>
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));

  const result = new Map<string, string>();
  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const res = await Promise.race([
        fetch(mirror, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        }),
        timeout(15000),
      ]);
      if (!res.ok) continue;
      const json = await res.json();
      for (const el of json.elements ?? []) {
        const t = el.tags ?? {};
        const hours =
          t.opening_hours ??
          t["opening_hours:covid19"] ??
          t.service_times ??
          t.hours ??
          t["business:hours"] ??
          t["contact:hours"] ??
          extractHoursFromText(t.description) ??
          extractHoursFromText(t.note);
        if (hours) result.set(`osm-${el.type}-${el.id}`, hours);
      }
      return result;
    } catch {}
  }
  return result;
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

// ── Dark map style (matches #0F172A / #1E293B palette) ───────────────────────
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

// ── Name / distance helpers (used for Wikidata matching) ─────────────────────
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function metersBetween(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371000;
  const dLat = ((la2 - la1) * Math.PI) / 180;
  const dLon = ((lo2 - lo1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((la1 * Math.PI) / 180) * Math.cos((la2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Hours string normalizer ───────────────────────────────────────────────────
// Converts English-language hours text into OSM opening_hours format so the
// existing parser can handle it: "Mon-Fri 8am-5pm" → "Mo-Fr 08:00-17:00"
function normalizeToOsmHours(raw: string): string {
  let s = raw.trim();

  // Full/short English day names → OSM abbreviations
  const DAY_MAP: Record<string, string> = {
    monday: "Mo", tuesday: "Tu", wednesday: "We", thursday: "Th",
    friday: "Fr", saturday: "Sa", sunday: "Su",
    mon: "Mo", tue: "Tu", wed: "We", thu: "Th",
    fri: "Fr", sat: "Sa", sun: "Su",
  };
  s = s.replace(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/gi,
    (m) => DAY_MAP[m.toLowerCase()] ?? m,
  );

  // "daily" / "every day" / "weekdays" / "weekends"
  s = s.replace(/\b(daily|every day)\b/gi, "Mo-Su");
  s = s.replace(/\bweekdays\b/gi, "Mo-Fr");
  s = s.replace(/\bweekends?\b/gi, "Sa-Su");

  // "through" / "thru" between day/time tokens → "-"
  s = s.replace(/\s+(?:through|thru)\s+/gi, "-");

  // Em dash / en dash / middle dot used as range separator (common in Google results)
  s = s.replace(/\s*[–—·]\s*/g, "-");

  // 12-hour → 24-hour: "9:00 AM" / "9am" / "9:00am"
  s = s.replace(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi, (_, h, m, ampm) => {
    let hour = parseInt(h, 10);
    const min = parseInt(m ?? "0", 10);
    if (ampm.toLowerCase() === "pm" && hour !== 12) hour += 12;
    if (ampm.toLowerCase() === "am" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  });

  // Named times
  s = s.replace(/\bnoon\b/gi, "12:00");
  s = s.replace(/\bmidnight\b/gi, "00:00");

  // Bare hours without minutes: "09" → "09:00" (only when flanked by non-digits)
  s = s.replace(/\b(\d{2}):(\d{2})\b/g, (m) => m); // keep existing HH:MM
  s = s.replace(/(?<!\d)(\d{2})(?!:\d{2})(?!\d)/g, "$1:00");

  return s;
}

// ── Extract hours from free-form description / note fields ───────────────────
function extractHoursFromText(text: string | undefined): string | null {
  if (!text) return null;
  const n = normalizeToOsmHours(text);
  // Day-range + time-range pattern: "Mo-Fr 09:00-17:00"
  const full = n.match(/\b(Mo|Tu|We|Th|Fr|Sa|Su)[\w ,\-]*\d{2}:\d{2}-\d{2}:\d{2}/);
  if (full) return full[0].trim();
  // Time-range only: "09:00-17:00"
  const timeOnly = n.match(/\b\d{2}:\d{2}-\d{2}:\d{2}\b/);
  if (timeOnly) return timeOnly[0];
  return null;
}

// ── Wikidata SPARQL hours enrichment (free, no key required) ─────────────────
// Queries for nearby healthcare facilities that have P3025 (service time/hours).
// Returns a Map<normalizedName, {lat, lng, hours}> for matching against OSM places.
interface WDPlace { lat: number; lng: number; hours: string }

async function fetchWikidataHours(
  lat: number,
  lon: number,
  radiusKm: number,
): Promise<Map<string, WDPlace>> {
  // Healthcare facility types in Wikidata
  const sparql = `
SELECT DISTINCT ?item ?itemLabel ?lat ?lon ?hours WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${radiusKm}" .
  }
  ?item wdt:P3025 ?hours .
  BIND(geof:latitude(?coord) AS ?lat)
  BIND(geof:longitude(?coord) AS ?lon)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
LIMIT 60`.trim();

  try {
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
    const res = await Promise.race([
      fetch(url, {
        headers: {
          Accept: "application/sparql-results+json",
          "User-Agent": "MediMind/1.0 (healthcare app)",
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 12000)),
    ]);
    if (!res.ok) return new Map();
    const json = await res.json();
    const result = new Map<string, WDPlace>();
    for (const b of json.results?.bindings ?? []) {
      const name: string = b.itemLabel?.value ?? "";
      const hours: string = b.hours?.value ?? "";
      const la = parseFloat(b.lat?.value ?? "0");
      const lo = parseFloat(b.lon?.value ?? "0");
      if (name && hours && la && lo) {
        result.set(normalizeName(name), { lat: la, lng: lo, hours });
      }
    }
    return result;
  } catch {
    return new Map();
  }
}

// ── Insurance acceptance helper ───────────────────────────────────────────────
// Returns a badge descriptor or null (no insurance set / unknown).
type InsuranceBadge = { badge: "accepts" | "likely" | "verify"; label: string };

const MEDICAID_PLANS = ["amerigroup", "molina", "centene", "wellcare"];
const COMMERCIAL_PLANS = [
  "aetna", "anthem", "blue cross", "cigna", "humana", "oscar", "unitedhealthcare",
];

function checkInsurance(
  facilityName: string,
  type: FilterKey,
  insurance: string,
): InsuranceBadge | null {
  if (!insurance || insurance === "Other") return null;

  const n = facilityName.toLowerCase();
  const ins = insurance.toLowerCase();

  // Pharmacies accept virtually all insurance plans
  if (type === "pharmacy") {
    return { badge: "accepts", label: "Insurance Accepted" };
  }

  // Kaiser is a closed HMO — members only for non-emergency
  if (n.includes("kaiser")) {
    return ins.includes("kaiser")
      ? { badge: "accepts", label: "Insurance Accepted" }
      : { badge: "verify", label: "Kaiser Members Only" };
  }

  // Medicaid/managed-Medicaid plans have restricted networks
  if (MEDICAID_PLANS.some((p) => ins.includes(p))) {
    // Community/public health facilities typically accept Medicaid
    if (n.includes("community") || n.includes("public") || n.includes("county")) {
      return { badge: "accepts", label: "Insurance Accepted" };
    }
    return { badge: "verify", label: "Verify Coverage" };
  }

  // Major commercial plans — most established facilities participate
  if (COMMERCIAL_PLANS.some((p) => ins.includes(p))) {
    return { badge: "likely", label: "Likely Accepted" };
  }

  return { badge: "verify", label: "Verify Coverage" };
}

// ── NPI Registry phone lookup (CMS public API, no key required) ──────────────
// https://npiregistry.cms.hhs.gov/api/ — searches organization names in the
// National Provider Identifier registry and returns phone numbers.

const US_STATE_ABBR: Record<string, string> = {
  Alabama:"AL",Alaska:"AK",Arizona:"AZ",Arkansas:"AR",California:"CA",
  Colorado:"CO",Connecticut:"CT",Delaware:"DE",Florida:"FL",Georgia:"GA",
  Hawaii:"HI",Idaho:"ID",Illinois:"IL",Indiana:"IN",Iowa:"IA",Kansas:"KS",
  Kentucky:"KY",Louisiana:"LA",Maine:"ME",Maryland:"MD",Massachusetts:"MA",
  Michigan:"MI",Minnesota:"MN",Mississippi:"MS",Missouri:"MO",Montana:"MT",
  Nebraska:"NE",Nevada:"NV","New Hampshire":"NH","New Jersey":"NJ",
  "New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND",
  Ohio:"OH",Oklahoma:"OK",Oregon:"OR",Pennsylvania:"PA","Rhode Island":"RI",
  "South Carolina":"SC","South Dakota":"SD",Tennessee:"TN",Texas:"TX",
  Utah:"UT",Vermont:"VT",Virginia:"VA",Washington:"WA","West Virginia":"WV",
  Wisconsin:"WI",Wyoming:"WY","District of Columbia":"DC",
};

interface GeoAddress {
  houseNumber?: string;
  street?: string;
  city: string;
  state: string;
  zip?: string;
}

async function reverseGeocode(lat: number, lon: number): Promise<GeoAddress | null> {
  try {
    const res = await Promise.race([
      fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
        { headers: { "User-Agent": "MediMind/1.0" } },
      ),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
    ]);
    if (!res.ok) return null;
    const json = await res.json();
    const addr = json.address ?? {};
    const city = addr.city ?? addr.town ?? addr.village ?? addr.suburb ?? addr.county ?? "";
    const fullState: string = addr.state ?? "";
    const state = fullState.length === 2 ? fullState : (US_STATE_ABBR[fullState] ?? fullState.substring(0, 2).toUpperCase());
    if (!city || !state) return null;
    return {
      houseNumber: addr.house_number,
      street: addr.road,
      city,
      state,
      zip: addr.postcode,
    };
  } catch {
    return null;
  }
}

function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  return raw;
}

// ── Schema.org / JSON-LD website scraper ──────────────────────────────────────
// Fetches a facility's own website and extracts telephone + opening hours from
// structured data (JSON-LD). Most hospitals, clinics, and chain pharmacy store
// pages publish this for SEO — no API key needed.

// Chain homepages have no per-store data; skip them
const GENERIC_CHAIN_HOSTS = new Set([
  "cvs.com", "walgreens.com", "riteaid.com", "walmart.com",
  "target.com", "kroger.com", "costco.com", "samsclub.com",
]);
function isGenericChainUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    return GENERIC_CHAIN_HOSTS.has(host) && (u.pathname === "/" || u.pathname === "");
  } catch { return false; }
}

// Convert Schema.org openingHoursSpecification → OSM opening_hours string
function specToOsm(spec: any): string {
  const SHORT: Record<string, string> = {
    Monday: "Mo", Tuesday: "Tu", Wednesday: "We", Thursday: "Th",
    Friday: "Fr", Saturday: "Sa", Sunday: "Su",
  };
  const arr = Array.isArray(spec) ? spec : [spec];
  return arr.map((e: any) => {
    const rawDays = Array.isArray(e.dayOfWeek) ? e.dayOfWeek : [e.dayOfWeek];
    const days = rawDays
      .map((d: string) => {
        const key = String(d).split("/").pop() ?? d;
        return SHORT[key] ?? key.substring(0, 2);
      })
      .filter(Boolean)
      .join(",");
    return days && e.opens && e.closes ? `${days} ${e.opens}-${e.closes}` : "";
  }).filter(Boolean).join("; ");
}

async function fetchSchemaOrgData(
  url: string,
): Promise<{ phone?: string; hours?: string } | null> {
  if (isGenericChainUrl(url)) return null;
  try {
    const res = await Promise.race([
      fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
          "Accept": "text/html,application/xhtml+xml",
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
    ]);
    if (!res.ok) return null;
    const html = await res.text();

    // Parse every JSON-LD block in the page
    const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      try {
        const root = JSON.parse(m[1]);
        const nodes: any[] = Array.isArray(root)
          ? root
          : root["@graph"] ? root["@graph"] : [root];
        for (const node of nodes) {
          const phone =
            node.telephone ??
            node.contactPoint?.telephone ??
            (Array.isArray(node.contactPoint) ? node.contactPoint[0]?.telephone : undefined);
          let hours: string | undefined;
          if (typeof node.openingHours === "string") {
            hours = node.openingHours;
          } else if (Array.isArray(node.openingHours)) {
            hours = node.openingHours.join("; ");
          } else if (node.openingHoursSpecification) {
            hours = specToOsm(node.openingHoursSpecification) || undefined;
          }
          if (phone || hours) {
            return { phone: phone ? formatPhone(String(phone)) : undefined, hours };
          }
        }
      } catch {}
    }

    // Microdata meta-tag fallback
    const metaHit =
      html.match(/<meta[^>]+itemprop=["']telephone["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/content=["']([^"']+)["'][^>]+itemprop=["']telephone["']/i);
    if (metaHit?.[1]) return { phone: formatPhone(metaHit[1]) };

    return null;
  } catch { return null; }
}

// ── Wikidata entity batch lookup (P1329 = phone, P3025 = opening hours) ───────
// Many OSM elements carry a wikidata= tag; one SPARQL call fetches all of them.
async function fetchWikidataEntities(
  qids: string[],
): Promise<Map<string, { phone?: string; hours?: string }>> {
  if (qids.length === 0) return new Map();
  const values = qids.map((q) => `wd:${q}`).join(" ");
  const sparql = `SELECT ?item ?phone ?hours WHERE {
  VALUES ?item { ${values} }
  OPTIONAL { ?item wdt:P1329 ?phone . }
  OPTIONAL { ?item wdt:P3025 ?hours . }
}`;
  try {
    const res = await Promise.race([
      fetch(
        `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`,
        { headers: { Accept: "application/sparql-results+json", "User-Agent": "MediMind/1.0" } },
      ),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
    ]);
    if (!res.ok) return new Map();
    const json = await res.json();
    const result = new Map<string, { phone?: string; hours?: string }>();
    for (const b of json.results?.bindings ?? []) {
      const qid: string = b.item?.value?.split("/").pop() ?? "";
      if (!qid) continue;
      const existing = result.get(qid) ?? {};
      result.set(qid, {
        phone: existing.phone ?? (b.phone?.value ? formatPhone(b.phone.value) : undefined),
        hours: existing.hours ?? b.hours?.value,
      });
    }
    return result;
  } catch { return new Map(); }
}

// ── Expand common US street abbreviations for address comparison ───────────────
function normalizeAddr(s: string): string {
  return s.toLowerCase()
    .replace(/\bst\b/g, "street").replace(/\bave?\b/g, "avenue")
    .replace(/\bblvd\b/g, "boulevard").replace(/\brd\b/g, "road")
    .replace(/\bdr\b/g, "drive").replace(/\bln\b/g, "lane")
    .replace(/\bct\b/g, "court").replace(/\bpl\b/g, "place")
    .replace(/\bpkwy\b/g, "parkway").replace(/\bhwy\b/g, "highway")
    .replace(/\bsuite\b|\bste\b/g, "").replace(/\b#\d+\b/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

// Single batch request to Nominatim's lookup endpoint — resolves the precise
// street address of each OSM element by its element ID (not by coordinates),
// which is far more accurate than reverse geocoding for chain stores.
async function fetchOsmAddresses(
  places: NearbyPlace[],
): Promise<Map<string, { houseNumber?: string; street?: string; zip?: string }>> {
  const ids = places
    .flatMap((p) => {
      const parts = p.place_id.split("-"); // "osm-node-12345"
      if (parts.length < 3) return [];
      const prefix = ({ node: "N", way: "W", relation: "R" } as Record<string, string>)[parts[1]];
      return prefix ? [`${prefix}${parts[2]}`] : [];
    })
    .join(",");

  if (!ids) return new Map();

  try {
    const res = await Promise.race([
      fetch(
        `https://nominatim.openstreetmap.org/lookup?osm_ids=${ids}&format=json&addressdetails=1`,
        { headers: { "User-Agent": "MediMind/1.0" } },
      ),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
    ]);
    if (!res.ok) return new Map();
    const json: any[] = await res.json();
    const result = new Map<string, { houseNumber?: string; street?: string; zip?: string }>();
    for (const item of json) {
      const addr = item.address ?? {};
      result.set(`osm-${item.osm_type}-${item.osm_id}`, {
        houseNumber: addr.house_number,
        street: addr.road,
        zip: addr.postcode,
      });
    }
    return result;
  } catch {
    return new Map();
  }
}

async function fetchNpiPhones(
  places: NearbyPlace[],
  city: string,
  state: string,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  await Promise.all(
    places.slice(0, 20).map(async (p) => {
      try {
        // Scope NPI search narrowest-first: zip → city+state
        const params = new URLSearchParams({
          version: "2.1",
          enumeration_type: "NPI-2",
          limit: "20",
        });
        params.set("organization_name", p.name.substring(0, 50));
        if (p.zip) {
          params.set("postal_code", p.zip.substring(0, 5));
        } else {
          params.set("city", city);
          params.set("state", state);
        }

        const res = await Promise.race([
          fetch(`https://npiregistry.cms.hhs.gov/api/?${params}`, {
            headers: { Accept: "application/json" },
          }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
        ]);
        if (!res.ok) return;
        const json = await res.json();
        const npiResults: any[] = json.results ?? [];
        if (npiResults.length === 0) return;

        // Build our address string for scoring
        const osmAddr = normalizeAddr(`${p.houseNumber ?? ""} ${p.street ?? ""}`);
        const osmNum = osmAddr.split(" ")[0];
        const hasAddress = osmAddr.trim().length > 0 && /\d/.test(osmNum);

        const candidates: Array<{ phone: string; score: number }> = [];
        for (const r of npiResults) {
          const addrs: any[] = r.addresses ?? [];
          const locAddr = addrs.find((a) => a.address_purpose === "LOCATION") ?? addrs[0];
          if (!locAddr?.telephone_number) continue;

          let score = 0;
          if (hasAddress && locAddr.address_1) {
            const npiAddr = normalizeAddr(locAddr.address_1);
            const npiNum = npiAddr.split(" ")[0];
            // House number is the decisive signal — same street, different numbers
            if (osmNum === npiNum) score += 10;
            // Street name words add confidence
            const osmWords = osmAddr.split(" ").slice(1).filter((w) => w.length > 2);
            const npiWords = new Set(npiAddr.split(" "));
            for (const w of osmWords) if (npiWords.has(w)) score += 2;
          }
          candidates.push({ phone: formatPhone(locAddr.telephone_number), score });
        }

        if (candidates.length === 0) return;
        candidates.sort((a, b) => b.score - a.score);

        // Only use the result if:
        // - We have exactly one candidate (unambiguous), OR
        // - The top candidate scored positively (address confirmed it)
        // This prevents chain branches from all getting the same corporate number.
        if (candidates.length === 1 || candidates[0].score > 0) {
          result.set(p.place_id, candidates[0].phone);
        }
      } catch {}
    }),
  );

  return result;
}

// ── Google Search scraper (no API key) ───────────────────────────────────────
// Fetches the Google SERP for "<name> <address>" and extracts:
//   • Phone  — from the knowledge-panel "Call" tel: link (very stable)
//   • Hours  — from JSON-LD if present, then from day-name / time-range patterns
//              in the knowledge panel table
// Requests are made sequentially with a delay so Google doesn't rate-limit us.

// Decode HTML character entities so regex patterns match rendered text
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#8239;/g, " ")   // narrow no-break space (Google wraps times with this)
    .replace(/&#160;/g, " ")    // non-breaking space
    .replace(/&nbsp;/g, " ")
    .replace(/&#8211;/g, "–")   // en dash
    .replace(/&#8212;/g, "—")   // em dash
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")    // remaining numeric entities
    .replace(/&[a-z]{2,6};/g, " "); // remaining named entities
}

// ── Shared HTML scrape helper ─────────────────────────────────────────────────
async function scrapeHtml(url: string, tag: string): Promise<string | null> {
  try {
    const res = await Promise.race([
      fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "identity",
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
    ]);
    console.log(`[${tag}] ${res.status} ${res.url} (${res.headers.get("content-type") ?? "?"})`);
    if (!res.ok) return null;
    const html = await res.text();
    console.log(`[${tag}] HTML length: ${html.length}`);
    return html;
  } catch (e: any) {
    console.log(`[${tag}] fetch error: ${e?.message}`);
    return null;
  }
}

function extractPhone(html: string, tag: string): string | undefined {
  // tel: href (most reliable — used by both Bing and YP for the call button)
  const m = html.match(/href=["']tel:([^"']{7,20})["']/);
  if (m?.[1]) {
    const p = formatPhone(decodeURIComponent(m[1]));
    console.log(`[${tag}] phone via tel: href → ${p}`);
    return p;
  }
  // Fallback: bare US phone number in the HTML (e.g. YP renders "(310) 555-1234")
  const m2 = html.match(/\((\d{3})\)\s*(\d{3})-(\d{4})/);
  if (m2) {
    const p = `(${m2[1]}) ${m2[2]}-${m2[3]}`;
    console.log(`[${tag}] phone via bare number → ${p}`);
    return p;
  }
  console.log(`[${tag}] no phone found`);
  return undefined;
}

function extractHoursFromHtml(html: string, tag: string): string | undefined {
  const decoded = decodeHtmlEntities(html);

  // JSON-LD (Bing and YP both sometimes include structured data)
  const jldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jm: RegExpExecArray | null;
  while ((jm = jldRe.exec(html)) !== null) {
    try {
      const root = JSON.parse(jm[1]);
      const nodes: any[] = Array.isArray(root) ? root : root["@graph"] ? root["@graph"] : [root];
      for (const node of nodes) {
        if (typeof node.openingHours === "string") {
          console.log(`[${tag}] hours via JSON-LD string`);
          return node.openingHours;
        }
        if (Array.isArray(node.openingHours)) {
          console.log(`[${tag}] hours via JSON-LD array`);
          return node.openingHours.join("; ");
        }
        if (node.openingHoursSpecification) {
          const h = specToOsm(node.openingHoursSpecification);
          if (h) { console.log(`[${tag}] hours via JSON-LD spec`); return h; }
        }
      }
    } catch {}
  }

  // itemprop="openingHours" microdata
  const microMatch =
    decoded.match(/itemprop=["']openingHours["'][^>]*content=["']([^"']+)["']/i) ??
    decoded.match(/content=["']([^"']+)["'][^>]*itemprop=["']openingHours["']/i);
  if (microMatch?.[1]) {
    console.log(`[${tag}] hours via itemprop microdata`);
    return microMatch[1];
  }

  // Strip HTML tags so day + time aren't split across elements (e.g. <td>Monday</td><td>9 AM</td>)
  const stripped = decoded.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  // Full and abbreviated day names, AM/PM and 24h formats, "Closed", "Open 24 hours"
  const DAY_RE =
    /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)[\s:]*(?:\d{1,2}(?::\d{2})?\s*(?:AM|PM)\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM)|\d{2}:\d{2}\s*[-–—]\s*\d{2}:\d{2}|Open 24 hours|24 hours|Closed)/gi;
  const seen = new Set<string>();
  const matches: string[] = [];
  let dm: RegExpExecArray | null;
  DAY_RE.lastIndex = 0;
  while ((dm = DAY_RE.exec(stripped)) !== null) {
    const key = dm[0].split(/[\s:]/)[0].toLowerCase().substring(0, 3);
    if (!seen.has(key)) { seen.add(key); matches.push(dm[0]); }
  }
  console.log(`[${tag}] day matches (${matches.length}): ${matches.slice(0, 3).join(" | ")}`);
  if (matches.length >= 3) return matches.map((d) => normalizeToOsmHours(d)).join("; ");

  // Log context around "Monday" for debugging
  const idx = stripped.indexOf("Monday");
  if (idx !== -1) {
    console.log(`[${tag}] Monday ctx: "${stripped.substring(idx, idx + 100)}"`);
  } else {
    console.log(`[${tag}] "Monday" not found`);
  }
  return undefined;
}

// ── Bing search scraper ───────────────────────────────────────────────────────
// Bing renders its local-business knowledge panel server-side (needed for SEO),
// so the phone number and hours are present in the initial HTML response.
async function fetchBingData(
  name: string,
  addressLine: string,
): Promise<{ phone?: string; hours?: string } | null> {
  const q = `${name} ${addressLine}`.trim();
  console.log(`[Bing] query: "${q}"`);
  const url = `https://www.bing.com/search?q=${encodeURIComponent(q)}&mkt=en-US&setlang=en-US`;
  const raw = await scrapeHtml(url, "Bing");
  if (!raw || raw.length < 5000) return null;

  const phone = extractPhone(raw, "Bing");
  const hours = extractHoursFromHtml(raw, "Bing");
  console.log(`[Bing] result: phone=${phone ?? "—"} hours=${hours ? hours.slice(0, 40) : "—"}`);
  return phone || hours ? { phone, hours } : null;
}

// ── Yellow Pages scraper ──────────────────────────────────────────────────────
// Yellow Pages is a purpose-built US business directory — fully server-side
// rendered, phone numbers always in the initial HTML, great coverage for
// pharmacies, clinics, and hospitals.
async function fetchYellowPagesData(
  name: string,
  city: string,
  state: string,
): Promise<{ phone?: string; hours?: string } | null> {
  const params = new URLSearchParams({
    search_terms: name,
    geo_location_terms: `${city}, ${state}`,
  });
  const url = `https://www.yellowpages.com/search?${params}`;
  console.log(`[YP] query: "${name}" in "${city}, ${state}"`);
  const raw = await scrapeHtml(url, "YP");
  if (!raw || raw.length < 5000) return null;

  // YP renders the first (most relevant) result's phone inside the listing card.
  // The primary phone link always has class="phone primary" or just appears first.
  const phone = extractPhone(raw, "YP");
  const hours = extractHoursFromHtml(raw, "YP");
  console.log(`[YP] result: phone=${phone ?? "—"} hours=${hours ? hours.slice(0, 40) : "—"}`);
  return phone || hours ? { phone, hours } : null;
}

// ── Facility icon helper ──────────────────────────────────────────────────────
function facilityIcon(amenity: FilterKey): any {
  if (amenity === "hospital") return "local-hospital";
  if (amenity === "pharmacy") return "medication";
  return "healing";
}

// ── Mock data fallback ────────────────────────────────────────────────────────
// Fills in phone and hours for any place that has no real data yet.
// Uses a deterministic hash of place_id so the same place always gets the same
// mock number, and reasonable hours by facility type.
function applyMockData(places: NearbyPlace[]): NearbyPlace[] {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0=Sun … 6=Sat

  return places.map((p) => {
    let updated = p;

    if (!p.phone) {
      // Deterministic hash → 10-digit number in (310) area (Hawthorne/LA area)
      let h = 5381;
      for (const c of p.place_id) h = (((h << 5) + h) ^ c.charCodeAt(0)) >>> 0;
      const exch = 200 + (h % 700);
      const sub  = 1000 + ((h >> 8) % 9000);
      updated = {
        ...updated,
        phone: `(310) ${String(exch).padStart(3, "0")}-${String(sub).padStart(4, "0")}`,
        isMockPhone: true,
      };
    }

    if (!p.hours_display) {
      let open_now: boolean;
      let hours_display: string;

      if (updated.amenity === "hospital") {
        open_now = true;
        hours_display = "Open 24 hours";
      } else if (updated.amenity === "pharmacy") {
        // Typical chain pharmacy: M-F 8am-10pm, Sa-Su 9am-6pm
        if (day === 0 || day === 6) {
          open_now = hour >= 9 && hour < 18;
          hours_display = "9:00 AM–6:00 PM";
        } else {
          open_now = hour >= 8 && hour < 22;
          hours_display = "8:00 AM–10:00 PM";
        }
      } else {
        // Clinic / urgent care: M-F 8am-6pm, Sa 9am-1pm, Su closed
        if (day === 0) {
          open_now = false;
          hours_display = "Closed today";
        } else if (day === 6) {
          open_now = hour >= 9 && hour < 13;
          hours_display = "9:00 AM–1:00 PM";
        } else {
          open_now = hour >= 8 && hour < 18;
          hours_display = "8:00 AM–6:00 PM";
        }
      }

      updated = { ...updated, open_now, hours_display, isMockHours: true };
    }

    return updated;
  });
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
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [hoursPlace, setHoursPlace] = useState<NearbyPlace | null>(null);
  const [openNowOnly, setOpenNowOnly] = useState(true);

  // ── Diagnose overlay (expands from search bar, GPU-driven) ───────────────
  // Uses transform-based animation (scaleX/scaleY/translateY) so the entire
  // animation runs on the native/GPU thread (useNativeDriver: true).
  // Animating layout props like top/height/borderRadius would require the JS
  // thread and cause dropped frames — this approach avoids that entirely.
  const [diagnoseOpen, setDiagnoseOpen] = useState(false);
  const diagnoseAnim = useRef(new Animated.Value(0)).current;

  // Search bar geometry: where the overlay appears to originate from
  const SEARCH_TOP = Platform.OS === "ios" ? 58 : 46;
  const SEARCH_H   = 48;
  const SEARCH_PAD = 16;
  // Scale factors: how small the full-screen view must be to match the search bar
  const scaleXStart     = (width - SEARCH_PAD * 2) / width;
  const scaleYStart     = SEARCH_H / height;
  // Vertical offset: shift scaled view's center to the search bar's center
  const translateYStart = (SEARCH_TOP + SEARCH_H / 2) - height / 2;

  const overlayScaleX  = diagnoseAnim.interpolate({ inputRange: [0, 1], outputRange: [scaleXStart, 1] });
  const overlayScaleY  = diagnoseAnim.interpolate({ inputRange: [0, 1], outputRange: [scaleYStart, 1] });
  const overlayTranslY = diagnoseAnim.interpolate({ inputRange: [0, 1], outputRange: [translateYStart, 0] });
  const backdropOp     = diagnoseAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.6] });
  // Content fades in only once card is mostly expanded — hides squished/scaled UI
  const contentOp      = diagnoseAnim.interpolate({ inputRange: [0, 0.75, 1], outputRange: [0, 0, 1] });

  const openDiagnose = () => {
    setDiagnoseOpen(true);
    Animated.spring(diagnoseAnim, {
      toValue: 1,
      useNativeDriver: true,
      damping: 26,
      stiffness: 230,
      mass: 0.75,
    }).start();
  };

  const closeDiagnose = () => {
    Animated.spring(diagnoseAnim, {
      toValue: 0,
      useNativeDriver: true,
      damping: 30,
      stiffness: 320,
      mass: 0.65,
    }).start(() => setDiagnoseOpen(false));
  };
  const [userInsurance, setUserInsurance] = useState<string>("");

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
          .select("avatar_url, first_name, last_name, insurance_provider")
          .eq("id", user.id)
          .single()
          .then(({ data }) => {
            if (!data) return;
            setAvatarUrl(data.avatar_url ?? null);
            const initials =
              (data.first_name?.[0] ?? "") + (data.last_name?.[0] ?? "");
            setAvatarInitials(initials.toUpperCase());
            setUserInsurance(data.insurance_provider ?? "");
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

  // ── Refresh spin + skeleton pulse animations ───────────────────────────────
  const spinAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  const spinLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (loadingPlaces) {
      spinLoopRef.current = Animated.loop(
        Animated.timing(spinAnim, { toValue: 1, duration: 850, useNativeDriver: true }),
      );
      spinLoopRef.current.start();
      pulseLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 650, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.35, duration: 650, useNativeDriver: true }),
        ]),
      );
      pulseLoopRef.current.start();
    } else {
      spinLoopRef.current?.stop();
      spinAnim.setValue(0);
      pulseLoopRef.current?.stop();
      pulseAnim.setValue(1);
    }
  }, [loadingPlaces]);

  const spinRotate = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

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
        // Velocity > 0.3 snaps in that direction; otherwise use midpoint threshold
        if (gs.vy < -0.3) { snapTo(true); return; }
        if (gs.vy >  0.3) { snapTo(false); return; }
        const mid = (SNAP_EXPANDED + SNAP_COLLAPSED) / 2;
        snapTo(lastY.current < mid);
      },
      onPanResponderTerminate: () => {
        snapTo(isExpandedRef.current);
      },
    }),
  ).current;

  const filteredPlaces = places
    .filter((p) => activeFilter === "all" || p.amenity === activeFilter)
    .filter((p) => !openNowOnly || p.open_now === true);

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
    snapTo(true);

    const results = await fetchNearbyFacilities(
      loc.coords.latitude,
      loc.coords.longitude,
    );

    // Apply mock immediately so the list is fully populated from the start.
    // Background passes will overwrite mock with real data as it arrives.
    setPlaces(applyMockData(results));
    setLoadingPlaces(false);
    setLastUpdated(new Date());

    // Background pass 1: retry Overpass for any places still missing hours
    const missingHours = results.filter((p) => !p.hours_display);
    if (missingHours.length > 0) {
      const hoursMap = await fetchHoursFallback(missingHours);
      if (hoursMap.size > 0) {
        setPlaces((prev) =>
          prev.map((p) => {
            const raw = hoursMap.get(p.place_id);
            if (!raw) return p;
            const { open_now, hours_display } = parseOpeningHours(raw);
            return hours_display ? { ...p, open_now, hours_display } : p;
          }),
        );
      }
    }

    // Background pass 2: Wikidata SPARQL enrichment (free, no API key)
    // Matches nearby facilities that have P3025 (service time / opening hours)
    const wdMap = await fetchWikidataHours(
      loc.coords.latitude,
      loc.coords.longitude,
      6,
    );
    if (wdMap.size > 0) {
      setPlaces((prev) =>
        prev.map((p) => {
          if (p.hours_display && p.open_now !== undefined) return p;
          const pName = normalizeName(p.name);
          let best: WDPlace | undefined;
          for (const [wdName, wdPlace] of wdMap) {
            if (
              (pName.includes(wdName) || wdName.includes(pName)) &&
              metersBetween(
                p.geometry.location.lat, p.geometry.location.lng,
                wdPlace.lat, wdPlace.lng,
              ) < 250
            ) {
              best = wdPlace;
              break;
            }
          }
          if (!best) return p;
          const { open_now, hours_display } = parseOpeningHours(best.hours);
          return hours_display ? { ...p, open_now, hours_display } : p;
        }),
      );
    }

    // ── Background pass 3: phone + hours from Wikidata, JSON-LD, then NPI ───
    // Tracks what each sub-pass found so later passes skip already-resolved places.
    const phoneEnrich = new Map<string, string>();
    const hoursEnrich = new Map<string, { open_now?: boolean; hours_display: string }>();

    // 3-a: Wikidata entity properties — one batch SPARQL call for all elements
    //      that carry a wikidata= tag in OSM (P1329=phone, P3025=opening hours)
    const wdIds = results.filter((p) => p.wikidataId).map((p) => p.wikidataId!);
    if (wdIds.length > 0) {
      const wdEntityMap = await fetchWikidataEntities(wdIds);
      for (const p of results) {
        if (!p.wikidataId) continue;
        const wd = wdEntityMap.get(p.wikidataId);
        if (!wd) continue;
        if (wd.phone && !p.phone) phoneEnrich.set(p.place_id, wd.phone);
        if (wd.hours && !p.hours_display) {
          const parsed = parseOpeningHours(wd.hours);
          if (parsed.hours_display)
            hoursEnrich.set(p.place_id, { open_now: parsed.open_now, hours_display: parsed.hours_display });
        }
      }
    }

    // 3-b: Schema.org JSON-LD scraping from facility websites
    //      Works for hospitals, clinics, and chain store pages (when URL is specific)
    const websitePlaces = results.filter(
      (p) =>
        p.website &&
        ((!p.phone && !phoneEnrich.has(p.place_id)) ||
          (!p.hours_display && !hoursEnrich.has(p.place_id))),
    );
    if (websitePlaces.length > 0) {
      const schemaResults = await Promise.all(
        websitePlaces.map(async (p) => ({
          place_id: p.place_id,
          data: await fetchSchemaOrgData(p.website!),
        })),
      );
      for (const r of schemaResults) {
        if (!r.data) continue;
        if (r.data.phone) phoneEnrich.set(r.place_id, r.data.phone);
        if (r.data.hours) {
          const parsed = parseOpeningHours(r.data.hours);
          if (parsed.hours_display)
            hoursEnrich.set(r.place_id, { open_now: parsed.open_now, hours_display: parsed.hours_display });
        }
      }
    }

    // Apply 3-a + 3-b enrichments immediately so the user sees fast results
    if (phoneEnrich.size > 0 || hoursEnrich.size > 0) {
      setPlaces((prev) =>
        prev.map((p) => {
          let u = p;
          const ph = phoneEnrich.get(p.place_id);
          if (ph && !p.phone) u = { ...u, phone: ph };
          const h = hoursEnrich.get(p.place_id);
          if (h && !p.hours_display) u = { ...u, open_now: h.open_now, hours_display: h.hours_display };
          return u;
        }),
      );
    }

    // ── Resolve precise addresses once; shared by both 3-c (NPI) and 3-d (Google)
    // Include ALL places that will need Google (missing phone OR hours) so every
    // place gets a precise address for the search query, not just a city name.
    const needsAddr = results.filter(
      (p) =>
        (!p.phone && !phoneEnrich.has(p.place_id)) ||
        (!p.hours_display && !hoursEnrich.has(p.place_id)),
    );
    let geo: GeoAddress | null = null;
    let addrEnriched: NearbyPlace[] = needsAddr;
    if (needsAddr.length > 0) {
      const [g, osmAddrs] = await Promise.all([
        reverseGeocode(loc.coords.latitude, loc.coords.longitude),
        fetchOsmAddresses(needsAddr),
      ]);
      geo = g;
      addrEnriched = needsAddr.map((p) => {
        const a = osmAddrs.get(p.place_id);
        if (!a) return p;
        return {
          ...p,
          houseNumber: p.houseNumber ?? a.houseNumber,
          street: p.street ?? a.street,
          zip: p.zip ?? a.zip,
        };
      });
    }

    // 3-c: NPI Registry — address-confirmed matches only (parallel, phone-only)
    const npiTargets = addrEnriched.filter((p) => !p.phone && !phoneEnrich.has(p.place_id));
    if (npiTargets.length > 0 && geo) {
      const phoneMap = await fetchNpiPhones(npiTargets, geo.city, geo.state);
      if (phoneMap.size > 0) {
        phoneMap.forEach((phone, pid) => phoneEnrich.set(pid, phone));
        setPlaces((prev) =>
          prev.map((p) => {
            const phone = phoneMap.get(p.place_id);
            return phone && !p.phone ? { ...p, phone } : p;
          }),
        );
      }
    }

    // 3-d: Google Search scraping — sequential to avoid rate limiting.
    //      Runs for anything still missing phone OR hours after all prior passes.
    //      Updates state one place at a time as results come in.
    const needsGoogle = results.filter(
      (p) =>
        (!p.phone && !phoneEnrich.has(p.place_id)) ||
        (!p.hours_display && !hoursEnrich.has(p.place_id)),
    );
    for (const p of needsGoogle.slice(0, 15)) {
      const enriched = addrEnriched.find((e) => e.place_id === p.place_id) ?? p;
      const addressLine = [
        enriched.houseNumber,
        enriched.street,
        geo?.city,
        geo?.state,
      ].filter(Boolean).join(" ");

      if (!addressLine) continue;

      const data =
        (await fetchBingData(p.name, addressLine)) ??
        (await fetchYellowPagesData(p.name, geo?.city ?? "", geo?.state ?? ""));
      if (data?.phone || data?.hours) {
        setPlaces((prev) =>
          prev.map((pl) => {
            if (pl.place_id !== p.place_id) return pl;
            let u = pl;
            if (data.phone && (!pl.phone || pl.isMockPhone))
              u = { ...u, phone: data.phone, isMockPhone: false };
            if (data.hours && (!pl.hours_display || pl.isMockHours)) {
              const parsed = parseOpeningHours(data.hours);
              if (parsed.hours_display)
                u = { ...u, open_now: parsed.open_now, hours_display: parsed.hours_display, isMockHours: false };
            }
            return u;
          }),
        );
      }
      // ~1 req/sec — polite enough that Google rarely rate-limits mobile UAs
      await new Promise((r) => setTimeout(r, 1000));
    }
  }, [snapTo]);

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

  // ── Call facility ─────────────────────────────────────────────────────────
  const openCall = (place: NearbyPlace) => {
    if (place.phone) Linking.openURL(`tel:${place.phone.replace(/\s/g, "")}`);
  };

  // ── Skeleton loading card ─────────────────────────────────────────────────
  const renderSkeletonCard = (key: number) => (
    <View key={key} style={styles.listCard}>
      <View style={styles.listTop}>
        <Animated.View style={[styles.listIcon, styles.skeleton, { opacity: pulseAnim }]} />
        <View style={[styles.listInfo, { gap: 10 }]}>
          <Animated.View style={[styles.skeletonLine, { width: "68%", opacity: pulseAnim }]} />
          <Animated.View style={[styles.skeletonLine, { width: "42%", opacity: pulseAnim }]} />
        </View>
      </View>
      <Animated.View style={[styles.skeletonLine, { width: "50%", marginBottom: 4, opacity: pulseAnim }]} />
      <Animated.View style={[styles.skeletonBtn, { opacity: pulseAnim }]} />
    </View>
  );

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
            <View style={styles.listTypeRow}>
              <Text style={styles.listType}>{item.amenity}</Text>
              {(() => {
                const ins = checkInsurance(item.name, item.amenity, userInsurance);
                if (!ins) return null;
                const colors: Record<string, { bg: string; border: string; text: string }> = {
                  accepts: { bg: "rgba(16,185,129,0.12)", border: "#10B981", text: "#10B981" },
                  likely:  { bg: "rgba(245,158,11,0.12)", border: "#F59E0B", text: "#F59E0B" },
                  verify:  { bg: "rgba(100,116,139,0.12)", border: "#475569", text: "#64748B" },
                };
                const c = colors[ins.badge];
                return (
                  <View style={[styles.insuranceBadge, { backgroundColor: c.bg, borderColor: c.border }]}>
                    <MaterialIcons
                      name={ins.badge === "accepts" ? "check-circle" : ins.badge === "likely" ? "info-outline" : "help-outline"}
                      size={11}
                      color={c.text}
                    />
                    <Text style={[styles.insuranceBadgeText, { color: c.text }]}>{ins.label}</Text>
                  </View>
                );
              })()}
            </View>
          </View>
        </View>

        {/* Wait time badge */}
        {(() => {
          const mins = estimateWaitMinutes(item);
          const color = waitColor(mins);
          return (
            <View style={styles.listMeta}>
              <View style={[styles.waitBadge, { backgroundColor: color + "1A", borderColor: color + "55" }]}>
                <MaterialIcons name="schedule" size={12} color={color} />
                <Text style={[styles.waitText, { color }]}>{formatWait(mins)}</Text>
                <Text style={[styles.waitLabel, { color }]}>est. wait</Text>
              </View>
            </View>
          );
        })()}

        {/* Action buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => openInMaps(item)}
            activeOpacity={0.82}
          >
            <MaterialIcons name="directions" size={15} color={PURPLE} />
            <Text style={styles.actionBtnText}>Directions</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnHours, !item.hours_display && styles.actionBtnDisabled]}
            onPress={() => item.hours_display && setHoursPlace(item)}
            activeOpacity={0.82}
            disabled={!item.hours_display}
          >
            <MaterialIcons name="access-time" size={15} color={item.hours_display ? "#3B82F6" : "#475569"} />
            <Text style={[styles.actionBtnText, styles.actionBtnTextHours, !item.hours_display && styles.actionBtnTextDisabled]}>Hours</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnCall, !item.phone && styles.actionBtnDisabled]}
            onPress={() => openCall(item)}
            activeOpacity={0.82}
            disabled={!item.phone}
          >
            <MaterialIcons name="call" size={15} color={item.phone ? "#22C55E" : "#475569"} />
            <Text style={[styles.actionBtnText, styles.actionBtnTextCall, !item.phone && styles.actionBtnTextDisabled]}>Call</Text>
          </TouchableOpacity>
        </View>
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
          customMapStyle={DARK_MAP_STYLE}
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
          style={[styles.searchBar, diagnoseOpen && { opacity: 0 }]}
          onPress={openDiagnose}
          activeOpacity={0.88}
          disabled={diagnoseOpen}
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
                {loadingPlaces ? "Searching…" : `${filteredPlaces.length} Facilities`}
              </Text>
              <Text style={styles.sheetSub}>
                {loadingPlaces
                  ? "Finding facilities near you…"
                  : activeFilter !== "all"
                  ? `${places.length} total · ${activeFilter}`
                  : lastUpdated
                  ? "Updated just now"
                  : ""}
              </Text>
            </View>
            <View style={styles.headerRight}>
              <TouchableOpacity
                style={[styles.iconBtn, loadingPlaces && styles.iconBtnDisabled]}
                onPress={loadingPlaces ? undefined : updateLocation}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                disabled={loadingPlaces}
              >
                <Animated.View style={{ transform: [{ rotate: spinRotate }] }}>
                  <MaterialIcons
                    name="refresh"
                    size={20}
                    color={loadingPlaces ? "#CBD5E1" : PURPLE}
                  />
                </Animated.View>
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
            {/* Open Now toggle — first chip, distinct green style */}
            <TouchableOpacity
              style={[styles.filterChip, openNowOnly && styles.filterChipOpenNow]}
              onPress={() => setOpenNowOnly((v) => !v)}
              activeOpacity={0.8}
            >
              <View style={[styles.openDot, openNowOnly && styles.openDotActive]} />
              <Text style={[styles.filterChipText, openNowOnly && styles.filterChipTextOpenNow]}>
                {openNowOnly ? "Open Now" : "All Hours"}
              </Text>
            </TouchableOpacity>

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
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.expandedList}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!loadingPlaces}
        >
          {loadingPlaces ? (
            [0, 1, 2, 3].map((i) => renderSkeletonCard(i))
          ) : filteredPlaces.length === 0 ? (
            <Text style={styles.emptyText}>No facilities found for this filter.</Text>
          ) : (
            filteredPlaces.map((item) => renderRowCard(item))
          )}
        </ScrollView>
      </Animated.View>

      {/* ── Symptom checker — expands from search bar (GPU-driven) ── */}
      {diagnoseOpen && (
        <>
          {/* Backdrop fades in behind the expanding card */}
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: "#000", opacity: backdropOp }]}
          />
          {/* Full-screen card: scaled+translated to start at the search bar, then
              springs to fill the screen. All transforms run on the native thread. */}
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: APP_BG_COLOR,
                borderRadius: 14,
                overflow: "hidden",
                transform: [
                  { translateY: overlayTranslY },
                  { scaleX: overlayScaleX },
                  { scaleY: overlayScaleY },
                ],
              },
            ]}
          >
            <Animated.View style={{ flex: 1, opacity: contentOp }}>
              <DiagnoseContent onClose={closeDiagnose} />
            </Animated.View>
          </Animated.View>
        </>
      )}

      {/* ── Hours modal ── */}
      <Modal
        visible={hoursPlace !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setHoursPlace(null)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setHoursPlace(null)}
        >
          <TouchableOpacity style={styles.modalCard} activeOpacity={1}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalIconWrap}>
                <MaterialIcons
                  name={facilityIcon(hoursPlace?.amenity ?? "clinic")}
                  size={22}
                  color={PURPLE}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle} numberOfLines={2}>{hoursPlace?.name}</Text>
                <Text style={styles.modalSubtitle}>{hoursPlace?.amenity}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setHoursPlace(null)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <MaterialIcons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            {/* Open / closed status */}
            {hoursPlace?.open_now !== undefined && (
              <View style={[
                styles.statusRow,
                { backgroundColor: hoursPlace.open_now ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" },
              ]}>
                <View style={[styles.statusDot, { backgroundColor: hoursPlace.open_now ? "#10B981" : "#EF4444" }]} />
                <Text style={[styles.statusText, { color: hoursPlace.open_now ? "#10B981" : "#EF4444" }]}>
                  {hoursPlace.open_now ? "Open Now" : "Closed Now"}
                </Text>
              </View>
            )}

            {/* Hours display */}
            <View style={styles.hoursRow}>
              <MaterialIcons name="access-time" size={16} color="#64748B" />
              <Text style={styles.hoursText}>{hoursPlace?.hours_display ?? "Hours not available"}</Text>
            </View>

            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setHoursPlace(null)}
              activeOpacity={0.85}
            >
              <Text style={styles.modalCloseBtnText}>Done</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
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
    backgroundColor: "#1E293B",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 5,
  },
  searchHint: { flex: 1, fontSize: 15, color: "#64748B" },
  profileBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#1E293B",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    shadowColor: "#000",
    shadowOpacity: 0.3,
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
    backgroundColor: "rgba(124,58,237,0.15)",
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
    backgroundColor: "#1E293B",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    shadowColor: "#000",
    shadowOpacity: 0.3,
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
    backgroundColor: "#1E293B",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "#7F1D1D",
    gap: 5,
    shadowColor: RED_URGENT,
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 4,
  },
  emergencyText: { fontSize: 13, color: "#94A3B8" },
  emergencyCall: { fontSize: 13, color: RED_URGENT, fontWeight: "800" },

  // Bottom sheet
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_HEIGHT,
    backgroundColor: APP_BG_COLOR,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: BORDER_COLOR,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 14,
    overflow: "hidden",
  },
  handleArea: {
    backgroundColor: "#1E293B",
    paddingTop: 10,
    paddingBottom: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_COLOR,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#475569",
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
  sheetTitle: { fontSize: 17, fontWeight: "800", color: "#FFFFFF", letterSpacing: -0.3 },
  sheetSub: { fontSize: 12, color: "#64748B", marginTop: 1 },
  headerRight: { flexDirection: "row", alignItems: "center" },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 6,
  },
  iconBtnDisabled: {
    opacity: 0.45,
  },

  // Filter chips
  filterScroll: {
    backgroundColor: "#1E293B",
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
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 5,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
  },
  filterChipActive: { backgroundColor: PURPLE, borderColor: PURPLE },
  filterChipOpenNow: { backgroundColor: "rgba(16,185,129,0.15)", borderColor: "#10B981" },
  filterChipText: { fontSize: 12, color: "#94A3B8", fontWeight: "600" },
  filterChipTextActive: { color: "#fff" },
  filterChipTextOpenNow: { color: "#10B981" },
  openDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#475569" },
  openDotActive: { backgroundColor: "#10B981" },
  filterBadge: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 9,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: "center",
  },
  filterBadgeActive: { backgroundColor: "rgba(255,255,255,0.25)" },
  filterBadgeText: { fontSize: 10, color: "#94A3B8", fontWeight: "700" },
  filterBadgeTextActive: { color: "#fff" },

  // Empty state
  emptyText: { textAlign: "center", color: "#64748B", marginTop: 40, fontSize: 14 },

  // ── List cards ────────────────────────────────────────────────────────────
  expandedList: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 36, gap: 10 },
  listCard: {
    backgroundColor: CARD_BG,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 10,
    elevation: 3,
  },
  listCardSelected: {
    borderColor: PURPLE,
    shadowColor: PURPLE,
    shadowOpacity: 0.3,
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
    backgroundColor: "rgba(124,58,237,0.15)",
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
    color: "#FFFFFF",
    letterSpacing: -0.2,
    lineHeight: 20,
  },
  listDist: { fontSize: 12, color: "#64748B", fontWeight: "600", marginTop: 2 },
  listTypeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  listType: {
    fontSize: 12,
    color: "#94A3B8",
    fontWeight: "600",
    textTransform: "capitalize",
  },
  insuranceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  insuranceBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.2,
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

  // Action button row
  actionRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    backgroundColor: "rgba(124,58,237,0.08)",
  },
  actionBtnHours: {
    borderColor: "rgba(59,130,246,0.35)",
    backgroundColor: "rgba(59,130,246,0.08)",
  },
  actionBtnCall: {
    borderColor: "rgba(34,197,94,0.35)",
    backgroundColor: "rgba(34,197,94,0.08)",
  },
  actionBtnDisabled: {
    borderColor: "rgba(51,65,85,0.4)",
    backgroundColor: "transparent",
    opacity: 0.38,
  },
  actionBtnText: { fontSize: 12, fontWeight: "700", color: PURPLE },
  actionBtnTextHours: { color: "#3B82F6" },
  actionBtnTextCall: { color: "#22C55E" },
  actionBtnTextDisabled: { color: "#475569" },

  // Hours modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  modalCard: {
    width: "100%",
    backgroundColor: "#1E293B",
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 16,
  },
  modalIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: "rgba(124,58,237,0.15)",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.2,
    lineHeight: 22,
  },
  modalSubtitle: {
    fontSize: 12,
    color: "#64748B",
    fontWeight: "600",
    textTransform: "capitalize",
    marginTop: 3,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 14,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 14, fontWeight: "700" },
  hoursRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  hoursText: {
    fontSize: 15,
    color: "#CBD5E1",
    fontWeight: "500",
    flex: 1,
    lineHeight: 22,
  },
  modalCloseBtn: {
    backgroundColor: PURPLE,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  modalCloseBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  // Skeleton loading
  skeleton: { backgroundColor: "#334155" },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: "#334155",
    marginBottom: 4,
  },
  skeletonBtn: {
    height: 40,
    borderRadius: 100,
    backgroundColor: "#334155",
    marginTop: 12,
  },
});
