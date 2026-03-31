from uagents import Model
from typing import Optional, List

# Symptom Agent
class SymptomRequest(Model):
    user_id: str
    symptom_input: str
    patient_profile: Optional[dict] = None

class FollowUpQuestionsResponse(Model):
    user_id: str
    symptom_input: str
    questions: List[str]
    patient_profile: Optional[dict] = None

class FollowUpAnswersRequest(Model):
    user_id: str
    symptom_input: str
    questions: List[str]
    answers: List[str]
    patient_profile: Optional[dict] = None

class TriageResult(Model):
    user_id: str
    esi_level: int
    identified_department: str
    urgency_summary: str
    recommended_care_type: str
    call_911: bool
    redirect_to_urgent_care: bool
    emtala_applies: bool

# Routing Agent

class RoutingRequest(Model):
    user_id: str
    triage_result: dict
    user_latitude: float
    user_longitude: float
    insurance_provider: Optional[str] = None

class RoutingResponse(Model):
    user_id: str
    recommended_hospitals: List[dict]
    esi_level: int
    session_id: str

# Monitor Agent

class CapacityUpdateRequest(Model):
    hospital_id: str

class CapacitySnapshot(Model):
    hospital_id: str
    department: str
    available_beds: int
    estimated_wait_minutes: int

class ForceCapacityRefresh(Model):
    requester: str

class CapacityRefreshComplete(Model):
    snapshots_written: int

# Alert Agent

class AlertRequest(Model):
    user_id: str
    session_id: str
    hospital_id: str
    department: str

class AlertNotification(Model):
    user_id: str
    hospital_name: str
    message: str
    new_wait_minutes: int

# Follow up Care Agent

class FollowUpCareRequest(Model):
    user_id: str
    triage: dict
    hospital_name: str

class FollowUpCareResponse(Model):
    user_id: str
    care_plan: dict

# HHS Agent

class HHSRefreshRequest(Model):
    requester: str

class HHSRefreshComplete(Model):
    snapshots_written: int

# Gateway Agent bridge models
# These are the models used for query() based communication
# on_query handlers use these to receive requests and send responses

# Gateway Symptom Agent generate follow up questions
class GatewaySymptomRequest(Model):
    user_id: str
    symptom_input: str
    patient_profile: Optional[dict] = None

class GatewayQuestionsResponse(Model):
    """Symptom Agent → Gateway: follow-up questions ready."""
    user_id: str
    questions: List[str]
    symptom_input: str
    patient_profile: Optional[dict] = None

class GatewayTriageRequest(Model):
    """Gateway → Symptom Agent: score ESI from Q&A answers."""
    user_id: str
    symptom_input: str
    questions: List[str]
    answers: List[str]
    patient_profile: Optional[dict] = None
    user_latitude: float
    user_longitude: float
    insurance_provider: Optional[str] = None

class GatewayTriageResponse(Model):
    """Routing Agent → Gateway: triage + ranked hospitals ready."""
    user_id: str
    triage: dict
    recommended_hospitals: List[dict]
    session_id: str