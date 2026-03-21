import os
import requests
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# CHHS Socrata endpoint for hospital data
CHHS_URL = "https://data.chhs.ca.gov/resource/uqjm-ix6e.json"

# Insurance accepted — curated for SoCal demo
DEFAULT_INSURANCES = [
    "Blue Shield",
    "Anthem Blue Cross",
    "Kaiser Permanente",
    "Medi-Cal",
    "Aetna",
    "Cigna"
]

# Department mapping based on hospital type/name keywords
def infer_departments(hospital_name: str, facility_type: str) -> list:
    name = hospital_name.lower()
    dept = ["general"]

    if any(k in name for k in ["children", "pediatric", "maternity", "women"]):
        dept.append("pediatric")
    if any(k in name for k in ["heart", "cardiac", "cardio"]):
        dept.append("ICU")
    if any(k in name for k in ["surgical", "surgery", "ortho"]):
        dept.append("surgery")
    if any(k in name for k in ["psychiatric", "behavioral", "mental"]):
        dept.append("psychiatric")
    if "trauma" in name or "level i" in facility_type.lower():
        dept.append("ICU")

    # All ERs get ICU as a fallback if no specialty detected
    if len(dept) == 1:
        dept.append("ICU")

    return list(set(dept))


def fetch_hospitals():
    params = {
        "$limit": 500,
        "$where": "county in('Los Angeles', 'Orange')",
    }
    response = requests.get(CHHS_URL, params=params)
    response.raise_for_status()
    return response.json()


def seed():
    print("Fetching hospitals from CHHS...")
    raw = fetch_hospitals()
    print(f"Found {len(raw)} records")

    hospitals = []
    for h in raw:
        # Skip if missing critical fields
        if not h.get("facility_name") or not h.get("county"):
            continue
        if not h.get("latitude") or not h.get("longitude"):
            continue

        name = h.get("facility_name", "")
        facility_type = h.get("type_of_care", "")
        county_raw = h.get("county", "")
        county = "LA" if county_raw == "Los Angeles" else "Orange"

        total_beds = int(h.get("number_of_beds", 0) or 0)
        if total_beds == 0:
            continue  # skip facilities with no bed data

        hospitals.append({
            "name": name,
            "address": h.get("facility_address", ""),
            "latitude": float(h.get("latitude")),
            "longitude": float(h.get("longitude")),
            "county": county,
            "departments": infer_departments(name, facility_type),
            "total_beds": total_beds,
            "base_occupancy_rate": 0.75,  # CHHS average baseline
            "accepted_insurances": DEFAULT_INSURANCES,
            "phone": h.get("facility_phone_number", ""),
        })

    print(f"Inserting {len(hospitals)} valid hospitals into Supabase...")

    # Insert in batches of 50
    batch_size = 50
    for i in range(0, len(hospitals), batch_size):
        batch = hospitals[i:i + batch_size]
        supabase.table("hospitals").insert(batch).execute()
        print(f"  Inserted batch {i // batch_size + 1}")

    print("Done! Hospitals seeded successfully.")


if __name__ == "__main__":
    seed()