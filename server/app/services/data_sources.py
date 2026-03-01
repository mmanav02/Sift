import asyncio
import logging
from typing import Optional

import httpx
import feedparser

logger = logging.getLogger(__name__)

USGS_URL  = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_hour.geojson"
NOAA_URL  = "https://api.weather.gov/alerts/active?status=actual&message_type=alert"
EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=1&limit=20"
GDACS_URL = "https://www.gdacs.org/xml/rss.xml"

HEADERS = {
    "User-Agent": "DisasterAI/1.0 (hackathon; https://github.com/disasterai)",
    "Accept": "application/json",
}


async def fetch_usgs_earthquakes() -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(USGS_URL, headers=HEADERS)
            resp.raise_for_status()
            data = resp.json()

        results = []
        for feature in data.get("features", []):
            props  = feature.get("properties", {})
            coords = feature.get("geometry", {}).get("coordinates", [])
            if len(coords) < 2:
                continue
            mag   = props.get("mag", 0) or 0
            place = props.get("place", "Unknown location")
            results.append({
                "source":    "USGS",
                "type":      "earthquake",
                "magnitude": mag,
                "place":     place,
                "lat":       coords[1],
                "lng":       coords[0],
                "depth_km":  coords[2] if len(coords) > 2 else None,
                "time_ms":   props.get("time", 0),
                "url":       props.get("url", ""),
                "title":     f"M{mag} Earthquake - {place}",
            })

        logger.info(f"[data_sources][USGS] {len(results)} earthquake(s) fetched")
        return results

    except Exception as e:
        logger.error(f"[data_sources][USGS] Error: {e}")
        return []


async def fetch_noaa_alerts() -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                NOAA_URL,
                headers={**HEADERS, "Accept": "application/geo+json"},
            )
            resp.raise_for_status()
            data = resp.json()

        results = []
        for feature in data.get("features", [])[:40]:
            props    = feature.get("properties", {})
            severity = props.get("severity", "Minor")
            if severity not in ("Extreme", "Severe", "Moderate"):
                continue
            lat, lng = _polygon_centroid(feature.get("geometry"))
            if lat is None or lng is None:
                continue
            event = props.get("event", "Weather Alert")
            area  = props.get("areaDesc", "Unknown area")
            results.append({
                "source":   "NOAA",
                "type":     _noaa_event_to_type(event),
                "severity": _noaa_severity_map(severity),
                "event":    event,
                "area":     area,
                "headline": props.get("headline", event),
                "lat":      lat,
                "lng":      lng,
                "onset":    props.get("onset", ""),
                "title":    f"{event} — {area[:60]}",
            })

        logger.info(f"[data_sources][NOAA] {len(results)} alert(s) fetched")
        return results

    except Exception as e:
        logger.error(f"[data_sources][NOAA] Error: {e}")
        return []


def _polygon_centroid(geometry: Optional[dict]) -> tuple[Optional[float], Optional[float]]:
    if not geometry:
        return None, None
    geo_type = geometry.get("type", "")
    coords   = geometry.get("coordinates", [])
    try:
        if geo_type == "Polygon" and coords:
            ring = coords[0]
            return sum(p[1] for p in ring) / len(ring), sum(p[0] for p in ring) / len(ring)
        elif geo_type == "MultiPolygon" and coords:
            ring = coords[0][0]
            return sum(p[1] for p in ring) / len(ring), sum(p[0] for p in ring) / len(ring)
        elif geo_type == "Point" and coords:
            return coords[1], coords[0]
    except (IndexError, TypeError, ZeroDivisionError):
        pass
    return None, None


def _noaa_event_to_type(event: str) -> str:
    e = event.lower()
    if "flood" in e:
        return "flood"
    if "fire" in e or "red flag" in e:
        return "fire"
    if "tsunami" in e:
        return "tsunami"
    if "earthquake" in e:
        return "earthquake"
    if any(w in e for w in ("tornado", "thunder", "hurricane", "tropical", "wind",
                             "winter", "snow", "ice", "blizzard", "storm", "cyclone")):
        return "storm"
    return "other"


