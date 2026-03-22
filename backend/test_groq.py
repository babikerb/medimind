import os
import requests
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

def test_groq():
    print("Key loaded:", GROQ_API_KEY[:8] if GROQ_API_KEY else "NOT FOUND")

    url = "https://api.groq.com/openai/v1/chat/completions"

    payload = {
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {
                "role": "system",
                "content": "You are a medical triage assistant. Respond only in JSON, no markdown."
            },
            {
                "role": "user",
                "content": "Patient symptoms: chest pain radiating to left arm, sweating, nausea. Generate 3 follow-up questions as a JSON array."
            }
        ],
        "temperature": 0.1
    }

    response = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json"
        },
        json=payload
    )
    print("Status:", response.status_code)
    print("Response:", response.json()["choices"][0]["message"]["content"])

if __name__ == "__main__":
    test_groq()