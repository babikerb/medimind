import os
import json
import uuid
import hashlib
import requests as req
import math
import random
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
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

SYMPTOM_AGENT_ADDRESS = os.getenv("SYMPTOM_AGENT_ADDRESS")
ROUTING_AGENT_ADDRESS = os.getenv("ROUTING_AGENT_ADDRESS")

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


def call_groq(system_prompt: str, user_message: str) -> str:
    response = req.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
        json={
            "model": "llama-3.3-70b-versatile",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            "temperature": 0.1
        }
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"].strip()


def haversine_distance(lat1, lon1, lat2, lon2) -> float:
    R = 3958.8
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    return R * 2 * math.asin(math.sqrt(a))


def simulate_capacity(hospital: dict) -> dict:
    base_rate = hospital.get("base_occupancy_rate", 0.75)
    occupancy = min(0.98, max(0.3, base_rate + random.uniform(-0.15, 0.15)))
    total_beds = hospital.get("total_beds", 50)
    available_beds = max(1, int(total_beds * (1 - occupancy)))
    wait = random.randint(10, 30) if occupancy < 0.6 else (random.randint(30, 90) if occupancy < 0.8 else random.randint(90, 240))
    return {"available_beds": available_beds, "estimated_wait_minutes": wait, "occupancy_rate": occupancy}


def score_hospital(hospital, triage, user_lat, user_lon, insurance=None):
    department = triage.get("identified_department", "general")
    esi_level = triage.get("esi_level", 3)
    try:
        snapshot = supabase.table("hospital_capacity_snapshots").select("*") \
            .eq("hospital_id", hospital["id"]).eq("department", department) \
            .order("snapshot_time", desc=True).limit(1).execute()
        if snapshot.data:
            available_beds = snapshot.data[0]["available_beds"]
            wait_minutes = snapshot.data[0]["estimated_wait_minutes"]
            occupancy = 1 - (available_beds / max(hospital["total_beds"], 1))
        else:
            sim = simulate_capacity(hospital)
            available_beds, wait_minutes, occupancy = sim["available_beds"], sim["estimated_wait_minutes"], sim["occupancy_rate"]
    except Exception:
        sim = simulate_capacity(hospital)
        available_beds, wait_minutes, occupancy = sim["available_beds"], sim["estimated_wait_minutes"], sim["occupancy_rate"]

    dept_score = 100 if department in hospital.get("departments", []) else 20
    bed_score = min(100, (available_beds / max(hospital["total_beds"], 1)) * 100)
    availability_score = (dept_score * 0.6) + (bed_score * 0.4)
    max_wait = 30 if esi_level <= 2 else (90 if esi_level == 3 else 180)
    wait_score = max(0, 100 - (wait_minutes / max_wait * 100))
    distance = haversine_distance(user_lat, user_lon, hospital["latitude"], hospital["longitude"])
    distance_score = max(0, 100 - (distance * 5))
    insurance_score = 100 if (esi_level <= 2 or (insurance and insurance in hospital.get("accepted_insurances", []))) else 0
    final_score = availability_score * 0.40 + wait_score * 0.30 + distance_score * 0.20 + insurance_score * 0.10
    return {
        "score": round(final_score, 2),
        "distance_miles": round(distance, 1),
        "available_beds": available_beds,
        "estimated_wait_minutes": wait_minutes,
        "department_match": department in hospital.get("departments", [])
    }


@app.get("/health")
def health_check():
    return {"status": "ok", "agents": {
        "symptom_agent": SYMPTOM_AGENT_ADDRESS,
        "routing_agent": ROUTING_AGENT_ADDRESS
    }}


