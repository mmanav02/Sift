import json
import uuid
import logging
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

DATA_DIR    = Path(__file__).parent.parent.parent / "data"
ALERTS_FILE = DATA_DIR / "alerts.json"
USERS_FILE  = DATA_DIR / "users.json"


def ensure_data_dir():
    DATA_DIR.mkdir(exist_ok=True)
    if not ALERTS_FILE.exists():
        ALERTS_FILE.write_text("[]")
        logger.info(f"[storage] Created {ALERTS_FILE}")
    if not USERS_FILE.exists():
        USERS_FILE.write_text("[]")
        logger.info(f"[storage] Created {USERS_FILE}")


def _load(path: Path) -> list:
    try:
        return json.loads(path.read_text())
    except Exception as e:
        logger.error(f"[storage] Failed to load {path}: {e}")
        return []


def _save(path: Path, data: list):
    try:
        path.write_text(json.dumps(data, indent=2, default=str))
    except Exception as e:
        logger.error(f"[storage] Failed to save {path}: {e}")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_all_alerts() -> list[dict]:
    return _load(ALERTS_FILE)


def add_alert(alert: dict) -> dict:
    alerts = _load(ALERTS_FILE)
    now = _now()
    alert.setdefault("id",          str(uuid.uuid4()))
    alert.setdefault("active",      True)
    alert.setdefault("created_at",  now)
    alert.setdefault("updated_at",  now)
    alert.setdefault("source", "agent")
    alerts.append(alert)
    _save(ALERTS_FILE, alerts)
    logger.info(f"[storage] Alert saved: [{alert['severity'].upper()}] {alert['type']} — {alert['title']}")
    return alert


def get_all_users() -> list[dict]:
    return _load(USERS_FILE)


def get_user_by_id(user_id: str) -> Optional[dict]:
    for u in _load(USERS_FILE):
        if u.get("id") == user_id:
            return u
    return None


def upsert_user(user: dict) -> dict:
    users = _load(USERS_FILE)
    now   = _now()
    user.setdefault("created_at", now)
    user["last_seen"] = now

    for i, u in enumerate(users):
        if u.get("id") == user.get("id"):
            users[i].update(user)
            _save(USERS_FILE, users)
            return users[i]

    users.append(user)
    _save(USERS_FILE, users)
    logger.info(f"[storage] User registered: {user.get('id')}")
    return user
