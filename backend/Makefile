PYTHON = .venv/bin/python3

symptom:
	$(PYTHON) -m agents.symptom_agent

routing:
	$(PYTHON) -m agents.routing_agent

monitor:
	$(PYTHON) -m agents.monitor_agent

alert:
	$(PYTHON) -m agents.alert_agent

followup:
	$(PYTHON) -m agents.followup_agent

hhs:
	$(PYTHON) -m agents.hhs_agent

gateway:
	$(PYTHON) -m uvicorn gateway:app --host 0.0.0.0 --port 8080 --reload

all-agents:
	@echo "Starting all agents in background..."
	$(PYTHON) -m agents.symptom_agent &
	$(PYTHON) -m agents.routing_agent &
	$(PYTHON) -m agents.monitor_agent &
	$(PYTHON) -m agents.alert_agent &
	$(PYTHON) -m agents.followup_agent &
	$(PYTHON) -m agents.hhs_agent &
	@echo "All agents started. Run 'make gateway' in another terminal."

kill-agents:
	@echo "Killing all background agent processes..."
	-lsof -t -i :8001 -i :8002 -i :8003 -i :8004 -i :8005 | xargs kill -9 2>/dev/null || true
	@echo "All agents stopped."
