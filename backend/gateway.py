import os
import json
import re
import requests
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from uagents.query import send_sync_message
from uagents.resolver import RulesBasedResolver
from uagents_core.identity import Identity
from uagents_core.envelope import Envelope
from uagents_core.types import MsgStatus
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

# Agent addresses are now derived from seed phrases via Agentverse Identity
from agents.config import (
    SYMPTOM_AGENT_ADDRESS,
    ROUTING_AGENT_ADDRESS,
    MONITOR_AGENT_ADDRESS,
    ALERT_AGENT_ADDRESS,
    FOLLOWUP_AGENT_ADDRESS,
    HHS_AGENT_ADDRESS,
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Import models
from agents.models import (
    GatewaySymptomRequest,
    GatewayQuestionsResponse,
    GatewayTriageRequest,
    GatewayTriageResponse,
    RoutingRequest,
    AlertNotification,
    FollowUpCareResponse,
)

# ─── Local resolver ──────────────────────────────────────────────────────────
# Agents run locally with mailbox=True for Agentverse registration,
# but the gateway communicates with them via their local HTTP endpoints
# for synchronous request/response.
local_resolver = RulesBasedResolver({
    SYMPTOM_AGENT_ADDRESS: ["http://localhost:8001/submit"],
    ROUTING_AGENT_ADDRESS: ["http://localhost:8002/submit"],
    MONITOR_AGENT_ADDRESS: ["http://localhost:8003/submit"],
    ALERT_AGENT_ADDRESS: ["http://localhost:8004/submit"],
    FOLLOWUP_AGENT_ADDRESS: ["http://localhost:8005/submit"],
    HHS_AGENT_ADDRESS: ["http://localhost:8006/submit"],
})

# Helpers

def is_capacity_ready() -> bool:
    try:
        result = supabase.table("hospital_capacity_snapshots").select("id").limit(1).execute()
        return len(result.data) > 0
    except Exception:
        return False

async def send_and_receive(address: str, message, response_type=None) -> dict:
    response = await send_sync_message(
        destination=address,
        message=message,
        response_type=response_type,
        resolver=local_resolver,
        timeout=30
    )

    if isinstance(response, MsgStatus):
        raise HTTPException(
            status_code=504,
            detail=f"Agent delivery failed: {response.status} — {response.detail}"
        )

    if isinstance(response, Envelope):
        payload_str = response.decode_payload()
        if not payload_str:
            raise HTTPException(status_code=500, detail="Agent returned empty payload")
        return json.loads(payload_str)

    if hasattr(response, 'model_dump'):
        return response.model_dump()

    if isinstance(response, str):
        return json.loads(response)

    raise HTTPException(status_code=500, detail=f"Unexpected response type: {type(response)}")


# FastAPI app
app = FastAPI(title="CareRoute Gateway")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SymptomInputRequest(BaseModel):
    user_id: str
    symptom_input: str
    patient_profile: Optional[dict] = None


class FollowUpAnswersPayload(BaseModel):
    user_id: str
    symptom_input: str
    questions: list[str]
    answers: list[str]
    patient_profile: Optional[dict] = None
    user_latitude: float
    user_longitude: float
    insurance_provider: Optional[str] = None

class AlertSubscribePayload(BaseModel):
    user_id: str
    session_id: str
    hospital_id: str
    department: str

class FollowUpCarePayload(BaseModel):
    user_id: str
    triage: dict
    hospital_name: str

class RoutePayload(BaseModel):
    origin_lat: float
    origin_lon: float
    dest_lat: float
    dest_lon: float

class InsuranceVerifyPayload(BaseModel):
    user_id: str
    image_base64: str

class WaitTimePredictionPayload(BaseModel):
    hospital_id: str
    department: str


# Endpoints

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "capacity_ready": is_capacity_ready(),
        "mode": "agentverse",
        "agents": {
            "symptom_agent": SYMPTOM_AGENT_ADDRESS,
            "routing_agent": ROUTING_AGENT_ADDRESS,
            "monitor_agent": MONITOR_AGENT_ADDRESS,
            "alert_agent":   ALERT_AGENT_ADDRESS,
            "followup_agent": FOLLOWUP_AGENT_ADDRESS,
            "hhs_agent": HHS_AGENT_ADDRESS,
        }
    }


