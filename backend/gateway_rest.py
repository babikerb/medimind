import os
import json
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Each agent runs on its own port with Agentverse mailbox
SYMPTOM_AGENT_BASE = "http://localhost:8001"
ROUTING_AGENT_BASE = "http://localhost:8002"

app = FastAPI(title="CareRoute Gateway (REST Fallback)")

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


@app.get("/health")
def health_check():
    return {"status": "ok", "mode": "rest_fallback"}


@app.post("/symptoms")
async def submit_symptoms(payload: SymptomInputRequest):
    """Call SymptomAgent's REST endpoint for question generation."""
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.post(
                f"{SYMPTOM_AGENT_BASE}/rest/symptom/questions",
                json={
                    "user_id": payload.user_id,
                    "symptom_input": payload.symptom_input,
                    "patient_profile": payload.patient_profile,
                }
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=e.response.status_code, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"SymptomAgent REST error: {e}")


@app.post("/triage")
async def submit_triage(payload: FollowUpAnswersPayload):
    """Call SymptomAgent for triage, then RoutingAgent for hospital ranking."""
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            # Step 1 Triage via SymptomAgent REST
            triage_resp = await client.post(
                f"{SYMPTOM_AGENT_BASE}/rest/symptom/triage",
                json={
                    "user_id": payload.user_id,
                    "symptom_input": payload.symptom_input,
                    "questions": payload.questions,
                    "answers": payload.answers,
                    "patient_profile": payload.patient_profile,
                }
            )
            triage_resp.raise_for_status()
            triage_data = triage_resp.json()
            triage = triage_data.get("triage", triage_data)

            # Step 2 Routing via RoutingAgent REST
            routing_resp = await client.post(
                f"{ROUTING_AGENT_BASE}/rest/routing/rank",
                json={
                    "user_id": payload.user_id,
                    "triage_result": triage,
                    "user_latitude": payload.user_latitude,
                    "user_longitude": payload.user_longitude,
                    "insurance_provider": payload.insurance_provider,
                }
            )
            routing_resp.raise_for_status()
            routing_data = routing_resp.json()

            return {
                "triage": triage,
                "recommended_hospitals": routing_data.get("recommended_hospitals", []),
                "session_id": routing_data.get("session_id", "unknown"),
            }
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=e.response.status_code, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Triage REST error: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("gateway_rest:app", host="0.0.0.0", port=8080, reload=True)