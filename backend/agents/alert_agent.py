import os
from uagents import Agent, Context, Protocol
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

alert_agent = Agent(
    name="alert_agent",
    seed="careroute_alert_agent_seed",
    port=8004,
    endpoint=["http://localhost:8004/submit"]
)

from agents.models import AlertRequest, AlertNotification

alert_protocol = Protocol("AlertProtocol")

# In-memory store of active user alerts
# { session_id: { user_id, hospital_id, department, last_wait } }
active_alerts = {}


@alert_protocol.on_message(model=AlertRequest, replies={AlertNotification})
async def handle_alert_request(ctx: Context, sender: str, msg: AlertRequest):
    """Register a user to receive alerts for their recommended hospital."""
    ctx.logger.info(f"[AlertAgent] Registering alert for user {msg.user_id} hospital {msg.hospital_id}")
    active_alerts[msg.session_id] = {
        "user_id": msg.user_id,
        "hospital_id": msg.hospital_id,
        "department": msg.department,
        "sender": sender,
        "last_wait": None
    }


@alert_agent.on_interval(period=60.0)
async def check_for_changes(ctx: Context):
    """Every 60 seconds check if any monitored hospital's status changed significantly."""
    if not active_alerts:
        return

    ctx.logger.info(f"[AlertAgent] Checking {len(active_alerts)} active alerts...")

    for session_id, alert in list(active_alerts.items()):
        try:
            snapshot = supabase.table("hospital_capacity_snapshots") \
                .select("*") \
                .eq("hospital_id", alert["hospital_id"]) \
                .eq("department", alert["department"]) \
                .order("snapshot_time", desc=True) \
                .limit(1) \
                .execute()

            if not snapshot.data:
                continue

            current_wait = snapshot.data[0]["estimated_wait_minutes"]
            last_wait = alert.get("last_wait")

            # Alert if wait time changed by more than 20 minutes
            if last_wait is not None and abs(current_wait - last_wait) >= 20:
                hospital = supabase.table("hospitals") \
                    .select("name").eq("id", alert["hospital_id"]).execute()
                hospital_name = hospital.data[0]["name"] if hospital.data else "Your hospital"

                direction = "increased" if current_wait > last_wait else "decreased"
                message = f"Wait time at {hospital_name} has {direction} to {current_wait} minutes."

                ctx.logger.info(f"[AlertAgent] Sending alert: {message}")
                await ctx.send(alert["sender"], AlertNotification(
                    user_id=alert["user_id"],
                    hospital_name=hospital_name,
                    message=message,
                    new_wait_minutes=current_wait
                ))

            active_alerts[session_id]["last_wait"] = current_wait

        except Exception as e:
            ctx.logger.error(f"[AlertAgent] Error checking alert {session_id}: {e}")


alert_agent.include(alert_protocol, publish_manifest=True)