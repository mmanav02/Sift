/**
 * Alert message schema – shared shape for server, BLE, and storage.
 * Canonical fields: id, type, severity, title, description, city, state, country,
 * lat, lng, source, created_at, updated_at, active.
 */

import {
  ALERT_TYPES,
  SEVERITY_LEVELS,
  ALERT_SOURCE_SERVER,
  ALERT_SOURCE_BLUETOOTH,
} from '../config/constants.js';

export { ALERT_TYPES, SEVERITY_LEVELS, ALERT_SOURCE_SERVER, ALERT_SOURCE_BLUETOOTH };

export function isFromServer(alert) {
  const src = alert?.source ?? alert?.receivedVia;
  return src === ALERT_SOURCE_SERVER;
}

export function isFromBluetooth(alert) {
  const src = alert?.source ?? alert?.receivedVia;
  return src === ALERT_SOURCE_BLUETOOTH;
}

export class AlertMessage {
  constructor({
    id,
    type = 'other',
    severity = 1,
    title = '',
    description = '',
    city = '',
    state = '',
    country = '',
    lat = null,
    lng = null,
    source = null,
    created_at = null,
    updated_at = null,
    active = true,
    // Legacy / aliases (not stored as canonical)
    zipcode,
    receivedVia,
    rebroadcasted,
  } = {}) {
    this.id = id;
    this.type = type;
    this.severity = severity;
    this.title = title;
    this.description = description;
    this.city = city;
    this.state = state;
    this.country = country;
    this.lat = lat;
    this.lng = lng;
    this.source = source ?? receivedVia ?? null;
    const now = new Date().toISOString();
    this.created_at = created_at ?? now;
    this.updated_at = updated_at ?? this.created_at;
    this.active = active === true;
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      severity: this.severity,
      title: this.title,
      description: this.description,
      city: this.city,
      state: this.state,
      country: this.country,
      lat: this.lat,
      lng: this.lng,
      source: this.source,
      created_at: this.created_at,
      updated_at: this.updated_at,
      active: this.active,
    };
  }

  static fromJSON(data) {
    if (!data) return null;
    const created = data.created_at ?? data.timestamp ?? new Date().toISOString();
    const updated = data.updated_at ?? created;
    return new AlertMessage({
      id: data.id,
      type: data.type ?? data.alertType ?? 'other',
      severity: data.severity ?? 1,
      title: data.title ?? '',
      description: data.description ?? '',
      city: data.city ?? '',
      state: data.state ?? '',
      country: data.country ?? '',
      lat: data.lat ?? null,
      lng: data.lng ?? data.long ?? null,
      source: data.source ?? data.receivedVia ?? null,
      created_at: created,
      updated_at: updated,
      active: data.active !== false,
    });
  }
}
