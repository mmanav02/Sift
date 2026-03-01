import json
import math
import uuid
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from openai import OpenAI

from app.config import get_settings
from app.services import storage
from app.services.data_sources import (
    fetch_usgs_earthquakes,
    fetch_noaa_alerts,
    fetch_nasa_eonet,
    fetch_gdacs_alerts,
)

logger   = logging.getLogger(__name__)
settings = get_settings()

# Radius in km: only alerts of the *same type* within this distance and time window are treated as
# the same event. Different types (e.g. earthquake vs tsunami) in the same radius are both stored.
DEDUP_RADIUS_KM = 50.0


def _distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Approximate distance in km between two points (Haversine)."""
    R = 6371.0  # Earth radius km
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


agent_status: dict = {
    "last_run":        None,
    "next_run":        None,
    "alerts_found":    0,
    "sources_checked": [],
    "running":         False,
    "error":           None,
}

TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "fetch_usgs_earthquakes",
            "description": (
                "Fetch recent M4.5+ earthquakes from USGS (last 1 hour). "
                "Always call this — earthquakes are the most common disaster."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_noaa_alerts",
            "description": (
                "Fetch active Moderate/Severe/Extreme weather alerts from NOAA "
                "(US only — floods, storms, tornadoes, hurricanes). Always call this."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_nasa_eonet",
            "description": (
                "Fetch open natural events from NASA EONET "
                "(wildfires, volcanoes, severe storms — global). Always call this."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_gdacs_alerts",
            "description": (
                "Fetch global Red/Orange disaster alerts from GDACS "
                "(earthquakes, floods, cyclones, tsunamis). Always call this."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": (
                "Search the web for recent disaster news NOT covered by the official APIs above. "
                "Use for: chemical spills, infrastructure failures, regional disasters, "
                "or to get more context on a large event. Limit to 1-2 searches per run."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": (
                            "Web search query, e.g. 'chemical plant explosion Texas today 2025' "
                            "or 'bridge collapse flooding 2025'"
                        ),
                    }
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "save_disaster_alert",
            "description": (
                "Save a validated disaster alert to the database. "
                "ONLY call for real, current (< 6 hours old), significant events. "
                "Do NOT save: minor weather advisories, old events, test alerts, or duplicates."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": [
                            "earthquake", "flood", "fire", "storm", "chemical",
                            "tsunami", "medical", "infrastructure", "other",
                        ],
                        "description": "Category of disaster",
                    },
                    "severity": {
                        "type": "string",
                        "enum": ["low", "medium", "high", "critical"],
                        "description": (
                            "Severity level. Guide: "
                            "Earthquake M4.5-5.0=medium, M5.0-6.0=high, M6.0+=critical; "
                            "NOAA Moderate=medium, Severe=high, Extreme=critical; "
                            "Hurricane Cat1-2=high, Cat3+=critical; "
                            "Flash flood warning=high; Tsunami warning=critical; "
                            "Major wildfire (>1000 acres)=high, out-of-control=critical."
                        ),
                    },
                    "title": {
                        "type": "string",
                        "description": "Clear, informative title. Max 80 chars. E.g. 'M6.2 Earthquake near Tokyo, Japan'",
                    },
                    "description": {
                        "type": "string",
                        "description": "Brief factual description. Max 300 chars.",
                    },
                    "city": {
                        "type": "string",
                        "description": "Nearest city or district. For US: city name (e.g. 'Houston'). For international: nearest city or district (e.g. 'Dhaka', 'Chittagong'). Never put a country name here.",
                    },
                    "state": {
                        "type": "string",
                        "description": "For US: state name (e.g. 'Texas'). For international: state, province, or division (e.g. 'Dhaka Division', 'Punjab'). If no subdivision exists, use the country name (e.g. 'Bangladesh').",
                    },
                    "lat":         {"type": "number", "description": "Latitude of event"},
                    "lng":         {"type": "number", "description": "Longitude of event"},
                    "zipcode":     {"type": "string", "description": "Zipcode if available, US only (optional)"},
                    "data_source": {
                        "type": "string",
                        "enum": ["USGS", "NOAA", "NASA EONET", "GDACS", "Tavily", "news"],
                        "description": "The source this alert data came from.",
                    },
                },
                "required": ["type", "severity", "title", "description", "city", "state", "lat", "lng", "data_source"],
            },
        },
    },
]


def _build_system_prompt() -> str:
    now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return f"""You are DisasterAI's autonomous disaster monitoring agent.
Your job is to find REAL, CURRENT disaster events and save them to our alert database.
Current UTC time: {now_utc}

PROCEDURE — follow this order every run:
1. Call fetch_usgs_earthquakes     (always)
2. Call fetch_noaa_alerts          (always)
3. Call fetch_nasa_eonet           (always)
4. Call fetch_gdacs_alerts         (always)
5. Always call search_web once for recent disaster news — if it fails or returns no results, skip and continue
6. Call save_disaster_alert for each REAL, SIGNIFICANT, CURRENT event found

