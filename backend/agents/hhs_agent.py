import os
import requests
from uagents import Agent, Context, Protocol
from supabase import create_client
from dotenv import load_dotenv
from difflib import SequenceMatcher

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

from agents.config import HHS_AGENT_SEED

hhs_agent = Agent(
    name="hhs_agent",
    seed=HHS_AGENT_SEED,
    port=8006,
    mailbox=True,
    publish_agent_details=True,
)

hhs_protocol = Protocol("HHSProtocol")

# HHS Socrata API — COVID-19 Reported Patient Impact and Hospital Capacity
# This dataset includes hospital-level bed utilization reported weekly to HHS
HHS_API_URL = "https://healthdata.gov/resource/anag-cw7u.json"

# Department mapping: HHS fields → our department categories
# HHS provides aggregate numbers; we distribute across departments proportionally
DEPT_BED_FIELDS = {
    "total": {
        "available": "inpatient_beds_available",
        "used": "inpatient_beds_used",
        "total": "inpatient_beds",
    },
    "ICU": {
        "available": "adult_icu_beds_available",
        "used": "adult_icu_beds_used",
        "total": "total_adult_patients_hospitalized_confirmed_and_suspected_covid",  # fallback
    },
}


def normalize_name(name: str) -> str:
    """Normalize hospital name for fuzzy matching."""
    name = name.lower().strip()
    # Remove common suffixes that differ between datasets
    for suffix in [
        " medical center", " med ctr", " hospital", " hosp",
        " health system", " health", " regional", " community",
        " memorial", " general", " campus", " -"
    ]:
        name = name.replace(suffix, "")
    return name.strip()


def match_hospital(hhs_name: str, our_hospitals: list) -> dict | None:
    """Find the best matching hospital from our database using fuzzy matching."""
    hhs_norm = normalize_name(hhs_name)
    best_match = None
    best_score = 0.0

    for hospital in our_hospitals:
        our_norm = normalize_name(hospital["name"])
        score = SequenceMatcher(None, hhs_norm, our_norm).ratio()
        if score > best_score:
            best_score = score
            best_match = hospital

    # Require at least 70% similarity to avoid false matches
    if best_score >= 0.7:
        return best_match
    return None


def safe_int(value, default=0) -> int:
    """Safely convert HHS field values to int, treating -999999 as missing."""
    if value is None:
        return default
    try:
        v = int(float(value))
        # HHS uses -999999 as a sentinel for suppressed/missing data
        if v < 0:
            return default
        return v
    except (ValueError, TypeError):
        return default


def estimate_wait_from_occupancy(occupancy: float) -> int:
    """Estimate wait time based on occupancy rate."""
    if occupancy < 0.6:
        return 15
    elif occupancy < 0.75:
        return 30
    elif occupancy < 0.85:
        return 60
    elif occupancy < 0.95:
        return 120
    else:
        return 240


