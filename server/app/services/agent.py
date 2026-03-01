import json
import logging
from typing import Optional

from app.config import get_settings
from app.schemas import AlertCreate

logger   = logging.getLogger(__name__)
settings = get_settings()

_client = None

H4H_MODEL = "Qwen3-30B-A3B"


def _get_client():
    global _client

    if _client:
        return _client

    try:
        from openai import OpenAI
        _client = OpenAI(
            api_key=settings.h4h_api_key,
            base_url=settings.h4h_base_url,
        )
        logger.info(f"[agent] Using H4H ({H4H_MODEL})")
        return _client
    except Exception as e:
        logger.error(f"[agent] Init failed: {e}")
        return None


def _chat(messages: list[dict], max_tokens: int = 512) -> str:
    client = _get_client()
    if not client:
        return ""
    response = client.chat.completions.create(
        model=H4H_MODEL,
        max_tokens=max_tokens,
        messages=messages,
    )
    return response.choices[0].message.content.strip()


class EnrichedAlert:
    def __init__(self, valid: bool, type: str, severity: str, title: str,
                 description: Optional[str], confidence: float, reason: str):
        self.valid       = valid
        self.type        = type
        self.severity    = severity
        self.title       = title
        self.description = description
        self.confidence  = confidence
        self.reason      = reason


async def validate_and_enrich(raw: AlertCreate) -> EnrichedAlert:
    client = _get_client()
    if not client:
        return EnrichedAlert(
            valid=True, type=raw.type, severity=raw.severity,
            title=raw.title, description=raw.description,
            confidence=0.5, reason="AI unavailable"
        )

    bt_context = (
        f"This alert was relayed via Bluetooth mesh ({raw.hop_count or 1} hop(s)) "
        "from a device with no internet — treat as higher credibility since it originates inside the disaster zone."
        if raw.relayed_by else ""
    )

    prompt = f"""You are a disaster alert validation system. A user has submitted the following alert.
Analyze it and respond with ONLY a JSON object (no markdown, no explanation).

Alert submission:
- Type: {raw.type}
- Severity: {raw.severity}
- Title: {raw.title}
- Description: {raw.description or "none"}
- Location: lat={raw.lat}, lng={raw.lng}, city={raw.city or "unknown"}, zipcode={raw.zipcode or "unknown"}
{bt_context}

Respond with exactly this JSON structure:
{{
  "valid": true or false,
  "type": "earthquake|flood|fire|storm|chemical|tsunami|medical|infrastructure|other",
  "severity": "low|medium|high|critical",
  "title": "clean concise title (max 80 chars)",
  "description": "clean description or generate one from title (max 300 chars)",
  "confidence": 0.0 to 1.0,
  "reason": "one sentence explaining your decision"
}}

Guidelines:
- Mark valid=false ONLY for obvious spam, test data, or completely implausible content
- Infer severity from keywords: "trapped", "casualties", "building collapse" → high/critical; "minor damage" → medium
- Correct the type if the user clearly picked wrong (e.g. title says "wildfire" but type is "earthquake")
- Clean up grammar/spelling in title and description
- Bluetooth-relayed alerts deserve higher confidence"""

    try:
        text = _chat([{"role": "user", "content": prompt}], max_tokens=512)
        data = json.loads(text)
        return EnrichedAlert(
            valid=data.get("valid", True),
            type=data.get("type", raw.type),
            severity=data.get("severity", raw.severity),
            title=data.get("title", raw.title),
            description=data.get("description", raw.description),
            confidence=data.get("confidence", 0.8),
            reason=data.get("reason", "")
        )
    except Exception as e:
        logger.error(f"[agent] validate_and_enrich error: {e}")
        return EnrichedAlert(
            valid=True, type=raw.type, severity=raw.severity,
            title=raw.title, description=raw.description,
            confidence=0.5, reason=f"AI analysis failed: {e}"
        )


async def compose_notification(alert, distance_km: float) -> str:
    client = _get_client()
    if not client:
        return alert.description or f"{alert.type.capitalize()} alert near {alert.city or 'your area'}."

    prompt = f"""Write a SHORT push notification body (max 120 characters) for a disaster alert app.
The recipient is {distance_km:.1f}km from the incident.

Alert details:
- Type: {alert.type}
- Severity: {alert.severity}
- Title: {alert.title}
- Description: {alert.description or "none"}
- City: {alert.city or "unknown"}
- Source: {"Bluetooth relay from disaster zone" if alert.relayed_by else "direct user report"}

Requirements:
- Be specific and actionable (mention distance, location if known)
- Match urgency to severity (critical = very urgent language)
- Max 120 characters
- No emojis (the title already has one)
- Plain text only"""

    try:
        return _chat([{"role": "user", "content": prompt}], max_tokens=100)
    except Exception as e:
        logger.error(f"[agent] compose_notification error: {e}")
        return alert.description or f"{alert.type.capitalize()} alert {distance_km:.1f}km away."
