from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from enum import Enum


class AlertType(str, Enum):
    earthquake = "earthquake"
    flood = "flood"
    fire = "fire"
    storm = "storm"
    chemical = "chemical"
    tsunami = "tsunami"
    medical = "medical"
    infrastructure = "infrastructure"
    other = "other"


class AlertSeverity(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class AlertCreate(BaseModel):
    type: AlertType = AlertType.other
    severity: AlertSeverity = AlertSeverity.medium
    title: str = Field(..., min_length=3, max_length=200)
    description: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    zipcode: Optional[str] = None
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    created_by: Optional[str] = None
    relayed_by: Optional[str] = None
    hop_count: Optional[int] = None


class UserRegister(BaseModel):
    pass


class RegisterRequest(BaseModel):
    """Body for POST /api/register; client may send deviceId to persist identity."""
    deviceId: Optional[str] = None


class LocationUpdate(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class FcmTokenUpdate(BaseModel):
    fcm_token: str


class AlertResponse(BaseModel):
    id: str
    type: str
    severity: str
    title: str
    description: Optional[str]
    city: Optional[str]
    state: Optional[str]
    country: Optional[str]
    zipcode: Optional[str] = None
    lat: float
    lng: float
    source: str
    relayed_by: Optional[str] = None
    hop_count: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    active: bool
    distance_km: Optional[float] = None

    class Config:
        from_attributes = True


class UserResponse(BaseModel):
    user_id: str


class SituationReport(BaseModel):
    report: str
    alert_count: int
    radius_km: float
    lat: float
    lng: float
    generated_at: datetime
