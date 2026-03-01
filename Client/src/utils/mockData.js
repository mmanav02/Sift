/**
 * Mock alerts and server/BLE simulators for development and demo.
 * Uses canonical schema: id, type, severity, title, description, city, state, country, lat, lng, source, created_at, updated_at, active.
 */

import { v4 as uuid } from 'uuid';
import { ALERT_TYPES, ALERT_SOURCE_BLUETOOTH } from '../config/constants.js';

const MOCK_CITIES = [
  { city: 'San Jose', state: 'CA', country: 'USA', lat: 37.3382, lng: -121.8863, zipcode: '95112' },
  { city: 'Oakland', state: 'CA', country: 'USA', lat: 37.8044, lng: -122.2712, zipcode: '94612' },
  { city: 'San Francisco', state: 'CA', country: 'USA', lat: 37.7749, lng: -122.4194, zipcode: '94102' },
  { city: 'Los Angeles', state: 'CA', country: 'USA', lat: 34.0522, lng: -118.2437, zipcode: '90012' },
  { city: 'Sacramento', state: 'CA', country: 'USA', lat: 38.5816, lng: -121.4944, zipcode: '95814' },
  { city: 'Fresno', state: 'CA', country: 'USA', lat: 36.7378, lng: -119.7871, zipcode: '93721' },
  { city: 'San Diego', state: 'CA', country: 'USA', lat: 32.7157, lng: -117.1611, zipcode: '92101' },
];

export function generateMockAlert(overrides = {}) {
  const loc = MOCK_CITIES[Math.floor(Math.random() * MOCK_CITIES.length)];
  const type = ALERT_TYPES[Math.floor(Math.random() * ALERT_TYPES.length)];
  const severity = Math.floor(Math.random() * 10) + 1;
  const now = new Date().toISOString();
  return {
    id: uuid(),
    type,
    severity,
    title: `${type.charAt(0).toUpperCase() + type.slice(1)} in ${loc.city}`,
    description: `${type} alert in ${loc.city}`,
    city: loc.city,
    state: loc.state,
    country: loc.country,
    lat: loc.lat,
    lng: loc.lng,
    source: null,
    created_at: now,
    updated_at: now,
    active: true,
    ...overrides,
  };
}

export function generateMockAlerts(count) {
  return Array.from({ length: count }, () => generateMockAlert());
}

export function simulateServerPoll(count = 5, delayMs = 500) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(generateMockAlerts(count)), delayMs);
  });
}

export function simulateBluetoothReceive(delayMs = 800) {
  return new Promise((resolve) => {
    setTimeout(
      () => resolve(generateMockAlert({ source: ALERT_SOURCE_BLUETOOTH })),
      delayMs
    );
  });
}
