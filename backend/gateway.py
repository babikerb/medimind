import os
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Union
from uagents.query import send_sync_message
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
)

# Helpers

def is_capacity_ready() -> bool:
    try:
        result = supabase.table("hospital_capacity_snapshots").select("id").limit(1).execute()
        return len(result.data) > 0
    except Exception:
        return False

# Send a message to an agent on Agentverse via send_sync_message()
# Resolves the destination through the Almanac (Agentverse registry)
# and waits for the response
async def send_and_receive(address: str, message) -> dict:

    response = await send_sync_message(
        destination=address,
        message=message,
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

    # send_sync_message can return a Model directly
    if hasattr(response, 'model_dump'):
        return response.model_dump()

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
        }
    }


# Sends symptoms to SymptomAgent on Agentverse, returns 1-5 follow-up questions
@app.post("/symptoms")
async def submit_symptoms(payload: SymptomInputRequest):

    try:
        data = await send_and_receive(
            SYMPTOM_AGENT_ADDRESS,
            GatewaySymptomRequest(
                user_id=payload.user_id,
                symptom_input=payload.symptom_input,
                patient_profile=payload.patient_profile
            )
        )
        return {
            "questions": data.get("questions", []),
            "agent": SYMPTOM_AGENT_ADDRESS
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SymptomAgent error: {str(e)}")

# Step 1. SymptomAgent scores ESI and identifies department
# Step 2. RoutingAgent ranks hospitals based on triage result
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
            )
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
            )
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

# Subscribe to wait time alerts for a specific hospital
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
            )
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

# Poll the latest wait time for a subscribed hospital
@app.get("/alert/status/{session_id}")
async def get_alert_status(session_id: str):
    try:
        # Look up the routing session to get the hospital info
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

        # Get the top recommended hospital
        hospital = hospitals[0]
        hospital_id = hospital.get("id")
        department = session_data.get("identified_department", "general")

        # Fetch latest capacity snapshot
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
    
# Generate a post visit follow up care plan based on triage results
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
            )
        )
        return {
            "care_plan": data.get("care_plan", {}),
            "user_id": payload.user_id
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"FollowUpAgent error: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("gateway:app", host="0.0.0.0", port=8080, reload=True)