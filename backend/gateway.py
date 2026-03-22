import os
import uuid
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

SYMPTOM_AGENT_URL = "http://localhost:8001/submit"
ROUTING_AGENT_URL = "http://localhost:8002/submit"

app = FastAPI(title="CareRoute Gateway")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request models

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


# Routes

@app.get("/health")
def health_check():
    return {"status": "ok", "agents": {
        "symptom_agent": SYMPTOM_AGENT_URL,
        "routing_agent": ROUTING_AGENT_URL
    }}


@app.post("/symptoms")
async def submit_symptoms(payload: SymptomInputRequest):
    """Step 1 — Send symptoms, get follow-up questions back."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.post(SYMPTOM_AGENT_URL, json={
                "user_id": payload.user_id,
                "symptom_input": payload.symptom_input,
                "patient_profile": payload.patient_profile
            })
            response.raise_for_status()
            return response.json()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Symptom agent error: {str(e)}")


@app.post("/triage")
async def submit_triage(payload: FollowUpAnswersPayload):
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            # Get triage result from Symptom Agent
            triage_response = await client.post(SYMPTOM_AGENT_URL, json={
                "user_id": payload.user_id,
                "symptom_input": payload.symptom_input,
                "questions": payload.questions,
                "answers": payload.answers,
                "patient_profile": payload.patient_profile
            })
            triage_response.raise_for_status()
            triage_result = triage_response.json()

            # Send triage to Routing Agent
            routing_response = await client.post(ROUTING_AGENT_URL, json={
                "user_id": payload.user_id,
                "triage_result": triage_result,
                "user_latitude": payload.user_latitude,
                "user_longitude": payload.user_longitude,
                "insurance_provider": payload.insurance_provider
            })
            routing_response.raise_for_status()
            return routing_response.json()

        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Triage/routing error: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("gateway:app", host="0.0.0.0", port=8000, reload=True)