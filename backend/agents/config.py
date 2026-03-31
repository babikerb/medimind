import os
from dotenv import find_dotenv, load_dotenv
from uagents_core.identity import Identity

load_dotenv(find_dotenv())

SYMPTOM_AGENT_SEED = os.getenv("SYMPTOM_AGENT_SEED_PHRASE")
ROUTING_AGENT_SEED = os.getenv("ROUTING_AGENT_SEED_PHRASE")
MONITOR_AGENT_SEED = os.getenv("MONITOR_AGENT_SEED_PHRASE")
ALERT_AGENT_SEED = os.getenv("ALERT_AGENT_SEED_PHRASE")
FOLLOWUP_AGENT_SEED = os.getenv("FOLLOWUP_AGENT_SEED_PHRASE")
HHS_AGENT_SEED = os.getenv("HHS_AGENT_SEED_PHRASE")

SYMPTOM_AGENT_ADDRESS = Identity.from_seed(seed=SYMPTOM_AGENT_SEED, index=0).address
ROUTING_AGENT_ADDRESS = Identity.from_seed(seed=ROUTING_AGENT_SEED, index=0).address
MONITOR_AGENT_ADDRESS = Identity.from_seed(seed=MONITOR_AGENT_SEED, index=0).address
ALERT_AGENT_ADDRESS = Identity.from_seed(seed=ALERT_AGENT_SEED, index=0).address
FOLLOWUP_AGENT_ADDRESS = Identity.from_seed(seed=FOLLOWUP_AGENT_SEED, index=0).address
HHS_AGENT_ADDRESS = Identity.from_seed(seed=HHS_AGENT_SEED, index=0).address
