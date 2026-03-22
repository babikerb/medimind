import os
import json
import requests
from uagents import Agent, Context, Protocol
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

followup_agent = Agent(
    name="followup_agent",
    seed="careroute_followup_agent_seed",
    port=8005,
    endpoint=["http://localhost:8005/submit"]
)

from agents.models import FollowUpCareRequest, FollowUpCareResponse

followup_protocol = Protocol("FollowUpCareProtocol")


def call_groq(system_prompt: str, user_message: str) -> str:
    response = requests.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json"
        },
        json={
            "model": "llama-3.3-70b-versatile",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            "temperature": 0.2
        }
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"].strip()


@followup_protocol.on_message(model=FollowUpCareRequest, replies={FollowUpCareResponse}, allow_unverified=True)
async def handle_followup_request(ctx: Context, sender: str, msg: FollowUpCareRequest):
    ctx.logger.info(f"[FollowUpAgent] Generating care plan for user {msg.user_id}")

    system_prompt = """You are a post-emergency care advisor. Based on the patient's ER triage results,
generate a follow-up care plan.

Respond ONLY with valid JSON, no markdown:
{
  "follow_up_timeline": "<when to see a doctor next, e.g. 'Within 24-48 hours'>",
  "specialist_referrals": ["<specialist type if needed>"],
  "medications_to_discuss": ["<common medications for this condition to ask the doctor about>"],
  "warning_signs": ["<symptoms that mean return to ER immediately>"],
  "home_care_instructions": ["<what to do at home>"],
  "lifestyle_recommendations": ["<longer term suggestions>"]
}"""

    user_message = (
        f"ESI Level: {msg.triage.get('esi_level')}\n"
        f"Department: {msg.triage.get('identified_department')}\n"
        f"Summary: {msg.triage.get('urgency_summary')}\n"
        f"Care Type: {msg.triage.get('recommended_care_type')}\n"
        f"Hospital: {msg.hospital_name}"
    )

    try:
        raw = call_groq(system_prompt, user_message)
        raw = raw.replace("```json", "").replace("```", "").strip()
        care_plan = json.loads(raw)
    except Exception as e:
        ctx.logger.error(f"[FollowUpAgent] Care plan generation failed: {e}")
        care_plan = {
            "follow_up_timeline": "See your primary care doctor within 48 hours",
            "specialist_referrals": [],
            "medications_to_discuss": [],
            "warning_signs": ["Return to ER if symptoms worsen"],
            "home_care_instructions": ["Rest and stay hydrated"],
            "lifestyle_recommendations": []
        }

    ctx.logger.info(f"[FollowUpAgent] Care plan generated for user {msg.user_id}")
    await ctx.send(sender, FollowUpCareResponse(
        user_id=msg.user_id,
        care_plan=care_plan
    ))


followup_agent.include(followup_protocol, publish_manifest=True)

if __name__ == "__main__":
    followup_agent.run()