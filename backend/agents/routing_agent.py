import os
import json
import math
import random
from uagents import Agent, Context, Protocol
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

routing_agent = Agent(
    name="routing_agent",
    seed="careroute_routing_agent_seed",
    port=8002,
    endpoint=["http://localhost:8002/submit"]
)

from agents.models import RoutingRequest, RoutingResponse

routing_protocol = Protocol("RoutingProtocol")


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
    if occupancy < 0.6:
        wait = random.randint(10, 30)
    elif occupancy < 0.8:
        wait = random.randint(30, 90)
    else:
        wait = random.randint(90, 240)
    return {"available_beds": available_beds, "estimated_wait_minutes": wait, "occupancy_rate": occupancy}


def score_hospital(hospital: dict, triage: dict, user_lat: float, user_lon: float, insurance: str = None) -> dict:
    department = triage.get("identified_department", "general")
    esi_level = triage.get("esi_level", 3)

    try:
        snapshot = supabase.table("hospital_capacity_snapshots") \
            .select("*").eq("hospital_id", hospital["id"]).eq("department", department) \
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

    if esi_level <= 2:
        insurance_score = 100
    elif insurance and insurance in hospital.get("accepted_insurances", []):
        insurance_score = 100
    else:
        insurance_score = 0

    final_score = (availability_score * 0.40 + wait_score * 0.30 + distance_score * 0.20 + insurance_score * 0.10)

    return {
        "score": round(final_score, 2),
        "distance_miles": round(distance, 1),
        "available_beds": available_beds,
        "estimated_wait_minutes": wait_minutes,
        "department_match": department in hospital.get("departments", [])
    }


@routing_protocol.on_message(model=RoutingRequest, replies={RoutingResponse})
async def handle_routing_request(ctx: Context, sender: str, msg: RoutingRequest):
    ctx.logger.info(f"[RoutingAgent] Request from {sender} ESI {msg.triage_result.get('esi_level')}")

    try:
        hospitals = supabase.table("hospitals").select("*").execute().data

        scored = sorted([
            {"hospital": h, "metrics": score_hospital(h, msg.triage_result, msg.user_latitude, msg.user_longitude, msg.insurance_provider)}
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
            "user_id": msg.user_id,
            "symptom_input": msg.triage_result.get("urgency_summary", ""),
            "esi_level": msg.triage_result.get("esi_level"),
            "identified_department": msg.triage_result.get("identified_department"),
            "recommended_hospitals": top3
        }).execute()

        session_id = session.data[0]["id"] if session.data else "unknown"

        ctx.logger.info(f"[RoutingAgent] Returning top 3 hospitals, session {session_id}")
        await ctx.send(sender, RoutingResponse(
            user_id=msg.user_id,
            recommended_hospitals=top3,
            esi_level=msg.triage_result.get("esi_level"),
            session_id=session_id
        ))

    except Exception as e:
        ctx.logger.error(f"[RoutingAgent] Error: {e}")


routing_agent.include(routing_protocol, publish_manifest=True)