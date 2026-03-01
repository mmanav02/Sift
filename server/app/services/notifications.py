import logging
from typing import Optional

logger = logging.getLogger(__name__)

ws_manager = None

SEVERITY_EMOJI = {"critical": "🚨", "high": "⚠️", "medium": "📢", "low": "ℹ️"}


async def notify_all_users(alert: dict, body_override: Optional[str] = None):
    if not ws_manager:
        logger.warning("[notifications] ws_manager not set — skipping broadcast")
        return {"sent": 0}

    emoji = SEVERITY_EMOJI.get(alert.get("severity", "medium"), "⚠️")
    title = f"{emoji} {alert.get('title', 'Disaster Alert')}"
    body  = body_override or (
        alert.get("description") or
        f"{alert.get('type', 'disaster').capitalize()} alert near {alert.get('city') or 'your area'}"
    )

    payload = {
        "event":    "alert",
        "alertId":  alert.get("id", ""),
        "title":    title,
        "body":     body,
        "type":     alert.get("type", ""),
        "severity": alert.get("severity", ""),
    }

    await ws_manager.broadcast(payload)
    count = len(ws_manager._connections)
    logger.info(f"[notifications] Broadcasted to {count} connected client(s): {title}")
    return {"sent": count}
