symptom:
	python -m agents.symptom_agent

routing:
	python -m agents.routing_agent

monitor:
	python -m agents.monitor_agent

alert:
	python -m agents.alert_agent

followup:
	python -m agents.followup_agent

gateway:
	uvicorn gateway:app --host 0.0.0.0 --port 8080 --reload

all-agents:
	@echo "Starting all agents in background..."
	python -m agents.symptom_agent &
	python -m agents.routing_agent &
	python -m agents.monitor_agent &
	python -m agents.alert_agent &
	python -m agents.followup_agent &
	@echo "All agents started. Run 'make gateway' in another terminal."
