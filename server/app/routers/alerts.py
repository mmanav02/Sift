import logging
import random
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, BackgroundTasks

from app.schemas import AlertResponse
from app.services import storage, notifications
from app.services.disaster_agent import get_agent, agent_status

_DEMO_SCENARIOS = [
    {
        "type": "flood", "severity": "high",
        "title": "Severe Flash Flooding in Mumbai Suburbs",
        "description": "Heavy monsoon rains have caused severe flash flooding across Andheri, Kurla, and Sion. Water levels at 4–6 feet in low-lying streets. NDRF teams deployed.",
        "city": "Mumbai", "state": "Maharashtra", "country": "India", "lat": 19.0760, "lng": 72.8777,
    },
    {
        "type": "earthquake", "severity": "critical",
        "title": "M6.4 Earthquake Strikes Near Jaipur",
        "description": "A magnitude 6.4 earthquake hit 40 km north of Jaipur at 03:22 IST. Several buildings collapsed in Chomu district. Search and rescue operations underway.",
        "city": "Jaipur", "state": "Rajasthan", "country": "India", "lat": 26.9124, "lng": 75.7873,
    },
    {
        "type": "fire", "severity": "critical",
        "title": "Industrial Fire Breaks Out in Surat Chemical Zone",
        "description": "A massive fire erupted at a chemical storage facility in Sachin GIDC, Surat. Toxic smoke plume visible for 20 km. Residents within 5 km radius advised to evacuate.",
        "city": "Surat", "state": "Gujarat", "country": "India", "lat": 21.1702, "lng": 72.8311,
    },
    {
        "type": "storm", "severity": "high",
        "title": "Cyclone Warning: Severe Storm Approaching Odisha Coast",
        "description": "IMD has issued a red alert for a severe cyclonic storm expected to make landfall near Puri within 24 hours. Wind speeds projected at 130–150 km/h. Coastal evacuation in progress.",
        "city": "Puri", "state": "Odisha", "country": "India", "lat": 19.8135, "lng": 85.8312,
    },
    {
        "type": "tsunami", "severity": "critical",
        "title": "Tsunami Warning Issued for Andaman & Nicobar Islands",
        "description": "Following a M7.8 undersea earthquake in the Andaman Sea, INCOIS has issued a tsunami warning. Coastal communities should move immediately to higher ground.",
        "city": "Port Blair", "state": "Andaman & Nicobar Islands", "country": "India", "lat": 11.6234, "lng": 92.7265,
    },
    {
        "type": "infrastructure", "severity": "medium",
        "title": "Bridge Collapse on NH-44 Near Nagpur",
        "description": "A section of an overpass on National Highway 44 near Nagpur collapsed following heavy rains. Two vehicles fell into the gorge. Road closed; traffic diverted.",
        "city": "Nagpur", "state": "Maharashtra", "country": "India", "lat": 21.1458, "lng": 79.0882,
    },
]

router = APIRouter(prefix="/alerts", tags=["alerts"])
logger = logging.getLogger(__name__)


def _alert_to_response(alert: dict) -> dict:
    out = dict(alert)
    out.setdefault("active", True)
    out.setdefault("updated_at", out.get("created_at"))
    # Ensure optional response fields exist so AlertResponse validation never fails on missing keys
    out.setdefault("country", None)
    out.setdefault("city", None)
    out.setdefault("state", None)
    out.setdefault("description", None)
    out.setdefault("zipcode", None)
    out.setdefault("relayed_by", None)
    out.setdefault("hop_count", None)
    out.setdefault("distance_km", None)
    return out


def _parse_created_at(created_at) -> Optional[datetime]:
    """Parse created_at (ISO string or datetime) to timezone-aware UTC datetime."""
    if created_at is None:
        return None
    if isinstance(created_at, datetime):
        return created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


@router.get("", response_model=list[AlertResponse], response_model_exclude_none=True)
async def get_alerts(
    type:     Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    limit:    int           = Query(50, le=200),
    hours:    Optional[int]  = Query(None, ge=1, le=168),
):
    alerts = [a for a in storage.get_all_alerts() if a.get("active", True)]

    if type:
        alerts = [a for a in alerts if a.get("type") == type]
    if severity:
        alerts = [a for a in alerts if a.get("severity") == severity]

    if hours is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        filtered = []
        for a in alerts:
            created = _parse_created_at(a.get("created_at"))
            if created is not None and created >= cutoff:
                filtered.append(a)
        alerts = filtered

    alerts.sort(key=lambda a: a.get("created_at", ""), reverse=True)
    return [_alert_to_response(a) for a in alerts[:limit]]


@router.post("/demo", response_model=AlertResponse, response_model_exclude_none=True,
             summary="Create a random demo alert (hackathon use)")
async def create_demo_alert():
    scenario = random.choice(_DEMO_SCENARIOS)
    alert = storage.add_alert({**scenario, "source": "demo"})
    await notifications.notify_all_users(alert)
    logger.info(f"[alerts] Demo alert created: {alert['title']}")
    return _alert_to_response(alert)


@router.get("/agent/status")
async def get_agent_status():
    return agent_status


@router.post("/agent/run")
async def trigger_agent(background_tasks: BackgroundTasks):
    agent = get_agent()
    if not agent:
        raise HTTPException(status_code=503, detail="Agent not initialized.")
    if agent_status["running"]:
        return {"status": "already_running", "message": "Agent is currently scanning."}
    background_tasks.add_task(agent.run)
    logger.info("[alerts] Manual agent run triggered")
    return {
        "status":  "triggered",
        "message": "Agent scanning USGS, NOAA, NASA EONET, GDACS. Check /alerts/agent/status for progress.",
    }
