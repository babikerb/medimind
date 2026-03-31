// ─── Backend API service ─────────────────────────────────────────────────────
// Communicates with the FastAPI gateway which routes to Agentverse agents.
// Update GATEWAY_URL to your deployed gateway or use localhost for development.

const GATEWAY_URL = "http://192.168.1.172:8080";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SymptomRequest {
  user_id: string;
  symptom_input: string;
  patient_profile?: {
    age?: number;
    medications?: string[];
    medical_history?: string[];
  };
}

export interface SymptomResponse {
  questions: string[];
  agent: string;
}

export interface TriageRequest {
  user_id: string;
  symptom_input: string;
  questions: string[];
  answers: string[];
  patient_profile?: {
    age?: number;
    medications?: string[];
    medical_history?: string[];
  };
  user_latitude: number;
  user_longitude: number;
  insurance_provider?: string;
}

export interface TriageResult {
  esi_level: number;
  identified_department: string;
  urgency_summary: string;
  recommended_care_type: string;
  flags?: {
    call_911: boolean;
    redirect_to_urgent_care: boolean;
    emtala_applies: boolean;
  };
  call_911?: boolean;
  redirect_to_urgent_care?: boolean;
  emtala_applies?: boolean;
}

export interface RecommendedHospital {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  phone: string;
  departments: string[];
  accepted_insurances: string[];
  score: number;
  distance_miles: number;
  drive_time_minutes: number;
  encoded_polyline?: string;
  available_beds: number;
  total_beds: number;
  estimated_wait_minutes: number;
  department_match: boolean;
  capacity_source: string;
  last_updated: string | null;
}

export interface TriageResponse {
  triage: TriageResult;
  recommended_hospitals: RecommendedHospital[];
  session_id: string;
  agents_used?: Record<string, string>;
}

export interface FollowUpCareRequest {
  user_id: string;
  triage: Record<string, unknown>;
  hospital_name: string;
}

export interface CarePlan {
  follow_up_timeline: string;
  specialist_referrals: string[];
  medications_to_discuss: string[];
  warning_signs: string[];
  home_care_instructions: string[];
  lifestyle_recommendations: string[];
}

export interface FollowUpCareResponse {
  care_plan: CarePlan;
  user_id: string;
}

export interface AlertSubscribeRequest {
  user_id: string;
  session_id: string;
  hospital_id: string;
  department: string;
}

export interface AlertStatusResponse {
  session_id: string;
  hospital_id?: string;
  hospital_name?: string;
  department?: string;
  available_beds?: number;
  estimated_wait_minutes?: number;
  last_updated?: string;
  status: string;
  message?: string;
}

// ─── API calls ───────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

