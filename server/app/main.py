import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import alerts, users
from app.services import storage, notifications
from app.services.disaster_agent import create_agent, agent_status

settings = get_settings()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        self._connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._connections.append(ws)
        logger.info(f"[ws] Connected. Total: {len(self._connections)}")

    def disconnect(self, ws: WebSocket):
        self._connections.remove(ws)
        logger.info(f"[ws] Disconnected. Total: {len(self._connections)}")

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


@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws_manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)
