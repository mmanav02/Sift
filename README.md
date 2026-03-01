# Sift

**Disaster alert relay with AI-powered discovery, real-time push, and BLE mesh for offline sharing.**

Sift is a full-stack app that aggregates disaster alerts from multiple sources, enriches them with an AI agent, and delivers them to mobile clients over the internet or via Bluetooth when connectivity is limited.

---

## Features

- **Live disaster alerts** — Earthquakes (USGS), severe weather (NOAA), wildfires & events (NASA EONET), and GDACS, plus web search for recent news
- **AI disaster agent** — Scheduled agent that fetches, deduplicates, and saves qualifying events with severity and location
- **Real-time push** — WebSocket connection so connected clients receive new alerts instantly
- **BLE mesh** — Phones advertise as peripherals and scan for other Sift devices; alerts are shared over Bluetooth for offline or low-connectivity scenarios
- **Map view** — Alerts plotted by location with severity and type
- **In-app chat** — BLE-based messaging between nearby devices

---

## Tech Stack

| Layer   | Stack |
|--------|--------|
| **Client** | React Native (Android / iOS), BLE (react-native-ble-plx, react-native-multi-ble-peripheral), AsyncStorage |
| **Server** | FastAPI, Uvicorn, WebSockets, APScheduler |
| **Data**   | JSON files (alerts, users); optional external APIs (USGS, NOAA, NASA EONET, GDACS, Tavily) |

---

## Project Structure

```
Sift/
├── Client/                 # React Native app
│   ├── App.js
│   ├── src/
│   │   ├── config/         # constants, server URL
│   │   ├── services/       # API, WebSocket, BLE, alerts
│   │   ├── components/     # e.g. AlertsMap
│   │   └── utils/
│   └── android/            # Android native project
├── server/                 # FastAPI backend
│   ├── app/
│   │   ├── main.py         # App, WebSocket, register, health
│   │   ├── config.py
│   │   ├── schemas.py
│   │   ├── routers/        # alerts, users
│   │   └── services/       # storage, notifications, disaster_agent, data_sources
│   ├── data/               # alerts.json, users.json (created at runtime)
│   ├── requirements.txt
│   └── run.sh
├── RUN.md                  # Run instructions
└── README.md               # This file
```

---

## Quick Start

### Server (backend)

Use a virtual environment so `pip install` works on systems with externally-managed Python (e.g. Ubuntu/Debian):

```bash
cd server
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

If `python3 -m venv venv` fails, install: `sudo apt install -y python3-venv`, then repeat.

Optional: run via script: `./run.sh` (uses port 8000).

### Client (React Native)

```bash
cd Client
npm install
npm start
```

In a second terminal:

```bash
cd Client
npm run android   # or: npm run ios
```

---

## Configuration

### Client → server URL

Edit `Client/src/config/constants.js` and set `APP_CONFIG.CENTRAL_SERVER_URL` to your backend:

- Local: `http://YOUR_MACHINE_IP:8000` (use your LAN IP if testing on a device)
- Remote: `http://YOUR_SERVER_IP:8001` (or the port you run uvicorn on)

### Remote deployment (e.g. droplet)

1. Run the server on the chosen port (e.g. `--port 8001`).
2. Open that port in the OS firewall, e.g.:
   ```bash
   sudo ufw allow 8001/tcp
   sudo ufw reload
   ```
3. In the cloud firewall / security group, allow inbound TCP on the same port.
4. Set `CENTRAL_SERVER_URL` in the client to `http://YOUR_SERVER_IP:8001`.

---

## API Overview

| Endpoint            | Method | Description |
|---------------------|--------|-------------|
| `/health`           | GET    | Health check |
| `/api/register`     | POST   | Register device (optional `deviceId`) |
| `/api/alerts`       | GET    | List alerts (query params for time window, limit) |
| `/api/alerts/demo`  | POST   | Inject demo alerts |
| `/ws`               | WS     | WebSocket for live alerts; optional `?deviceId=...` |

---

## License

See repository license file (if present).
