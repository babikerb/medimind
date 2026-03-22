import os
import json
import math
from uagents import Agent, Context, Protocol
from supabase import create_client
from models import (
    TriageResult,
    RoutingRequest,
    RoutingResponse
)
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

protocol = Protocol("RoutingProtocol")

def haversine_distance(lat1, lon1, lat2, lon2) -> float:
    R = 3958.8  # Earth radius in miles
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    return R * 2 * math.asin(math.sqrt(a))

def get_capacity_snapshot(hospital_id: str, department: str) -> dict:
    try:
        result = supabase.table("hospital_capacity_snapshots") \
            .select("*") \
            .eq("hospital_id", hospital_id) \
            .eq("department", department) \
            .order("snapshot_time", desc=True) \
            .limit(1) \
            .execute()
        if result.data:
            return result.data[0]
    except Exception:
        pass
    return None


def simulate_capacity(hospital: dict, department: str) -> dict:
    import random
    base_rate = hospital.get("base_occupancy_rate", 0.75)
    # Add some randomness around the baseline
    occupancy = min(0.98, max(0.3, base_rate + random.uniform(-0.15, 0.15)))
    total_beds = hospital.get("total_beds", 50)
    available_beds = max(1, int(total_beds * (1 - occupancy)))
    # Estimate wait time based on occupancy
    if occupancy < 0.6:
        wait = random.randint(10, 30)
    elif occupancy < 0.8:
        wait = random.randint(30, 90)
    else:
        wait = random.randint(90, 240)
    return {
        "available_beds": available_beds,
        "estimated_wait_minutes": wait,
        "occupancy_rate": occupancy
    }


def score_hospital(hospital: dict, triage: dict, user_lat: float, user_lon: float, insurance: str = None) -> float:
    department = triage.get("identified_department", "general")
    esi_level = triage.get("esi_level", 3)

    # Get capacity
    snapshot = get_capacity_snapshot(hospital["id"], department)
    if snapshot:
        available_beds = snapshot["available_beds"]
        wait_minutes = snapshot["estimated_wait_minutes"]
        occupancy = 1 - (available_beds / max(hospital["total_beds"], 1))
    else:
        simulated = simulate_capacity(hospital, department)
        available_beds = simulated["available_beds"]
        wait_minutes = simulated["estimated_wait_minutes"]
        occupancy = simulated["occupancy_rate"]

    # Department availability score (0-100)
    dept_score = 100 if department in hospital.get("departments", []) else 20
    bed_score = min(100, (available_beds / max(hospital["total_beds"], 1)) * 100)
    availability_score = (dept_score * 0.6) + (bed_score * 0.4)

    # Wait time score (0-100) — lower wait = higher score
    # Adjust expectations by ESI level
    if esi_level <= 2:
        max_acceptable_wait = 30
    elif esi_level == 3:
        max_acceptable_wait = 90
    else:
        max_acceptable_wait = 180
    wait_score = max(0, 100 - (wait_minutes / max_acceptable_wait * 100))

    # Distance score (0-100) — closer = higher score
    distance = haversine_distance(
        user_lat, user_lon,
        hospital["latitude"], hospital["longitude"]
    )
    distance_score = max(0, 100 - (distance * 5))  # penalize 5 points per mile

    # Insurance score (0-100)
    if insurance and insurance in hospital.get("accepted_insurances", []):
        insurance_score = 100
    elif esi_level <= 2:
        insurance_score = 100  # EMTALA — insurance irrelevant for ESI 1-2
    else:
        insurance_score = 0

    # Weighted composite score
    final_score = (
        availability_score * 0.40 +
        wait_score * 0.30 +
        distance_score * 0.20 +
        insurance_score * 0.10
    )

    return {
        "score": round(final_score, 2),
        "distance_miles": round(distance, 1),
        "available_beds": available_beds,
        "estimated_wait_minutes": wait_minutes,
        "department_match": department in hospital.get("departments", [])
    }


@protocol.on_message(model=RoutingRequest)
async def handle_routing_request(ctx: Context, sender: str, msg: RoutingRequest):
    ctx.logger.info(f"Routing request for user {msg.user_id} ESI {msg.triage_result.get('esi_level')}")

    try:
        # Fetch all hospitals from Supabase
        result = supabase.table("hospitals").select("*").execute()
        hospitals = result.data

        # Score each hospital
        scored = []
        for hospital in hospitals:
            metrics = score_hospital(
                hospital,
                msg.triage_result,
                msg.user_latitude,
                msg.user_longitude,
                msg.insurance_provider
            )
            scored.append({
                "hospital": hospital,
                "metrics": metrics
            })

        # Sort by score descending
        scored.sort(key=lambda x: x["metrics"]["score"], reverse=True)

        # Take top 3
        top3 = []
        for item in scored[:3]:
            h = item["hospital"]
            m = item["metrics"]
            top3.append({
                "id": h["id"],
                "name": h["name"],
                "address": h["address"],
                "latitude": h["latitude"],
                "longitude": h["longitude"],
                "phone": h["phone"],
                "departments": h["departments"],
                "score": m["score"],
                "distance_miles": m["distance_miles"],
                "available_beds": m["available_beds"],
                "estimated_wait_minutes": m["estimated_wait_minutes"],
                "department_match": m["department_match"],
                "accepted_insurances": h["accepted_insurances"]
            })

        # Save routing session to Supabase
        session = supabase.table("routing_sessions").insert({
            "user_id": msg.user_id,
            "symptom_input": msg.triage_result.get("urgency_summary", ""),
            "esi_level": msg.triage_result.get("esi_level"),
            "identified_department": msg.triage_result.get("identified_department"),
            "recommended_hospitals": top3
        }).execute()

        session_id = session.data[0]["id"] if session.data else "unknown"

        await ctx.send(sender, RoutingResponse(
            user_id=msg.user_id,
            recommended_hospitals=top3,
            esi_level=msg.triage_result.get("esi_level"),
            session_id=session_id
        ))

    except Exception as e:
        ctx.logger.error(f"Routing failed: {e}")


@protocol.on_message(model=TriageResult)
async def handle_triage_from_symptom_agent(ctx: Context, sender: str, msg: TriageResult):
    ctx.logger.info(f"Received triage from symptom agent for user {msg.user_id}")
    # This requires user location — log for now, gateway handles full flow
    ctx.logger.info(f"ESI {msg.esi_level} — {msg.identified_department} — {msg.urgency_summary}")


routing_agent.include(protocol)

if __name__ == "__main__":
    routing_agent.run()