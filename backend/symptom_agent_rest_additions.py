from uagents import Model
from typing import Optional, List

class RESTSymptomRequest(Model):
    user_id: str
    symptom_input: str
    patient_profile: Optional[dict] = None

class RESTSymptomResponse(Model):
    questions: List[str]

class RESTTriageRequest(Model):
    user_id: str
    symptom_input: str
    questions: List[str]
    answers: List[str]
    patient_profile: Optional[dict] = None

class RESTTriageResponse(Model):
    triage: dict


# Add to symptom_agent.py:
#
# @symptom_agent.on_rest_post("/rest/symptom/questions", RESTSymptomRequest, RESTSymptomResponse)
# async def rest_questions(ctx: Context, req: RESTSymptomRequest) -> RESTSymptomResponse:
#     """REST endpoint version of question generation."""
#     ctx.logger.info(f"[SymptomAgent REST] Questions for {req.user_id}")
#
#     # ... same Groq call logic as handle_symptom_input ...
#     system_prompt = """..."""
#     user_message = build_profile_context(req.patient_profile or {}) + f"Symptoms: {req.symptom_input}"
#     raw = call_groq(system_prompt, user_message)
#     raw = raw.replace("```json", "").replace("```", "").strip()
#     questions = json.loads(raw)
#
#     return RESTSymptomResponse(questions=questions)
#
#
# @symptom_agent.on_rest_post("/rest/symptom/triage", RESTTriageRequest, RESTTriageResponse)
# async def rest_triage(ctx: Context, req: RESTTriageRequest) -> RESTTriageResponse:
#     """REST endpoint version of ESI scoring."""
#     ctx.logger.info(f"[SymptomAgent REST] Triage for {req.user_id}")
#
#     # ... same Groq call logic as handle_triage_request ...
#     system_prompt = """..."""
#     qa_pairs = "\n".join([f"Q: {q}\nA: {a}" for q, a in zip(req.questions, req.answers)])
#     user_message = build_profile_context(req.patient_profile or {}) + f"Symptoms: {req.symptom_input}\n\n{qa_pairs}"
#     raw = call_groq(system_prompt, user_message)
#     raw = raw.replace("```json", "").replace("```", "").strip()
#     triage = json.loads(raw)
#
#     return RESTTriageResponse(triage=triage)