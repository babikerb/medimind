import os
import csv
import io
import requests
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Direct CSV download from CHHS
CHHS_CSV_URL = "https://data.chhs.ca.gov/dataset/3b5b80e8-6b8d-4715-b3c0-2699af6e72e5/resource/f0ae5731-fef8-417f-839d-54a0ed3a126e/download/health_facility_locations.csv"

DEFAULT_INSURANCES = [
    "Blue Shield", "Anthem Blue Cross", "Kaiser Permanente",
    "Medi-Cal", "Aetna", "Cigna"
]

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
    if len(dept) == 1:
        dept.append("ICU")
    return list(set(dept))

def fetch_hospitals():
    print("Downloading CSV from CHHS...")
    response = requests.get(CHHS_CSV_URL)
    response.raise_for_status()
    reader = csv.DictReader(io.StringIO(response.text))
    return list(reader)

def seed():
    raw = fetch_hospitals()
    print(f"Total records in CSV: {len(raw)}")

    hospitals = []
    for h in raw:
        # Filter to LA and Orange County only
        county_raw = h.get("COUNTY_NAME", "").strip()
        if county_raw not in ("LOS ANGELES", "ORANGE"):
            continue

        # Filter to General Acute Care Hospitals only
        fac_type = h.get("TYPE_OF_CARE", "").strip()
        fac_fdr = h.get("FAC_FDR", "").strip()
        if "GENERAL ACUTE CARE" not in fac_fdr.upper() and "GENERAL ACUTE CARE" not in fac_type.upper():
            continue

        # Skip closed facilities
        if h.get("FAC_STATUS_TYPE_CODE", "").strip() != "OPEN":
            continue

        name = h.get("FACNAME", "").strip()
        if not name:
            continue

        lat = h.get("LATITUDE", "").strip()
        lon = h.get("LONGITUDE", "").strip()
        if not lat or not lon:
            continue

        try:
            lat = float(lat)
            lon = float(lon)
        except ValueError:
            continue

        total_beds = h.get("CAPACITY", "0").strip()
        try:
            total_beds = int(float(total_beds))
        except ValueError:
            total_beds = 0
        if total_beds == 0:
            continue

        county = "LA" if county_raw == "LOS ANGELES" else "Orange"

        # Check trauma center flags for department inference
        trauma = h.get("TRAUMA_CTR", "").strip()
        is_trauma = trauma != ""

        hospitals.append({
            "name": name,
            "address": h.get("ADDRESS", "").strip() + ", " + h.get("CITY", "").strip(),
            "latitude": lat,
            "longitude": lon,
            "county": county,
            "departments": infer_departments(name, fac_fdr + " " + ("trauma" if is_trauma else "")),
            "total_beds": total_beds,
            "base_occupancy_rate": 0.75,
            "accepted_insurances": DEFAULT_INSURANCES,
            "phone": h.get("CONTACT_PHONE_NUMBER", "").strip(),
        })

    print(f"Inserting {len(hospitals)} valid hospitals into Supabase...")
    batch_size = 50
    for i in range(0, len(hospitals), batch_size):
        batch = hospitals[i:i + batch_size]
        supabase.table("hospitals").insert(batch).execute()
        print(f"  Inserted batch {i // batch_size + 1}")

    print("Done!")

if __name__ == "__main__":
    seed()