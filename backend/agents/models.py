from uagents import Model
from typing import Optional, List

# --- Symptom Agent Messages ---

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

# --- Routing Agent Messages ---

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

# --- Monitor Agent Messages ---

class CapacityUpdateRequest(Model):
    hospital_id: str

class CapacitySnapshot(Model):
    hospital_id: str
    department: str
    available_beds: int
    estimated_wait_minutes: int

# --- Alert Agent Messages ---

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