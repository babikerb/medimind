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

from agents.models import ForceCapacityRefresh, CapacityRefreshComplete

monitor_protocol = Protocol("MonitorProtocol")

DEPARTMENTS = ["ICU", "surgery", "pediatric", "psychiatric", "general"]


# Core capacity update logic

# Fetches all hospitals from Supabase, simulates realistic capacity fluctuations
# for every department each hospital supports, and writes a fresh snapshot batch
# Returns the number of snapshots written
async def run_capacity_update(ctx: Context) -> int:

    hospitals = supabase.table("hospitals") \
        .select("id, total_beds, base_occupancy_rate, departments") \
        .execute().data

    snapshots = []
    for hospital in hospitals:
        for dept in hospital.get("departments", ["general"]):
            base_rate = hospital.get("base_occupancy_rate", 0.75)

            # Simulate realistic drift around the hospital's baseline occupancy
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

    # Insert in batches of 50 to stay within Supabase limits
    batch_size = 50
    for i in range(0, len(snapshots), batch_size):
        supabase.table("hospital_capacity_snapshots") \
            .insert(snapshots[i:i + batch_size]) \
            .execute()

    ctx.logger.info(f"[MonitorAgent] Wrote {len(snapshots)} capacity snapshots")
    return len(snapshots)


# Interval: keep snapshots fresh every 30 seconds

@monitor_agent.on_interval(period=30.0)
async def update_capacity(ctx: Context):
    ctx.logger.info("[MonitorAgent] Interval tick — refreshing all snapshots...")
    try:
        await run_capacity_update(ctx)
    except Exception as e:
        ctx.logger.error(f"[MonitorAgent] Interval update failed: {e}")


# On demand gateway requests a forced refresh before first routing call

@monitor_protocol.on_message(model=ForceCapacityRefresh, replies={CapacityRefreshComplete})
async def handle_force_refresh(ctx: Context, sender: str, msg: ForceCapacityRefresh):
    ctx.logger.info(f"[MonitorAgent] Force refresh requested by {msg.requester}")
    try:
        count = await run_capacity_update(ctx)
        await ctx.send(sender, CapacityRefreshComplete(snapshots_written=count))
    except Exception as e:
        ctx.logger.error(f"[MonitorAgent] Force refresh failed: {e}")
        await ctx.send(sender, CapacityRefreshComplete(snapshots_written=0))


monitor_agent.include(monitor_protocol, publish_manifest=True)