SAVE CRITERIA — save ONLY if ALL of these are true:
  ✓ Event is real (from official API or confirmed news source)
  ✓ Event is current (occurred within the last 6 hours)
  ✓ Event is significant (see severity guide in tool description)
  ✓ Not a duplicate (avoid saving the same event twice)

DO NOT SAVE:
  ✗ Weather advisories (Moderate level is borderline — use judgment)
  ✗ Events older than 6 hours
  ✗ GDACS Green level alerts
  ✗ Test messages or exercises
  ✗ Events you've already saved in this run

After all tools are done, briefly summarize what you found and saved."""


class DisasterAgent:
    def __init__(self, ws_manager=None):
        self.ws_manager = ws_manager
        self._client: Optional[OpenAI] = None

    def _get_client(self) -> Optional[OpenAI]:
        if self._client:
            return self._client
        self._client = OpenAI(
            api_key=settings.h4h_api_key,
            base_url=settings.h4h_base_url,
        )
        logger.info("[DisasterAgent] H4H client initialized (Qwen3-30B-A3B)")
        return self._client

    async def run(self) -> dict:
        if agent_status["running"]:
            logger.warning("[DisasterAgent] Previous run still in progress — skipping")
            return {"status": "skipped", "reason": "already_running"}

        start_time = datetime.now(timezone.utc)
        agent_status.update({
            "running":         True,
            "last_run":        start_time.isoformat(),
            "error":           None,
            "sources_checked": [],
            "alerts_found":    0,
        })

        logger.info("=" * 60)
        logger.info(f"[DisasterAgent] 🚨 Disaster scan starting at {start_time.strftime('%H:%M UTC')}")
        logger.info("=" * 60)

        client = self._get_client()
        if not client:
            agent_status.update({"running": False, "error": "H4H client failed to initialize"})
            return {"status": "error", "reason": "H4H client failed to initialize"}

        alerts_saved = 0

        try:
            messages = [
                {"role": "system", "content": _build_system_prompt()},
                {
                    "role": "user",
                    "content": (
                        f"Run the full disaster scan now. "
                        f"UTC time: {start_time.strftime('%Y-%m-%d %H:%M UTC')}. "
                        "Check all 4 official sources, then save any significant current events."
                    ),
                },
            ]

            for iteration in range(25):
                logger.info(f"[DisasterAgent] ── Iteration {iteration + 1} ──")

                response = client.chat.completions.create(
                    model="Qwen3-30B-A3B",
                    messages=messages,
                    tools=TOOLS,
                    tool_choice="auto",
                    max_tokens=4096,
                    temperature=0.1,
                )

                msg = response.choices[0].message

                messages.append({
                    "role": "assistant",
                    "content": msg.content or "",
                    **({"tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                        }
                        for tc in msg.tool_calls
                    ]} if msg.tool_calls else {}),
                })

                if not msg.tool_calls:
                    logger.info(f"[DisasterAgent] ✅ Agent finished — {iteration + 1} iteration(s)")
                    if msg.content:
                        logger.info(f"[DisasterAgent] Summary: {msg.content[:500]}")
                    break

                for tool_call in msg.tool_calls:
                    name = tool_call.function.name
                    try:
                        args = json.loads(tool_call.function.arguments or "{}")
                    except json.JSONDecodeError:
                        args = {}

                    logger.info(f"[DisasterAgent] 🔧 {name}({json.dumps(args)[:120]})")

                    result = await self._execute_tool(name, args)

                    if name == "save_disaster_alert" and isinstance(result, dict) and result.get("saved"):
                        alerts_saved += 1

                    if name.startswith("fetch_"):
                        label = name.replace("fetch_", "").replace("_", " ").upper()
                        if label not in agent_status["sources_checked"]:
                            agent_status["sources_checked"].append(label)
                    elif name == "search_web":
                        if "TAVILY WEB SEARCH" not in agent_status["sources_checked"]:
                            agent_status["sources_checked"].append("TAVILY WEB SEARCH")

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": json.dumps(result) if not isinstance(result, str) else result,
                    })

        except Exception as e:
            logger.error(f"[DisasterAgent] Run error: {e}", exc_info=True)
            agent_status["error"] = str(e)
        finally:
            duration = (datetime.now(timezone.utc) - start_time).total_seconds()
            agent_status.update({"running": False, "alerts_found": alerts_saved})
            logger.info(
                f"[DisasterAgent] 🎯 Run complete — "
                f"{alerts_saved} alert(s) saved | "
                f"{len(agent_status['sources_checked'])} source(s) checked | "
                f"{duration:.1f}s"
            )
            logger.info("=" * 60)
            return {
                "alerts_saved":     alerts_saved,
                "sources_checked":  agent_status["sources_checked"],
                "duration_seconds": round(duration, 1),
            }

    async def _execute_tool(self, tool_name: str, tool_args: dict) -> dict:
        if tool_name == "fetch_usgs_earthquakes":
            data = await fetch_usgs_earthquakes()
            return {"count": len(data), "events": data[:12]}
        elif tool_name == "fetch_noaa_alerts":
            data = await fetch_noaa_alerts()
            return {"count": len(data), "alerts": data[:12]}
        elif tool_name == "fetch_nasa_eonet":
            data = await fetch_nasa_eonet()
            return {"count": len(data), "events": data[:12]}
        elif tool_name == "fetch_gdacs_alerts":
            data = await fetch_gdacs_alerts()
            return {"count": len(data), "alerts": data[:12]}
        elif tool_name == "search_web":
            return await self._search_web(tool_args.get("query", ""))
        elif tool_name == "save_disaster_alert":
            return await self._save_alert(tool_args)
        else:
            logger.warning(f"[DisasterAgent] Unknown tool: {tool_name}")
            return {"error": f"Unknown tool: {tool_name}"}

    async def _search_web(self, query: str) -> dict:
        if not query:
            return {"error": "Empty query", "results": []}
        if not settings.tavily_api_key:
            return {"error": "TAVILY_API_KEY not set", "results": []}
        try:
            from tavily import TavilyClient
            client = TavilyClient(api_key=settings.tavily_api_key)
            loop = asyncio.get_event_loop()
            raw = await loop.run_in_executor(
                None,
                lambda: client.search(
                    query=query,
                    search_depth="basic",
                    max_results=5,
                    include_domains=[
                        "reuters.com", "apnews.com", "bbc.com", "bbc.co.uk",
                        "usgs.gov", "noaa.gov", "weather.gov", "gdacs.org",
                        "nasa.gov", "fema.gov", "cdc.gov", "who.int",
                        "theguardian.com", "npr.org",
                    ],
                ),
            )
            snippets = [
                {
                    "title":   r.get("title", ""),
                    "content": r.get("content", "")[:400],
                    "url":     r.get("url", ""),
                }
                for r in raw.get("results", [])
            ]
            logger.info(f"[DisasterAgent] 🌐 Web search '{query}' → {len(snippets)} result(s)")
            return {"query": query, "results": snippets}
        except Exception as e:
            logger.error(f"[DisasterAgent] Web search error: {e}")
            return {"error": str(e), "results": []}

    async def _save_alert(self, args: dict) -> dict:
        lat        = args.get("lat")
        lng        = args.get("lng")
        alert_type = args.get("type", "other")

        if lat is None or lng is None:
            return {"saved": False, "reason": "Missing lat/lng coordinates"}

        if self._is_duplicate(alert_type, lat, lng, hours=2):
            logger.info(f"[DisasterAgent] ⏭️  Duplicate skipped: {args.get('title', '<untitled>')}")
            return {"saved": False, "reason": "Duplicate — similar alert already in JSON storage"}

        try:
            alert = storage.add_alert({
                "id":          str(uuid.uuid4()),
                "type":        alert_type,
                "severity":    args.get("severity", "medium"),
                "title":       (args.get("title") or "Disaster Alert")[:200],
                "description": args.get("description"),
                "city":        args.get("city"),
                "state":       args.get("state"),
                "zipcode":     args.get("zipcode"),
                "lat":         lat,
                "lng":         lng,
                "source":      args.get("data_source", "agent"),
            })

            if self.ws_manager:
                try:
                    asyncio.create_task(
                        self.ws_manager.broadcast({
                            "event": "alert:new",
                            "alert": {
                                "id":       alert["id"],
                                "type":     alert["type"],
                                "severity": alert["severity"],
                                "title":    alert["title"],
                                "lat":      alert["lat"],
                                "lng":      alert["lng"],
                                "city":     alert.get("city"),
                                "state":    alert.get("state"),
                                "source":   alert["source"],
                            },
                        })
                    )
                except Exception as ws_err:
                    logger.warning(f"[DisasterAgent] WebSocket broadcast failed: {ws_err}")

            return {"saved": True, "id": alert["id"], "title": alert["title"]}

        except Exception as e:
            logger.error(f"[DisasterAgent] Save error: {e}")
            return {"saved": False, "reason": str(e)}

    def _is_duplicate(self, alert_type: str, lat: float, lng: float, hours: int = 2) -> bool:
        since = datetime.now(timezone.utc) - timedelta(hours=hours)
        for alert in storage.get_all_alerts():
            if alert.get("type") != alert_type or not alert.get("active", True):
                continue
            try:
                created = datetime.fromisoformat(alert["created_at"])
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
                if created < since:
                    continue
                a_lat = alert.get("lat")
                a_lng = alert.get("lng")
                if a_lat is None or a_lng is None:
                    continue
                if _distance_km(lat, lng, float(a_lat), float(a_lng)) < DEDUP_RADIUS_KM:
                    return True
            except Exception:
                continue
        return False


_agent_instance: Optional[DisasterAgent] = None


def create_agent(ws_manager=None) -> DisasterAgent:
    global _agent_instance
    _agent_instance = DisasterAgent(ws_manager=ws_manager)
    logger.info("[DisasterAgent] Agent instance created")
    return _agent_instance


def get_agent() -> Optional[DisasterAgent]:
    return _agent_instance
