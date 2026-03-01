import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
import uuid
from typing import Optional

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import alerts, users
from app.schemas import RegisterRequest
from app.services import storage, notifications
from app.services.disaster_agent import create_agent, agent_status

settings = get_settings()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        self._connections: list[WebSocket] = []
        self._device_by_ws: dict = {}

    async def connect(self, ws: WebSocket, device_id: str = ""):
        await ws.accept()
        self._connections.append(ws)
        if device_id:
            self._device_by_ws[id(ws)] = device_id
        logger.info(f"[ws] Connected. Total: {len(self._connections)}")

    def disconnect(self, ws: WebSocket) -> Optional[str]:
        device_id = self._device_by_ws.pop(id(ws), None)
        self._connections.remove(ws)
        logger.info(f"[ws] Disconnected. Total: {len(self._connections)}")
        return device_id

    async def broadcast(self, data: dict):
        dead = []
        for ws in self._connections:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._connections.remove(ws)


ws_manager = ConnectionManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    storage.ensure_data_dir()
    notifications.ws_manager = ws_manager
    logger.info("🚨 DisasterAI backend started — JSON storage ready")

    agent    = create_agent(ws_manager=ws_manager)
    interval = settings.agent_interval_minutes

    scheduler = AsyncIOScheduler(timezone="UTC")
    scheduler.add_job(
        agent.run,
        trigger="interval",
        minutes=interval,
        next_run_time=datetime.now(timezone.utc),
        id="disaster_agent",
        name="Autonomous Disaster Discovery Agent",
        misfire_grace_time=60,
    )
    scheduler.start()

    next_run = datetime.now(timezone.utc) + timedelta(minutes=interval)
    agent_status["next_run"] = next_run.isoformat()
    logger.info(
        f"⏰ Disaster agent scheduler started — runs every {interval} min "
        f"(first run: immediate, next: {next_run.strftime('%H:%M UTC')})"
    )

    yield

    scheduler.shutdown(wait=False)
    logger.info("DisasterAI backend shutting down")


app = FastAPI(
    title="DisasterAI API",
    version="1.0.0",
    description="Disaster alert relay API with BLE mesh support and AI-powered situation reports",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.state.ws_manager = ws_manager

app.include_router(alerts.router)
app.include_router(users.router)


@app.post("/api/register")
async def api_register(request: Request, body: Optional[RegisterRequest] = None):
    """Register device with optional deviceId; server stores id and IP/port, returns user_id."""
    if body is None:
        body = RegisterRequest()
    device_id = (body.deviceId or "").strip()
    if not device_id:
        device_id = str(uuid.uuid4())
    forwarded = request.headers.get("x-forwarded-for")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "")
    port = request.client.port if request.client else 0
    user = {"id": device_id, "ip": ip, "port": port, "connected": False}
    storage.upsert_user(user)
    logger.info(f"[api] Registered device {device_id} from {ip}:{port}")
    return {"user_id": device_id}


@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    device_id = (ws.query_params.get("deviceId") or "").strip()
    await ws_manager.connect(ws, device_id)
    try:
        if device_id and ws.client:
            storage.upsert_user({
                "id": device_id,
                "ip": ws.client.host or "",
                "port": ws.client.port or 0,
                "connected": True,
            })
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        disconnected_id = ws_manager.disconnect(ws)
        if disconnected_id:
            storage.set_user_connected(disconnected_id, False)