@app.post("/symptoms")
async def submit_symptoms(payload: SymptomInputRequest):
    try:
        data = await send_and_receive(
            SYMPTOM_AGENT_ADDRESS,
            GatewaySymptomRequest(
                user_id=payload.user_id,
                symptom_input=payload.symptom_input,
                patient_profile=payload.patient_profile
            ),
            response_type=GatewayQuestionsResponse
        )
        return {
            "questions": data.get("questions", []),
            "agent": SYMPTOM_AGENT_ADDRESS
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SymptomAgent error: {str(e)}")

@app.post("/triage")
async def submit_triage(payload: FollowUpAnswersPayload):
    try:
        # 1. ESI scoring via SymptomAgent
        triage_data = await send_and_receive(
            SYMPTOM_AGENT_ADDRESS,
            GatewayTriageRequest(
                user_id=payload.user_id,
                symptom_input=payload.symptom_input,
                questions=payload.questions,
                answers=payload.answers,
                patient_profile=payload.patient_profile,
                user_latitude=payload.user_latitude,
                user_longitude=payload.user_longitude,
                insurance_provider=payload.insurance_provider
            ),
            response_type=GatewayTriageResponse
        )

        triage = triage_data.get("triage", triage_data)

        # 2. Hospital ranking via RoutingAgent
        routing_data = await send_and_receive(
            ROUTING_AGENT_ADDRESS,
            RoutingRequest(
                user_id=payload.user_id,
                triage_result=triage,
                user_latitude=payload.user_latitude,
                user_longitude=payload.user_longitude,
                insurance_provider=payload.insurance_provider
            ),
            response_type=GatewayTriageResponse
        )

        return {
            "triage": triage,
            "recommended_hospitals": routing_data.get("recommended_hospitals", []),
            "session_id": routing_data.get("session_id", "unknown"),
            "agents_used": {
                "symptom_agent": SYMPTOM_AGENT_ADDRESS,
                "routing_agent": ROUTING_AGENT_ADDRESS,
                "monitor_agent": MONITOR_AGENT_ADDRESS,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Triage error: {str(e)}")

@app.post("/alert/subscribe")
async def subscribe_alert(payload: AlertSubscribePayload):
    try:
        from agents.models import AlertRequest
        data = await send_and_receive(
            ALERT_AGENT_ADDRESS,
            AlertRequest(
                user_id=payload.user_id,
                session_id=payload.session_id,
                hospital_id=payload.hospital_id,
                department=payload.department
            ),
            response_type=AlertNotification
        )
        return {
            "status": "subscribed",
            "message": data.get("message", "Alert registered"),
            "session_id": payload.session_id,
            "hospital_id": payload.hospital_id
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AlertAgent error: {str(e)}")

@app.get("/alert/status/{session_id}")
async def get_alert_status(session_id: str):
    try:
        session = supabase.table("routing_sessions") \
            .select("*") \
            .eq("id", session_id) \
            .limit(1) \
            .execute()

        if not session.data:
            raise HTTPException(status_code=404, detail="Session not found")

        session_data = session.data[0]
        hospitals = session_data.get("recommended_hospitals", [])
        if not hospitals:
            raise HTTPException(status_code=404, detail="No hospitals in session")

        hospital = hospitals[0]
        hospital_id = hospital.get("id")
        department = session_data.get("identified_department", "general")

        snapshot = supabase.table("hospital_capacity_snapshots") \
            .select("*") \
            .eq("hospital_id", hospital_id) \
            .eq("department", department) \
            .order("snapshot_time", desc=True) \
            .limit(1) \
            .execute()

        if not snapshot.data:
            return {
                "session_id": session_id,
                "hospital_name": hospital.get("name"),
                "status": "no_data",
                "message": "No capacity data available yet"
            }

        current = snapshot.data[0]
        return {
            "session_id": session_id,
            "hospital_id": hospital_id,
            "hospital_name": hospital.get("name"),
            "department": department,
            "available_beds": current["available_beds"],
            "estimated_wait_minutes": current["estimated_wait_minutes"],
            "last_updated": current["snapshot_time"],
            "status": "active"
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Alert status error: {str(e)}")

@app.post("/followup")
async def get_followup_care(payload: FollowUpCarePayload):
    try:
        from agents.models import FollowUpCareRequest
        data = await send_and_receive(
            FOLLOWUP_AGENT_ADDRESS,
            FollowUpCareRequest(
                user_id=payload.user_id,
                triage=payload.triage,
                hospital_name=payload.hospital_name
            ),
            response_type=FollowUpCareResponse
        )
        return {
            "care_plan": data.get("care_plan", {}),
            "user_id": payload.user_id
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"FollowUpAgent error: {str(e)}")


VALHALLA_URLS = [
    "https://valhalla1.openstreetmap.de/route",
    "https://valhalla2.openstreetmap.de/route",
]

@app.post("/route")
async def get_route(payload: RoutePayload):
    """Get a road-following route between two points via Valhalla."""
    body = {
        "locations": [
            {"lat": payload.origin_lat, "lon": payload.origin_lon},
            {"lat": payload.dest_lat, "lon": payload.dest_lon},
        ],
        "costing": "auto",
        "directions_options": {"units": "miles"},
    }

    for url in VALHALLA_URLS:
        try:
            resp = requests.post(url, json=body, timeout=10)
            data = resp.json()
            if data.get("trip", {}).get("legs"):
                leg = data["trip"]["legs"][0]
                summary = data["trip"]["summary"]
                return {
                    "shape": leg["shape"],
                    "duration_sec": summary["time"],
                    "distance_miles": round(summary["length"], 1),
                }
        except Exception as e:
            print(f"Valhalla {url} failed: {e}")
            continue

    raise HTTPException(status_code=502, detail="All routing engines unavailable")


@app.post("/insurance/verify")
async def verify_insurance(payload: InsuranceVerifyPayload):
    """Use AI to OCR an insurance card image and extract provider/plan info."""
    try:
        ASI1_API_KEY = os.getenv("ASI1_API_KEY")
        if not ASI1_API_KEY:
            raise HTTPException(status_code=500, detail="AI API key not configured")

        resp = requests.post(
            "https://api.asi1.ai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {ASI1_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "asi1-mini",
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You are an insurance card OCR specialist. Extract information from the "
                            "insurance card image and return ONLY a JSON object with these fields:\n"
                            "- provider_name: the insurance company name\n"
                            "- member_id: the member/subscriber ID number\n"
                            "- group_number: the group number if visible\n"
                            "- plan_type: the plan type (PPO, HMO, EPO, POS, etc.)\n"
                            "- plan_name: the specific plan name if visible\n"
                            "- copay_er: ER copay if visible\n"
                            "- copay_urgent: urgent care copay if visible\n"
                            "- effective_date: coverage effective date if visible\n"
                            "If a field is not visible, set it to null. Return ONLY valid JSON."
                        ),
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/jpeg;base64,{payload.image_base64}"},
                            },
                            {
                                "type": "text",
                                "text": "Extract all insurance information from this insurance card image.",
                            },
                        ],
                    },
                ],
                "temperature": 0.1,
                "max_tokens": 500,
            },
            timeout=30,
        )

        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "{}")

        # Parse the JSON from AI response
        json_match = re.search(r'\{[^{}]*\}', content, re.DOTALL)
        if json_match:
            extracted = json.loads(json_match.group())
        else:
            extracted = json.loads(content)

        # Match extracted provider to hospitals that accept this insurance
        provider_name = extracted.get("provider_name", "")
        matched_hospitals = []
        if provider_name:
            hospitals = supabase.table("hospitals").select("id, name, accepted_insurances").execute().data
            for h in hospitals:
                insurances = h.get("accepted_insurances", [])
                for ins in insurances:
                    if provider_name.lower() in ins.lower() or ins.lower() in provider_name.lower():
                        matched_hospitals.append({"id": h["id"], "name": h["name"]})
                        break

        # Update user profile with extracted insurance info if user_id provided
        if payload.user_id and provider_name:
            supabase.table("profiles").update({
                "insurance_provider": provider_name,
                "insurance_plan": extracted.get("plan_type", ""),
            }).eq("id", payload.user_id).execute()

        return {
            "extracted": extracted,
            "matched_hospitals_count": len(matched_hospitals),
            "matched_hospitals": matched_hospitals[:10],
            "profile_updated": bool(payload.user_id and provider_name),
        }

    except json.JSONDecodeError:
        return {
            "extracted": {"provider_name": None, "error": "Could not parse insurance card"},
            "matched_hospitals_count": 0,
            "matched_hospitals": [],
            "profile_updated": False,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Insurance verification error: {str(e)}")


@app.post("/predict-wait")
async def predict_wait_time(payload: WaitTimePredictionPayload):
    """Predict future wait times using historical snapshot data."""
    try:
        # Get last 24 hours of snapshots for this hospital/department
        cutoff = (datetime.utcnow() - timedelta(hours=24)).isoformat()

        snapshots = (
            supabase.table("hospital_capacity_snapshots")
            .select("estimated_wait_minutes, available_beds, snapshot_time")
            .eq("hospital_id", payload.hospital_id)
            .eq("department", payload.department)
            .gte("snapshot_time", cutoff)
            .order("snapshot_time", desc=False)
            .execute()
        ).data

        if not snapshots or len(snapshots) < 2:
            # Not enough data, return current snapshot
            current = (
                supabase.table("hospital_capacity_snapshots")
                .select("estimated_wait_minutes, available_beds, snapshot_time")
                .eq("hospital_id", payload.hospital_id)
                .eq("department", payload.department)
                .order("snapshot_time", desc=True)
                .limit(1)
                .execute()
            ).data
            if current:
                return {
                    "current_wait": current[0]["estimated_wait_minutes"],
                    "predicted_30min": current[0]["estimated_wait_minutes"],
                    "predicted_1hr": current[0]["estimated_wait_minutes"],
                    "predicted_2hr": current[0]["estimated_wait_minutes"],
                    "trend": "stable",
                    "confidence": "low",
                    "data_points": len(snapshots),
                    "history": [],
                }
            raise HTTPException(status_code=404, detail="No capacity data found")

        wait_times = [s["estimated_wait_minutes"] for s in snapshots]
        current_wait = wait_times[-1]

        # Simple linear regression for trend
        n = len(wait_times)
        x_mean = (n - 1) / 2
        y_mean = sum(wait_times) / n
        numerator = sum((i - x_mean) * (w - y_mean) for i, w in enumerate(wait_times))
        denominator = sum((i - x_mean) ** 2 for i in range(n))
        slope = numerator / denominator if denominator != 0 else 0

        # Predict future values (clamped to 0-360 min)
        interval_minutes = 30 if n > 1 else 1
        if len(snapshots) >= 2:
            first_time = datetime.fromisoformat(snapshots[0]["snapshot_time"].replace("Z", "+00:00"))
            last_time = datetime.fromisoformat(snapshots[-1]["snapshot_time"].replace("Z", "+00:00"))
            total_minutes = (last_time - first_time).total_seconds() / 60
            interval_minutes = total_minutes / max(n - 1, 1)

        steps_per_30min = 30 / max(interval_minutes, 1)
        predicted_30 = max(0, min(360, round(current_wait + slope * steps_per_30min)))
        predicted_1hr = max(0, min(360, round(current_wait + slope * steps_per_30min * 2)))
        predicted_2hr = max(0, min(360, round(current_wait + slope * steps_per_30min * 4)))

        # Determine trend
        if slope > 0.5:
            trend = "increasing"
        elif slope < -0.5:
            trend = "decreasing"
        else:
            trend = "stable"

        # Confidence based on data points
        confidence = "high" if n >= 20 else ("medium" if n >= 5 else "low")

        # Return recent history for charting (last 12 points)
        history = [
            {
                "time": s["snapshot_time"],
                "wait_minutes": s["estimated_wait_minutes"],
                "beds": s["available_beds"],
            }
            for s in snapshots[-12:]
        ]

        return {
            "current_wait": current_wait,
            "predicted_30min": predicted_30,
            "predicted_1hr": predicted_1hr,
            "predicted_2hr": predicted_2hr,
            "trend": trend,
            "confidence": confidence,
            "data_points": n,
            "history": history,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction error: {str(e)}")


@app.get("/admin/capacity")
async def get_admin_capacity():
    """Get real-time capacity data for all hospitals (admin dashboard)."""
    try:
        hospitals = supabase.table("hospitals").select("*").execute().data

        result = []
        for h in hospitals:
            # Get latest snapshot for each department
            departments_data = []
            for dept in h.get("departments", ["general"]):
                snapshot = (
                    supabase.table("hospital_capacity_snapshots")
                    .select("*")
                    .eq("hospital_id", h["id"])
                    .eq("department", dept)
                    .order("snapshot_time", desc=True)
                    .limit(1)
                    .execute()
                ).data
                if snapshot:
                    departments_data.append({
                        "department": dept,
                        "available_beds": snapshot[0]["available_beds"],
                        "estimated_wait_minutes": snapshot[0]["estimated_wait_minutes"],
                        "source": snapshot[0].get("source", "unknown"),
                        "last_updated": snapshot[0]["snapshot_time"],
                    })

            total_available = sum(d["available_beds"] for d in departments_data)
            avg_wait = round(sum(d["estimated_wait_minutes"] for d in departments_data) / max(len(departments_data), 1))
            occupancy_rate = round(1 - (total_available / max(h.get("total_beds", 1), 1)), 2)

            result.append({
                "id": h["id"],
                "name": h["name"],
                "address": h["address"],
                "latitude": h["latitude"],
                "longitude": h["longitude"],
                "total_beds": h.get("total_beds", 0),
                "available_beds": total_available,
                "occupancy_rate": occupancy_rate,
                "avg_wait_minutes": avg_wait,
                "departments": departments_data,
                "accepted_insurances": h.get("accepted_insurances", []),
            })

        # Sort by occupancy rate (most available first)
        result.sort(key=lambda x: x["occupancy_rate"])

        return {
            "hospitals": result,
            "total_hospitals": len(result),
            "total_available_beds": sum(h["available_beds"] for h in result),
            "avg_occupancy": round(sum(h["occupancy_rate"] for h in result) / max(len(result), 1), 2),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Admin capacity error: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("gateway:app", host="0.0.0.0", port=8080, reload=True)