/** Send symptoms to SymptomAgent → get AI-generated follow-up questions */
export async function submitSymptoms(
  req: SymptomRequest
): Promise<SymptomResponse> {
  return apiFetch<SymptomResponse>("/symptoms", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

/** Send answers to SymptomAgent for ESI scoring, then RoutingAgent for hospital ranking */
export async function submitTriage(
  req: TriageRequest
): Promise<TriageResponse> {
  return apiFetch<TriageResponse>("/triage", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

/** Get follow-up care plan from FollowUpAgent */
export async function getFollowUpCare(
  req: FollowUpCareRequest
): Promise<FollowUpCareResponse> {
  return apiFetch<FollowUpCareResponse>("/followup", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

/** Subscribe to wait time alerts for a hospital */
export async function subscribeAlert(
  req: AlertSubscribeRequest
): Promise<{ status: string; message: string; session_id: string }> {
  return apiFetch("/alert/subscribe", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

/** Poll current wait time status for a session */
export async function getAlertStatus(
  sessionId: string
): Promise<AlertStatusResponse> {
  return apiFetch<AlertStatusResponse>(`/alert/status/${sessionId}`);
}

/** Health check */
export async function healthCheck(): Promise<{
  status: string;
  mode: string;
  capacity_ready: boolean;
}> {
  return apiFetch("/health");
}

// ─── Route (road-following directions via backend) ──────────────────────────

export interface RouteResponse {
  shape: string;
  duration_sec: number;
  distance_miles: number;
}

/** Get a road-following route between two points */
export async function getRoute(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number
): Promise<RouteResponse> {
  return apiFetch<RouteResponse>("/route", {
    method: "POST",
    body: JSON.stringify({
      origin_lat: originLat,
      origin_lon: originLon,
      dest_lat: destLat,
      dest_lon: destLon,
    }),
  });
}

// ─── Insurance verification ─────────────────────────────────────────────────

export interface InsuranceVerifyRequest {
  user_id: string;
  image_base64: string;
}

export interface InsuranceExtracted {
  provider_name: string | null;
  member_id: string | null;
  group_number: string | null;
  plan_type: string | null;
  plan_name: string | null;
  copay_er: string | null;
  copay_urgent: string | null;
  effective_date: string | null;
}

export interface InsuranceVerifyResponse {
  extracted: InsuranceExtracted;
  matched_hospitals_count: number;
  matched_hospitals: { id: string; name: string }[];
  profile_updated: boolean;
}

/** Upload insurance card image for AI OCR verification */
export async function verifyInsurance(
  req: InsuranceVerifyRequest
): Promise<InsuranceVerifyResponse> {
  return apiFetch<InsuranceVerifyResponse>("/insurance/verify", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

// ─── Wait time predictions ──────────────────────────────────────────────────

export interface WaitTimePrediction {
  current_wait: number;
  predicted_30min: number;
  predicted_1hr: number;
  predicted_2hr: number;
  trend: "increasing" | "decreasing" | "stable";
  confidence: "high" | "medium" | "low";
  data_points: number;
  history: { time: string; wait_minutes: number; beds: number }[];
}

/** Get wait time predictions for a hospital/department */
export async function predictWaitTime(
  hospitalId: string,
  department: string
): Promise<WaitTimePrediction> {
  return apiFetch<WaitTimePrediction>("/predict-wait", {
    method: "POST",
    body: JSON.stringify({ hospital_id: hospitalId, department }),
  });
}

// ─── Admin dashboard ────────────────────────────────────────────────────────

export interface AdminHospital {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  total_beds: number;
  available_beds: number;
  occupancy_rate: number;
  avg_wait_minutes: number;
  departments: {
    department: string;
    available_beds: number;
    estimated_wait_minutes: number;
    source: string;
    last_updated: string;
  }[];
  accepted_insurances: string[];
}

export interface AdminCapacityResponse {
  hospitals: AdminHospital[];
  total_hospitals: number;
  total_available_beds: number;
  avg_occupancy: number;
}

/** Get admin dashboard capacity data */
export async function getAdminCapacity(): Promise<AdminCapacityResponse> {
  return apiFetch<AdminCapacityResponse>("/admin/capacity");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a reason string explaining why a hospital was recommended */
export function generateReasonString(
  hospital: RecommendedHospital,
  triage: TriageResult,
  insuranceProvider?: string
): string {
  const parts: string[] = [];

  if (hospital.department_match) {
    parts.push(`has ${triage.identified_department} department`);
  }

  if (hospital.estimated_wait_minutes <= 30) {
    parts.push(`${hospital.estimated_wait_minutes} min wait`);
  } else {
    parts.push(`~${hospital.estimated_wait_minutes} min wait`);
  }

  parts.push(`${hospital.available_beds} beds available`);
  if (hospital.drive_time_minutes) {
    parts.push(`${hospital.drive_time_minutes} min drive`);
  } else {
    parts.push(`${hospital.distance_miles} mi away`);
  }

  if (
    insuranceProvider &&
    hospital.accepted_insurances?.includes(insuranceProvider)
  ) {
    parts.push(`accepts ${insuranceProvider}`);
  }

  const reason = parts.join(", ");
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}