def _noaa_severity_map(severity: str) -> str:
    return {"Extreme": "critical", "Severe": "high", "Moderate": "medium"}.get(severity, "low")


async def fetch_nasa_eonet() -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(EONET_URL, headers=HEADERS)
            resp.raise_for_status()
            data = resp.json()

        results = []
        for event in data.get("events", []):
            title      = event.get("title", "Unknown Event")
            categories = [c.get("title", "") for c in event.get("categories", [])]
            geometries = event.get("geometry", [])
            if not geometries:
                continue
            latest = geometries[-1]
            coords = latest.get("coordinates", [])
            if not coords:
                continue
            if isinstance(coords[0], (list, tuple)):
                lng, lat = coords[0][0], coords[0][1]
            else:
                lng, lat = coords[0], coords[1]
            results.append({
                "source":     "NASA EONET",
                "type":       _eonet_category_to_type(categories),
                "title":      title,
                "categories": categories,
                "lat":        lat,
                "lng":        lng,
                "date":       latest.get("date", ""),
            })

        logger.info(f"[data_sources][NASA EONET] {len(results)} event(s) fetched")
        return results

    except Exception as e:
        logger.error(f"[data_sources][NASA EONET] Error: {e}")
        return []


def _eonet_category_to_type(categories: list[str]) -> str:
    cats = [c.lower() for c in categories]
    if any("wildfire" in c or "fire" in c for c in cats):
        return "fire"
    if any("flood" in c for c in cats):
        return "flood"
    if any("tsunami" in c for c in cats):
        return "tsunami"
    if any("earthquake" in c or "landslide" in c for c in cats):
        return "earthquake"
    if any("storm" in c or "cyclone" in c or "hurricane" in c or "typhoon" in c for c in cats):
        return "storm"
    return "other"


async def fetch_gdacs_alerts() -> list[dict]:
    try:
        loop = asyncio.get_event_loop()
        feed = await loop.run_in_executor(None, feedparser.parse, GDACS_URL)

        results = []
        for entry in feed.entries[:25]:
            title = entry.get("title", "Unknown Disaster")
            alert_level = (
                getattr(entry, "gdacs_alertlevel", None)
                or entry.get("gdacs_alertlevel")
                or _extract_gdacs_level_from_title(title)
            )
            if not alert_level or alert_level.lower() not in ("red", "orange"):
                continue
            lat = _safe_float(getattr(entry, "geo_lat", None) or entry.get("geo_lat"))
            lng = _safe_float(getattr(entry, "geo_long", None) or entry.get("geo_long"))
            if lat is None or lng is None:
                continue
            results.append({
                "source":      "GDACS",
                "type":        _gdacs_title_to_type(title),
                "severity":    "critical" if str(alert_level).lower() == "red" else "high",
                "title":       title[:120],
                "alert_level": alert_level,
                "lat":         lat,
                "lng":         lng,
                "link":        entry.get("link", ""),
            })

        logger.info(f"[data_sources][GDACS] {len(results)} Red/Orange alert(s) fetched")
        return results

    except Exception as e:
        logger.error(f"[data_sources][GDACS] Error: {e}")
        return []


def _extract_gdacs_level_from_title(title: str) -> Optional[str]:
    t = title.lower()
    if "red" in t:
        return "Red"
    if "orange" in t:
        return "Orange"
    return None


def _gdacs_title_to_type(title: str) -> str:
    t = title.lower()
    if "earthquake" in t or "quake" in t:
        return "earthquake"
    if "flood" in t:
        return "flood"
    if "cyclone" in t or "hurricane" in t or "typhoon" in t or "storm" in t:
        return "storm"
    if "tsunami" in t:
        return "tsunami"
    if "volcano" in t or "eruption" in t:
        return "other"
    if "fire" in t or "wildfire" in t:
        return "fire"
    return "other"


def _safe_float(val) -> Optional[float]:
    try:
        return float(val)
    except (TypeError, ValueError):
        return None
