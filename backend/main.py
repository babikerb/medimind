from uagents import Bureau
from agents.symptom_agent import symptom_agent
from agents.routing_agent import routing_agent
from agents.monitor_agent import monitor_agent
from agents.alert_agent import alert_agent
from agents.followup_agent import followup_agent

bureau = Bureau(
    port=8000,
    endpoint="http://localhost:8000/submit",
)

bureau.add(symptom_agent)
bureau.add(routing_agent)
bureau.add(monitor_agent)
bureau.add(alert_agent)
bureau.add(followup_agent)

if __name__ == "__main__":
    bureau.run()