async def fetch_and_update(ctx: Context) -> int:
    """Fetch latest HHS data for California and update Supabase snapshots."""

    # Fetch our hospitals from Supabase
    our_hospitals = supabase.table("hospitals") \
        .select("id, name, total_beds, departments") \
        .execute().data

    if not our_hospitals:
        ctx.logger.warning("[HHSAgent] No hospitals found in database")
        return 0

    # Query HHS API for California hospitals
    params = {
        "$where": "state='CA'",
        "$limit": 500,
        "$order": "collection_week DESC",
        "$select": (
            "hospital_name,city,state,collection_week,"
            "all_adult_hospital_inpatient_beds_7_day_avg,"
            "inpatient_beds_used_7_day_avg,"
            "all_adult_hospital_inpatient_bed_occupied_7_day_avg,"
            "inpatient_beds_7_day_avg,"
            "total_icu_beds_7_day_avg,icu_beds_used_7_day_avg"
        ),
    }

    try:
        resp = requests.get(HHS_API_URL, params=params, timeout=60)
        resp.raise_for_status()
        hhs_data = resp.json()
    except Exception as e:
        ctx.logger.error(f"[HHSAgent] Failed to fetch HHS data: {e}")
        return 0

    if not hhs_data:
        ctx.logger.warning("[HHSAgent] HHS API returned no data")
        return 0

    ctx.logger.info(f"[HHSAgent] Fetched {len(hhs_data)} HHS records for California")

    # Get only the most recent week per hospital
    latest_by_hospital = {}
    for record in hhs_data:
        name = record.get("hospital_name", "")
        week = record.get("collection_week", "")
        if name and (name not in latest_by_hospital or week > latest_by_hospital[name].get("collection_week", "")):
            latest_by_hospital[name] = record

    ctx.logger.info(f"[HHSAgent] {len(latest_by_hospital)} unique hospitals in latest week")

    # Match HHS hospitals to our database and build snapshots
    snapshots = []
    matched_count = 0

    for hhs_name, record in latest_by_hospital.items():
        matched = match_hospital(hhs_name, our_hospitals)
        if not matched:
            continue

        matched_count += 1
        hospital_id = matched["id"]
        total_beds_db = matched.get("total_beds", 100)
        departments = matched.get("departments", ["general"])

        # Extract HHS capacity numbers (7-day averages reported weekly)
        total_beds_hhs = safe_int(record.get("all_adult_hospital_inpatient_beds_7_day_avg")) or \
                         safe_int(record.get("inpatient_beds_7_day_avg"))
        occupied_beds = safe_int(record.get("all_adult_hospital_inpatient_bed_occupied_7_day_avg")) or \
                        safe_int(record.get("inpatient_beds_used_7_day_avg"))
        total_icu = safe_int(record.get("total_icu_beds_7_day_avg"))
        icu_used = safe_int(record.get("icu_beds_used_7_day_avg"))

        # Use HHS total if available, otherwise fall back to our DB total
        effective_total = total_beds_hhs if total_beds_hhs > 0 else total_beds_db

        # Calculate overall availability
        available_beds = max(0, effective_total - occupied_beds) if effective_total > 0 else 0
        occupancy = occupied_beds / max(effective_total, 1)
        wait = estimate_wait_from_occupancy(occupancy)

        # ICU-specific availability
        icu_available = max(0, total_icu - icu_used) if total_icu > 0 else 0
        icu_occupancy = icu_used / max(total_icu, 1) if total_icu > 0 else 0.85
        icu_wait = estimate_wait_from_occupancy(icu_occupancy)

        # Create a snapshot for each department this hospital supports
        for dept in departments:
            if dept == "ICU" and total_icu > 0:
                snapshots.append({
                    "hospital_id": hospital_id,
                    "department": dept,
                    "available_beds": icu_available,
                    "estimated_wait_minutes": icu_wait,
                    "source": "hhs",
                })
            else:
                # Distribute general beds proportionally across non-ICU departments
                dept_count = len([d for d in departments if d != "ICU"])
                dept_beds = max(1, available_beds // max(dept_count, 1))
                snapshots.append({
                    "hospital_id": hospital_id,
                    "department": dept,
                    "available_beds": dept_beds,
                    "estimated_wait_minutes": wait,
                    "source": "hhs",
                })

    ctx.logger.info(f"[HHSAgent] Matched {matched_count} hospitals, writing {len(snapshots)} snapshots")

    # Insert snapshots in batches
    batch_size = 50
    for i in range(0, len(snapshots), batch_size):
        supabase.table("hospital_capacity_snapshots") \
            .insert(snapshots[i:i + batch_size]) \
            .execute()

    return len(snapshots)


# Poll HHS data every 6 hours (data is updated weekly, but we check frequently
# so we pick up new data within hours of publication)
@hhs_agent.on_interval(period=21600.0)
async def poll_hhs_data(ctx: Context):
    ctx.logger.info("[HHSAgent] Polling HHS HealthData.gov for capacity updates...")
    try:
        count = await fetch_and_update(ctx)
        ctx.logger.info(f"[HHSAgent] Successfully wrote {count} snapshots from HHS data")
    except Exception as e:
        ctx.logger.error(f"[HHSAgent] Poll failed: {e}")


# Also run on startup
@hhs_agent.on_event("startup")
async def startup_fetch(ctx: Context):
    ctx.logger.info("[HHSAgent] Starting up — fetching initial HHS data...")
    try:
        count = await fetch_and_update(ctx)
        ctx.logger.info(f"[HHSAgent] Startup: wrote {count} snapshots")
    except Exception as e:
        ctx.logger.error(f"[HHSAgent] Startup fetch failed: {e}")


# On-demand refresh from gateway
from agents.models import HHSRefreshRequest, HHSRefreshComplete

@hhs_protocol.on_message(model=HHSRefreshRequest, replies={HHSRefreshComplete})
async def handle_refresh(ctx: Context, sender: str, msg: HHSRefreshRequest):
    ctx.logger.info(f"[HHSAgent] Manual refresh requested by {msg.requester}")
    try:
        count = await fetch_and_update(ctx)
        await ctx.send(sender, HHSRefreshComplete(snapshots_written=count))
    except Exception as e:
        ctx.logger.error(f"[HHSAgent] Manual refresh failed: {e}")
        await ctx.send(sender, HHSRefreshComplete(snapshots_written=0))


hhs_agent.include(hhs_protocol, publish_manifest=True)

if __name__ == "__main__":
    hhs_agent.run()
