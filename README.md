# MediMind

MediMind is a mobile health triage and hospital routing app built with React Native (Expo) and a Python multi-agent backend. Users describe their symptoms, answer AI-generated follow-up questions, receive an ESI (Emergency Severity Index) triage score, and get ranked hospital recommendations based on proximity, wait times, bed availability, and insurance compatibility.

## Architecture

### Frontend (Expo / React Native)

A file-based routed Expo app using Supabase for auth and user profiles.

**Screens:**

- `(auth)/welcome` - Landing page
- `(auth)/login` / `signup` - Supabase email auth
- `(auth)/onboarding` - New user profile setup
- `(tabs)/index` - Home dashboard
- `(tabs)/profile` - User profile
- `diagnose` - Symptom input and AI follow-up questions
- `results` - Triage results with ranked hospital list and map
- `care-plan` - AI-generated follow-up care plan
- `insurance-scan` - Insurance card OCR via camera
- `admin-dashboard` - Hospital capacity overview

### Backend (Python / FastAPI + Fetch.ai uAgents)

Six autonomous agents registered on Fetch.ai Agentverse, coordinated by a FastAPI gateway.

| Agent | Port | Role |
|-------|------|------|
| Symptom Agent | 8001 | Generates follow-up questions and ESI triage scoring via AI |
| Routing Agent | 8002 | Ranks nearby hospitals by distance, wait time, beds, insurance |
| Monitor Agent | 8003 | Polls and caches hospital capacity snapshots |
| Alert Agent | 8004 | Subscribes users to wait time change notifications |
| Follow-Up Agent | 8005 | Generates personalized post-visit care plans |
| HHS Agent | 8006 | Fetches real hospital capacity data from HHS sources |

**Gateway** (port 8080) exposes REST endpoints that translate HTTP requests into agent-to-agent messages via the uAgents protocol.

#### Gateway Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check and agent status |
| POST | `/symptoms` | Submit symptoms, returns follow-up questions |
| POST | `/triage` | Submit answers, returns ESI score + ranked hospitals |
| POST | `/followup` | Get AI-generated follow-up care plan |
| POST | `/alert/subscribe` | Subscribe to wait time alerts |
| GET | `/alert/status/{session_id}` | Poll current wait time for a session |
| POST | `/route` | Get road-following directions (via Valhalla) |
| POST | `/insurance/verify` | OCR an insurance card image |
| POST | `/predict-wait` | Predict future wait times from historical data |
| GET | `/admin/capacity` | Admin dashboard: all hospital capacity data |

### Data Layer

- **Supabase** - Auth, user profiles, hospital data, routing sessions, capacity snapshots
- **Valhalla (OpenStreetMap)** - Road-following route geometry and drive times
- **ASI-1 Mini** - AI model for symptom analysis, triage scoring, care plans, and insurance OCR

## Prerequisites

- Node.js and npm
- Python 3.11+
- [Expo Go](https://expo.dev/go) on your mobile device
- Supabase project with required tables (`hospitals`, `profiles`, `routing_sessions`, `hospital_capacity_snapshots`)
- Fetch.ai Agentverse account (agent seed phrases)

## Environment Variables

### Root `.env` (frontend)

```
EXPO_PUBLIC_SUPABASE_URL=<your-supabase-url>
EXPO_PUBLIC_SUPABASE_KEY=<your-supabase-anon-key>
```

### `backend/.env`

```
SUPABASE_URL=<your-supabase-url>
SUPABASE_SERVICE_KEY=<your-supabase-service-key>
ASI1_API_KEY=<your-asi1-api-key>
SYMPTOM_AGENT_SEED_PHRASE=<seed>
ROUTING_AGENT_SEED_PHRASE=<seed>
MONITOR_AGENT_SEED_PHRASE=<seed>
ALERT_AGENT_SEED_PHRASE=<seed>
FOLLOWUP_AGENT_SEED_PHRASE=<seed>
HHS_AGENT_SEED_PHRASE=<seed>
```

## Getting Started

### 1. Install frontend dependencies

```bash
npm install
```

### 2. Set up the backend virtual environment

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt  # or install dependencies manually
```

### 3. Start all backend agents

From the `backend/` directory:

```bash
make all-agents
```

Or start them individually:

```bash
make symptom
make routing
make monitor
make alert
make followup
make hhs
```

### 4. Start the gateway

In a separate terminal from `backend/`:

```bash
make gateway
```

The gateway runs on `http://0.0.0.0:8080`.

### 5. Update the gateway URL

In `services/api.ts`, set `GATEWAY_URL` to your machine's local IP:

```ts
const GATEWAY_URL = "http://<your-local-ip>:8080";
```

### 6. Start the Expo frontend

From the project root:

```bash
npx expo start
```

Scan the QR code with Expo Go on your phone. Your phone and computer must be on the same network.

### Stopping agents

```bash
make kill-agents
```

## Project Structure

```
medimind/
├── app/                    # Expo Router screens
│   ├── (auth)/             # Auth flow (welcome, login, signup, onboarding)
│   ├── (tabs)/             # Tab navigator (home, profile)
│   ├── diagnose.tsx        # Symptom input + follow-up questions
│   ├── results.tsx         # Triage results + hospital map
│   ├── care-plan.tsx       # Follow-up care plan
│   ├── insurance-scan.tsx  # Insurance card camera OCR
│   └── admin-dashboard.tsx # Hospital capacity admin view
├── services/
│   └── api.ts              # Backend API client
├── supabase.ts             # Supabase client init
├── backend/
│   ├── gateway.py          # FastAPI gateway (primary)
│   ├── gateway_rest.py     # REST fallback gateway
│   ├── Makefile            # Agent and gateway run commands
│   └── agents/
│       ├── config.py       # Agent addresses derived from seed phrases
│       ├── models.py       # Shared Pydantic/uAgent message models
│       ├── symptom_agent.py
│       ├── routing_agent.py
│       ├── monitor_agent.py
│       ├── alert_agent.py
│       ├── followup_agent.py
│       └── hhs_agent.py
├── components/             # Shared React Native components
├── hooks/                  # Custom React hooks
├── constants/              # App constants and theme
└── assets/                 # Images, fonts, icons
```