@app.post("/symptoms")
async def submit_symptoms(payload: SymptomInputRequest):
    system_prompt = """You are a medical triage assistant. Generate 1-5 focused follow-up questions for the patient's symptoms.
Respond ONLY with a valid JSON array of strings, no explanation, no markdown.
Example: ["How long have you had this pain?", "Is the pain sharp or dull?"]"""

    profile = payload.patient_profile or {}
    context = ""
    if profile.get("age"): context += f"Patient age: {profile['age']}\n"
    if profile.get("medications"): context += f"Medications: {', '.join(profile['medications'])}\n"
    if profile.get("medical_history"): context += f"Medical history: {', '.join(profile['medical_history'])}\n"

    try:
        raw = call_groq(system_prompt, context + f"Symptoms: {payload.symptom_input}")
        raw = raw.replace("```json", "").replace("```", "").strip()
        questions = json.loads(raw)
        if questions and isinstance(questions[0], dict):
            questions = [q.get("question", str(q)) for q in questions]
        return {"questions": questions, "agent": SYMPTOM_AGENT_ADDRESS}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/triage")
async def submit_triage(payload: FollowUpAnswersPayload):
    system_prompt = """You are a medical triage assistant trained on ESI framework.
ESI 1: Immediate life threat | ESI 2: High risk | ESI 3: Stable, multiple resources | ESI 4: One resource | ESI 5: No resources
Departments: ICU, surgery, pediatric, psychiatric, general
Respond ONLY with valid JSON, no markdown:
{"esi_level":<1-5>,"identified_department":"<dept>","urgency_summary":"<one sentence>","recommended_care_type":"<emergency_room|urgent_care|primary_care>","flags":{"call_911":<bool>,"redirect_to_urgent_care":<bool>,"emtala_applies":<bool>}}"""

    profile = payload.patient_profile or {}
    context = ""
    if profile.get("age"): context += f"Patient age: {profile['age']}\n"
    if profile.get("medications"): context += f"Medications: {', '.join(profile['medications'])}\n"
    if profile.get("medical_history"): context += f"Medical history: {', '.join(profile['medical_history'])}\n"
    qa = "\n".join([f"Q: {q}\nA: {a}" for q, a in zip(payload.questions, payload.answers)])
    user_message = context + f"Initial symptoms: {payload.symptom_input}\n\nFollow-up:\n{qa}"

    try:
        raw = call_groq(system_prompt, user_message)
        raw = raw.replace("```json", "").replace("```", "").strip()
        triage = json.loads(raw)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Triage error: {str(e)}")

    try:
        hospitals = supabase.table("hospitals").select("*").execute().data
        scored = sorted([
            {"hospital": h, "metrics": score_hospital(h, triage, payload.user_latitude, payload.user_longitude, payload.insurance_provider)}
            for h in hospitals
        ], key=lambda x: x["metrics"]["score"], reverse=True)

        top3 = [{
            "id": item["hospital"]["id"],
            "name": item["hospital"]["name"],
            "address": item["hospital"]["address"],
            "latitude": item["hospital"]["latitude"],
            "longitude": item["hospital"]["longitude"],
            "phone": item["hospital"]["phone"],
            "departments": item["hospital"]["departments"],
            "accepted_insurances": item["hospital"]["accepted_insurances"],
            "score": item["metrics"]["score"],
            "distance_miles": item["metrics"]["distance_miles"],
            "available_beds": item["metrics"]["available_beds"],
            "estimated_wait_minutes": item["metrics"]["estimated_wait_minutes"],
            "department_match": item["metrics"]["department_match"]
        } for item in scored[:3]]

        session = supabase.table("routing_sessions").insert({
            "user_id": payload.user_id,
            "symptom_input": payload.symptom_input,
            "esi_level": triage.get("esi_level"),
            "identified_department": triage.get("identified_department"),
            "recommended_hospitals": top3
        }).execute()

        session_id = session.data[0]["id"] if session.data else "unknown"

        return {
            "triage": triage,
            "recommended_hospitals": top3,
            "session_id": session_id,
            "agents_used": {
                "symptom_agent": SYMPTOM_AGENT_ADDRESS,
                "routing_agent": ROUTING_AGENT_ADDRESS
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Routing error: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("gateway:app", host="0.0.0.0", port=8080, reload=True)