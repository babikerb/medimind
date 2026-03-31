import os
import math
import random
import requests
from uagents import Agent, Context, Protocol
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

from agents.config import ROUTING_AGENT_SEED

routing_agent = Agent(
    name="routing_agent",
    seed=ROUTING_AGENT_SEED,
    port=8002,
    mailbox=True,
    publish_agent_details=True,
)

from agents.models import RoutingRequest, GatewayTriageResponse

routing_protocol = Protocol("RoutingProtocol")

GOOGLE_DIRECTIONS_API_KEY = os.getenv("GOOGLE_DIRECTIONS_API_KEY", "")


# Scoring helpers

def get_drive_time(origin_lat, origin_lon, dest_lat, dest_lon) -> dict:
    """Get traffic-aware drive time from Google Directions API."""
    if not GOOGLE_DIRECTIONS_API_KEY:
        return None
    try:
        resp = requests.get(
            "https://maps.googleapis.com/maps/api/directions/json",
            params={
                "origin": f"{origin_lat},{origin_lon}",
                "destination": f"{dest_lat},{dest_lon}",
                "departure_time": "now",
                "key": GOOGLE_DIRECTIONS_API_KEY,
            },
            timeout=5,
        )
        data = resp.json()
        if data.get("status") == "OK" and data.get("routes"):
            leg = data["routes"][0]["legs"][0]
            # Prefer duration_in_traffic if available
            duration = leg.get("duration_in_traffic", leg["duration"])
            return {
                "drive_time_minutes": round(duration["value"] / 60),
                "distance_miles": round(leg["distance"]["value"] / 1609.34, 1),
                "encoded_polyline": data["routes"][0]["overview_polyline"]["points"],
            }
    except Exception:
        pass
    return None


def haversine_distance(lat1, lon1, lat2, lon2) -> float:
    R = 3958.8
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))

# Last resort fallback only should never be hit in normal operation because
# the MonitorAgent pre-populates snapshots for every hospital/department at startup
# and refreshes every 30 seconds
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
    return {
        "available_beds": available_beds,
        "estimated_wait_minutes": wait,
        "occupancy_rate": occupancy
    }

# Reads the latest capacity snapshot from Supabase
# Priority: HHS data (real) > Monitor Agent (simulated) > inline fallback
def get_capacity(hospital: dict, department: str) -> dict:
    try:
        # Try HHS data first (real reported data)
        hhs_snapshot = (
            supabase.table("hospital_capacity_snapshots")
            .select("*")
            .eq("hospital_id", hospital["id"])
            .eq("department", department)
            .eq("source", "hhs")
            .order("snapshot_time", desc=True)
            .limit(1)
            .execute()
        )
        if hhs_snapshot.data:
            row = hhs_snapshot.data[0]
            available_beds = row["available_beds"]
            wait_minutes = row["estimated_wait_minutes"]
            occupancy = 1 - (available_beds / max(hospital["total_beds"], 1))
            return {
                "available_beds": available_beds,
                "estimated_wait_minutes": wait_minutes,
                "occupancy_rate": occupancy,
                "source": "hhs",
                "last_updated": row.get("snapshot_time")
            }

        # Fall back to any snapshot (monitor agent)
        snapshot = (
            supabase.table("hospital_capacity_snapshots")
            .select("*")
            .eq("hospital_id", hospital["id"])
            .eq("department", department)
            .order("snapshot_time", desc=True)
            .limit(1)
            .execute()
        )
        if snapshot.data:
            row = snapshot.data[0]
            available_beds = row["available_beds"]
            wait_minutes = row["estimated_wait_minutes"]
            occupancy = 1 - (available_beds / max(hospital["total_beds"], 1))
            return {
                "available_beds": available_beds,
                "estimated_wait_minutes": wait_minutes,
                "occupancy_rate": occupancy,
                "source": row.get("source", "monitor_agent"),
                "last_updated": row.get("snapshot_time")
            }
    except Exception:
        pass

    # True fallback — log it so we know no snapshot data was available
    sim = simulate_capacity(hospital)
    sim["source"] = "simulated_fallback"
    sim["last_updated"] = None
    return sim


