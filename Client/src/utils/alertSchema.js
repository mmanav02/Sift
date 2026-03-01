/**
 * Alert message schema – shared shape for server, BLE, and storage.
 * Refine with your instructions as needed.
 */

import {
  ALERT_TYPES,
  SEVERITY_LEVELS,
  ALERT_SOURCE_SERVER,
  ALERT_SOURCE_BLUETOOTH,
} from '../config/constants.js';

export { ALERT_TYPES, SEVERITY_LEVELS, ALERT_SOURCE_SERVER, ALERT_SOURCE_BLUETOOTH };

export function isFromServer(alert) {
  return alert?.receivedVia === ALERT_SOURCE_SERVER;
}

export function isFromBluetooth(alert) {
  return alert?.receivedVia === ALERT_SOURCE_BLUETOOTH;
}

export class AlertMessage {
  constructor({
    id,
    city = '',
    severity = 1,
    zipcode = '',
    lat = null,
    long = null,
    alertType = 'other',
    description = '',
    timestamp = null,
    receivedVia = null,
    rebroadcasted = false,
  } = {}) {
    this.id = id;
    this.city = city;
    this.severity = severity;
    this.zipcode = zipcode;
    this.lat = lat;
    this.long = long;
    this.alertType = alertType;
    this.description = description;
    this.timestamp = timestamp ?? new Date().toISOString();
    this.receivedVia = receivedVia;
    this.rebroadcasted = rebroadcasted;
  }

  toJSON() {
    return {
      id: this.id,
      city: this.city,
      severity: this.severity,
      zipcode: this.zipcode,
      lat: this.lat,
      long: this.long,
      alertType: this.alertType,
      description: this.description,
      timestamp: this.timestamp,
      receivedVia: this.receivedVia,
      rebroadcasted: this.rebroadcasted,
    };
  }

  static fromJSON(data) {
    if (!data) return null;
    return new AlertMessage({
      id: data.id,
      city: data.city,
      severity: data.severity,
      zipcode: data.zipcode,
      lat: data.lat,
      long: data.long,
      alertType: data.alertType,
      description: data.description,
      timestamp: data.timestamp,
      receivedVia: data.receivedVia,
      rebroadcasted: data.rebroadcasted === true,
    });
  }
}
