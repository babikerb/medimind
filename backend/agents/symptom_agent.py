import os
import json
import requests
from uagents import Agent, Context, Protocol
from models import (
    SymptomRequest,
    FollowUpQuestionsResponse,
    FollowUpAnswersRequest,
    TriageResult
)
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
ROUTING_AGENT_ADDRESS = os.getenv("ROUTING_AGENT_ADDRESS", "")

symptom_agent = Agent(
    name="symptom_agent",
    seed="careroute_symptom_agent_seed",
    port=8001,
    endpoint=["http://localhost:8001/submit"]
)

protocol = Protocol("SymptomProtocol")


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
            "temperature": 0.1
        }
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"].strip()


# --- STEP 1: Receive symptoms, return follow-up questions ---
@protocol.on_message(model=SymptomRequest)
async def handle_symptom_input(ctx: Context, sender: str, msg: SymptomRequest):
    ctx.logger.info(f"Received symptoms from {msg.user_id}: {msg.symptom_input}")

    system_prompt = """
You are a medical triage assistant. A patient has described their symptoms.
Generate 1-5 focused follow-up questions to better classify urgency and department needed.

Rules:
- Ask only what is clinically relevant to the symptoms described
- Do not ask more than 5 questions
- Questions should be simple enough for a non-medical person to answer
- Respond ONLY with a valid JSON array of strings, no explanation, no markdown
Example: ["How long have you had this pain?", "Is the pain sharp or dull?"]
"""

    profile_context = ""
    if msg.patient_profile:
        age = msg.patient_profile.get("age")
        meds = msg.patient_profile.get("medications", [])
        history = msg.patient_profile.get("medical_history", [])
        if age:
            profile_context += f"Patient age: {age}\n"
        if meds:
            profile_context += f"Medications: {', '.join(meds)}\n"
        if history:
            profile_context += f"Medical history: {', '.join(history)}\n"

    user_message = f"{profile_context}Symptoms: {msg.symptom_input}"

    try:
        raw = call_groq(system_prompt, user_message)
        # Strip markdown fences if present
        raw = raw.replace("```json", "").replace("```", "").strip()
        questions = json.loads(raw)
        # Flatten if Groq returned list of objects instead of strings
        if questions and isinstance(questions[0], dict):
            questions = [q.get("question", str(q)) for q in questions]
    except Exception as e:
        ctx.logger.error(f"Failed to generate questions: {e}")
        questions = ["Can you describe your symptoms in more detail?"]

    await ctx.send(sender, FollowUpQuestionsResponse(
        user_id=msg.user_id,
        symptom_input=msg.symptom_input,
        questions=questions,
        patient_profile=msg.patient_profile
    ))


# --- STEP 2: Receive answers, return ESI triage result ---
@protocol.on_message(model=FollowUpAnswersRequest)
async def handle_followup_answers(ctx: Context, sender: str, msg: FollowUpAnswersRequest):
    ctx.logger.info(f"Received follow-up answers from {msg.user_id}")

    system_prompt = """
You are a medical triage assistant trained on the Emergency Severity Index (ESI) framework.

ESI Levels:
- ESI 1: Immediate life threat. Requires immediate intervention. (cardiac arrest, severe respiratory failure)
- ESI 2: High risk. Confused, lethargic, or severe pain. (stroke, chest pain, overdose)
- ESI 3: Stable but needs multiple resources. (abdominal pain, moderate injury, fever with infection)
- ESI 4: Stable, needs one resource. (minor laceration, UTI, mild asthma)
- ESI 5: No resources needed. (prescription refill, minor cold, small rash)

Departments:
- ICU: cardiac, neurological, respiratory, multi-trauma, overdose
- surgery: fractures, appendicitis, internal bleeding, lacerations requiring OR
- pediatric: patients under 18 with any condition
- psychiatric: mental health crisis, suicidal ideation, psychosis
- general: everything else

Respond ONLY with a valid JSON object, no explanation, no markdown.
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
}
"""

    qa_pairs = ""
    for q, a in zip(msg.questions, msg.answers):
        qa_pairs += f"Q: {q}\nA: {a}\n"

    profile_context = ""
    if msg.patient_profile:
        age = msg.patient_profile.get("age")
        meds = msg.patient_profile.get("medications", [])
        history = msg.patient_profile.get("medical_history", [])
        if age:
            profile_context += f"Patient age: {age}\n"
        if meds:
            profile_context += f"Medications: {', '.join(meds)}\n"
        if history:
            profile_context += f"Medical history: {', '.join(history)}\n"

    user_message = f"{profile_context}Initial symptoms: {msg.symptom_input}\n\nFollow-up:\n{qa_pairs}"

    try:
        raw = call_groq(system_prompt, user_message)
        raw = raw.replace("```json", "").replace("```", "").strip()
        result = json.loads(raw)
    except Exception as e:
        ctx.logger.error(f"Triage parsing failed: {e}")
        result = {
            "esi_level": 3,
            "identified_department": "general",
            "urgency_summary": "Unable to parse triage. Defaulting to ESI 3.",
            "recommended_care_type": "emergency_room",
            "flags": {"call_911": False, "redirect_to_urgent_care": False, "emtala_applies": False}
        }

    triage = TriageResult(
        user_id=msg.user_id,
        esi_level=result["esi_level"],
        identified_department=result["identified_department"],
        urgency_summary=result["urgency_summary"],
        recommended_care_type=result["recommended_care_type"],
        call_911=result["flags"]["call_911"],
        redirect_to_urgent_care=result["flags"]["redirect_to_urgent_care"],
        emtala_applies=result["flags"]["emtala_applies"]
    )

    if ROUTING_AGENT_ADDRESS:
        await ctx.send(ROUTING_AGENT_ADDRESS, triage)
    else:
        ctx.logger.warning("ROUTING_AGENT_ADDRESS not set — triage result not forwarded")

    await ctx.send(sender, triage)


symptom_agent.include(protocol)

if __name__ == "__main__":
    symptom_agent.run()