def score_hospital(
    hospital: dict,
    triage: dict,
    user_lat: float,
    user_lon: float,
    insurance: str = None
) -> dict:
    department = triage.get("identified_department", "general")
    esi_level = triage.get("esi_level", 3)

    capacity = get_capacity(hospital, department)
    available_beds = capacity["available_beds"]
    wait_minutes = capacity["estimated_wait_minutes"]

    # Department match does this hospital have the right department
    dept_score = 100 if department in hospital.get("departments", []) else 20
    bed_score = min(100, (available_beds / max(hospital["total_beds"], 1)) * 100)
    availability_score = (dept_score * 0.6) + (bed_score * 0.4)

    # Wait time stricter threshold for high ESI
    max_wait = 30 if esi_level <= 2 else (90 if esi_level == 3 else 180)
    wait_score = max(0, 100 - (wait_minutes / max_wait * 100))

    # Distance & drive time
    distance = haversine_distance(user_lat, user_lon, hospital["latitude"], hospital["longitude"])

    # Try Google Directions for traffic-aware drive time
    drive_info = get_drive_time(user_lat, user_lon, hospital["latitude"], hospital["longitude"])
    if drive_info:
        drive_time_minutes = drive_info["drive_time_minutes"]
        distance = drive_info["distance_miles"]
        encoded_polyline = drive_info["encoded_polyline"]
        # Score by drive time: 60 min drive = 0 score
        distance_score = max(0, 100 - (drive_time_minutes / 60 * 100))
    else:
        drive_time_minutes = round(distance / 30 * 60)  # estimate ~30mph avg
        encoded_polyline = None
        distance_score = max(0, 100 - (distance * 5))

    # Insurance EMTALA: ESI 1/2 must be treated regardless of insurance
    if esi_level <= 2:
        insurance_score = 100
    elif insurance and insurance in hospital.get("accepted_insurances", []):
        insurance_score = 100
    else:
        insurance_score = 0

    # ESI 1 shift weight toward distance
    if esi_level == 1:
        final_score = (
            availability_score * 0.35
            + wait_score * 0.25
            + distance_score * 0.35   # boosted from 0.20
            + insurance_score * 0.05  # reduced EMTALA covers it anyway
        )
    else:
        final_score = (
            availability_score * 0.40
            + wait_score * 0.30
            + distance_score * 0.20
            + insurance_score * 0.10
        )

    return {
        "score": round(final_score, 2),
        "distance_miles": round(distance, 1),
        "drive_time_minutes": drive_time_minutes,
        "encoded_polyline": encoded_polyline,
        "available_beds": available_beds,
        "estimated_wait_minutes": wait_minutes,
        "department_match": department in hospital.get("departments", []),
        "capacity_source": capacity["source"],
        "last_updated": capacity.get("last_updated")
    }


# Main handler

@routing_protocol.on_query(model=RoutingRequest, replies={GatewayTriageResponse})
async def handle_routing_request(ctx: Context, sender: str, msg: RoutingRequest):
    triage = msg.triage_result

    # Pull out the gateway address that symptom agent carried through
    gateway_address = triage.pop("_gateway_address", sender)

    ctx.logger.info(
        f"[RoutingAgent] ESI {triage.get('esi_level')} — {triage.get('identified_department')} "
        f"— routing for user {msg.user_id}"
    )

    try:
        hospitals = supabase.table("hospitals").select("*").execute().data

        scored = sorted(
            [
                {
                    "hospital": h,
                    "metrics": score_hospital(
                        h, triage, msg.user_latitude, msg.user_longitude, msg.insurance_provider
                    )
                }
                for h in hospitals
            ],
            key=lambda x: x["metrics"]["score"],
            reverse=True
        )

        top3 = [
            {
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
                "drive_time_minutes": item["metrics"]["drive_time_minutes"],
                "encoded_polyline": item["metrics"].get("encoded_polyline"),
                "available_beds": item["metrics"]["available_beds"],
                "estimated_wait_minutes": item["metrics"]["estimated_wait_minutes"],
                "department_match": item["metrics"]["department_match"],
                "total_beds": item["hospital"]["total_beds"],
                "capacity_source": item["metrics"]["capacity_source"],
                "last_updated": item["metrics"].get("last_updated")
            }
            for item in scored[:3]
        ]

        session = supabase.table("routing_sessions").insert({
            "user_id": msg.user_id,
            "symptom_input": triage.get("urgency_summary", ""),
            "esi_level": triage.get("esi_level"),
            "identified_department": triage.get("identified_department"),
            "recommended_hospitals": top3
        }).execute()

        session_id = session.data[0]["id"] if session.data else "unknown"

        ctx.logger.info(
            f"[RoutingAgent] Top hospital: {top3[0]['name']} "
            f"(score {top3[0]['score']}, source: {top3[0]['capacity_source']}) "
            f"— session {session_id}"
        )

        # Reply directly to the gateway
        await ctx.send(gateway_address, GatewayTriageResponse(
            user_id=msg.user_id,
            triage=triage,
            recommended_hospitals=top3,
            session_id=session_id
        ))

    except Exception as e:
            ctx.logger.error(f"[RoutingAgent] Error: {e}")
            await ctx.send(sender, GatewayTriageResponse(
                user_id=msg.user_id,
                triage=triage,
                recommended_hospitals=[],
                session_id="error"
            ))


routing_agent.include(routing_protocol, publish_manifest=True)

if __name__ == "__main__":
    routing_agent.run()