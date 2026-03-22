import os
import random
from uagents import Agent, Context, Protocol
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

monitor_agent = Agent(
    name="monitor_agent",
    seed="careroute_monitor_agent_seed",
    port=8003,
    endpoint=["http://localhost:8003/submit"]
)

DEPARTMENTS = ["ICU", "surgery", "pediatric", "psychiatric", "general"]


@monitor_agent.on_interval(period=30.0)
async def update_capacity(ctx: Context):
    """Every 30 seconds, simulate capacity changes for all hospitals."""
    ctx.logger.info("[MonitorAgent] Updating hospital capacity snapshots...")

    try:
        hospitals = supabase.table("hospitals").select("id, total_beds, base_occupancy_rate, departments").execute().data

        snapshots = []
        for hospital in hospitals:
            for dept in hospital.get("departments", ["general"]):
                base_rate = hospital.get("base_occupancy_rate", 0.75)
                occupancy = min(0.98, max(0.3, base_rate + random.uniform(-0.2, 0.2)))
                total_beds = hospital.get("total_beds", 50)
                available_beds = max(1, int(total_beds * (1 - occupancy)))

                if occupancy < 0.6:
                    wait = random.randint(10, 30)
                elif occupancy < 0.8:
                    wait = random.randint(30, 90)
                else:
                    wait = random.randint(90, 240)

                snapshots.append({
                    "hospital_id": hospital["id"],
                    "department": dept,
                    "available_beds": available_beds,
                    "estimated_wait_minutes": wait
                })

        # Insert in batches
        batch_size = 50
        for i in range(0, len(snapshots), batch_size):
            supabase.table("hospital_capacity_snapshots").insert(snapshots[i:i+batch_size]).execute()

        ctx.logger.info(f"[MonitorAgent] Updated {len(snapshots)} snapshots")

    except Exception as e:
        ctx.logger.error(f"[MonitorAgent] Error: {e}")