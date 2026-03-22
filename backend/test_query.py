import asyncio
import json
import os
from dotenv import load_dotenv

load_dotenv()

from uagents.query import query
from uagents.resolver import RulesBasedResolver
from uagents.envelope import Envelope
from uagents.types import MsgStatus
from agents.models import GatewaySymptomRequest

SYMPTOM_AGENT_ADDRESS = os.getenv("SYMPTOM_AGENT_ADDRESS")
BUREAU_ENDPOINT = "http://localhost:8000/submit"

resolver = RulesBasedResolver({
    SYMPTOM_AGENT_ADDRESS: BUREAU_ENDPOINT,
})


async def test():
    print(f"Sending query to: {SYMPTOM_AGENT_ADDRESS}")
    print(f"Via endpoint:     {BUREAU_ENDPOINT}")
    print()

    msg = GatewaySymptomRequest(
        user_id="test_user",
        symptom_input="I have a headache and mild fever",
        patient_profile=None
    )

    try:
        response = await query(
            destination=SYMPTOM_AGENT_ADDRESS,
            message=msg,
            resolver=resolver,
            timeout=30
        )

        print(f"Response type: {type(response)}")
        print()

        if isinstance(response, Envelope):
            payload = response.decode_payload()
            print(f"SUCCESS — Envelope received!")
            print(f"Raw payload: {payload}")
            try:
                data = json.loads(payload)
                print(f"Parsed JSON: {json.dumps(data, indent=2)}")
            except json.JSONDecodeError:
                print(f"Could not parse as JSON")

        elif isinstance(response, MsgStatus):
            print(f"FAILED — MsgStatus received")
            print(f"Status: {response.status}")
            print(f"Detail: {response.detail}")

        else:
            print(f"UNEXPECTED — Got: {response}")

    except Exception as e:
        print(f"EXCEPTION: {type(e).__name__}: {e}")


if __name__ == "__main__":
    asyncio.run(test())