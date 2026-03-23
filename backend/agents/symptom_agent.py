import os
import json
import requests
from uagents import Agent, Context, Protocol
from dotenv import load_dotenv

load_dotenv()

ASI1_API_KEY = os.getenv("ASI1_API_KEY")

from agents.config import SYMPTOM_AGENT_SEED

symptom_agent = Agent(
    name="symptom_agent",
    seed=SYMPTOM_AGENT_SEED,
    port=8001,
    mailbox=True,
    publish_agent_details=True,
)

from agents.models import (
    GatewaySymptomRequest,
    GatewayQuestionsResponse,
    GatewayTriageRequest,
    GatewayTriageResponse,
)

symptom_protocol = Protocol("SymptomProtocol")


def call_asi1(system_prompt: str, user_message: str) -> str:
    response = requests.post(
        "https://api.asi1.ai/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {ASI1_API_KEY}",
            "Content-Type": "application/json"
        },
        json={
            "model": "asi1-mini",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            "temperature": 0.1
        }
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"].strip()


def build_profile_context(profile: dict) -> str:
    if not profile:
        return ""
    context = ""
    if profile.get("age"):
        context += f"Patient age: {profile['age']}\n"
    if profile.get("medications"):
        context += f"Medications: {', '.join(profile['medications'])}\n"
    if profile.get("medical_history"):
        context += f"Medical history: {', '.join(profile['medical_history'])}\n"
    return context


@symptom_protocol.on_query(model=GatewaySymptomRequest, replies={GatewayQuestionsResponse})
async def handle_symptom_input(ctx: Context, sender: str, msg: GatewaySymptomRequest):
    ctx.logger.info(f"[SymptomAgent] Generating questions for user {msg.user_id}")

    system_prompt = """You are a medical triage assistant. A patient has described their symptoms.
Generate 1-5 focused follow-up questions to better classify urgency and department needed.
Rules:
- Ask only what is clinically relevant
- Max 5 questions
- Simple enough for a non-medical person
- Respond ONLY with a valid JSON array of strings, no explanation, no markdown
Example: ["How long have you had this pain?", "Is the pain sharp or dull?"]"""

    user_message = build_profile_context(msg.patient_profile or {}) + f"Symptoms: {msg.symptom_input}"

    try:
        raw = call_asi1(system_prompt, user_message)
        raw = raw.replace("```json", "").replace("```", "").strip()
        questions = json.loads(raw)
        if questions and isinstance(questions[0], dict):
            questions = [q.get("question", str(q)) for q in questions]
    except Exception as e:
        ctx.logger.error(f"[SymptomAgent] Question generation failed: {e}")
        questions = ["Can you describe your symptoms in more detail?"]

    ctx.logger.info(f"[SymptomAgent] Returning {len(questions)} questions")
    await ctx.send(sender, GatewayQuestionsResponse(
        user_id=msg.user_id,
        symptom_input=msg.symptom_input,
        questions=questions,
        patient_profile=msg.patient_profile
    ))


@symptom_protocol.on_query(model=GatewayTriageRequest, replies={GatewayTriageResponse})
async def handle_triage_request(ctx: Context, sender: str, msg: GatewayTriageRequest):
    ctx.logger.info(f"[SymptomAgent] Scoring ESI for user {msg.user_id}")

    system_prompt = """You are a medical triage assistant trained on the Emergency Severity Index (ESI).

ESI Levels:
- ESI 1: Immediate life threat (cardiac arrest, severe respiratory failure)
- ESI 2: High risk (stroke, chest pain, overdose)
- ESI 3: Stable, needs multiple resources (abdominal pain, moderate injury, fever)
- ESI 4: Stable, needs one resource (minor laceration, UTI, mild asthma)
- ESI 5: No resources needed (prescription refill, minor cold, rash)

Departments:
- ICU: cardiac, neurological, respiratory, multi-trauma, overdose
- surgery: fractures, appendicitis, internal bleeding
- pediatric: patients under 18
- psychiatric: mental health crisis, suicidal ideation
- general: everything else

Respond ONLY with valid JSON, no markdown:
{
  "esi_level": <1-5>,
  "identified_department": "<ICU|surgery|pediatric|psychiatric|general>",
  "urgency_summary": "<one sentence>",
  "recommended_care_type": "<emergency_room|urgent_care|primary_care>",
  "flags": {
    "call_911": <true if ESI 1>,
    "redirect_to_urgent_care": <true if ESI 4 or 5>,
    "emtala_applies": <true if ESI 1 or 2>
  }
}"""

    qa_pairs = "\n".join([f"Q: {q}\nA: {a}" for q, a in zip(msg.questions, msg.answers)])
    user_message = (
        build_profile_context(msg.patient_profile or {})
        + f"Initial symptoms: {msg.symptom_input}\n\nFollow-up:\n{qa_pairs}"
    )

    try:
        raw = call_asi1(system_prompt, user_message)
        raw = raw.replace("```json", "").replace("```", "").strip()
        triage = json.loads(raw)
    except Exception as e:
        ctx.logger.error(f"[SymptomAgent] Triage parsing failed: {e}")
        triage = {
            "esi_level": 3,
            "identified_department": "general",
            "urgency_summary": "Unable to parse triage. Defaulting to ESI 3.",
            "recommended_care_type": "emergency_room",
            "flags": {
                "call_911": False,
                "redirect_to_urgent_care": False,
                "emtala_applies": False
            }
        }

    ctx.logger.info(
        f"[SymptomAgent] ESI {triage['esi_level']} — {triage['identified_department']}"
    )

    await ctx.send(sender, GatewayTriageResponse(
        user_id=msg.user_id,
        triage=triage,
        recommended_hospitals=[],
        session_id=""
    ))


symptom_agent.include(symptom_protocol, publish_manifest=True)

if __name__ == "__main__":
    symptom_agent.run()