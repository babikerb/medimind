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

    # Print first record so we can see the actual column names
    if raw:
        print("Sample columns:", list(raw[0].keys())[:10])

    hospitals = []
    for h in raw:
        # Filter to LA and Orange County only
        county_raw = h.get("COUNTY", h.get("county", "")).strip()
        if county_raw not in ("Los Angeles", "Orange"):
            continue

        # Filter to General Acute Care Hospitals only
        fac_type = h.get("FACTYPE", h.get("factype", "")).strip()
        if "General Acute Care" not in fac_type:
            continue

        name = h.get("FACNAME", h.get("facname", "")).strip()
        if not name:
            continue

        lat = h.get("LATITUDE", h.get("latitude", "")).strip()
        lon = h.get("LONGTITUDE", h.get("longtitude", h.get("longitude", ""))).strip()
        if not lat or not lon:
            continue

        try:
            lat = float(lat)
            lon = float(lon)
        except ValueError:
            continue

        total_beds = h.get("NUMBED", h.get("numbed", "0")).strip()
        try:
            total_beds = int(float(total_beds))
        except ValueError:
            total_beds = 0
        if total_beds == 0:
            continue

        county = "LA" if county_raw == "Los Angeles" else "Orange"

        hospitals.append({
            "name": name,
            "address": h.get("FACADDR", h.get("facaddr", "")).strip(),
            "latitude": lat,
            "longitude": lon,
            "county": county,
            "departments": infer_departments(name, fac_type),
            "total_beds": total_beds,
            "base_occupancy_rate": 0.75,
            "accepted_insurances": DEFAULT_INSURANCES,
            "phone": h.get("FACPHONE", h.get("facphone", "")).strip(),
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