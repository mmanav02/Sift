/**
 * Mock alerts and server/BLE simulators for development and demo.
 */

import { v4 as uuid } from 'uuid';
import { ALERT_TYPES, ALERT_SOURCE_BLUETOOTH } from '../config/constants.js';

const MOCK_CITIES = [
  { city: 'San Jose', lat: 37.3382, long: -121.8863, zipcode: '95112' },
  { city: 'Oakland', lat: 37.8044, long: -122.2712, zipcode: '94612' },
  { city: 'San Francisco', lat: 37.7749, long: -122.4194, zipcode: '94102' },
  { city: 'Los Angeles', lat: 34.0522, long: -118.2437, zipcode: '90012' },
  { city: 'Sacramento', lat: 38.5816, long: -121.4944, zipcode: '95814' },
  { city: 'Fresno', lat: 36.7378, long: -119.7871, zipcode: '93721' },
  { city: 'San Diego', lat: 32.7157, long: -117.1611, zipcode: '92101' },
];

export function generateMockAlert(overrides = {}) {
  const loc = MOCK_CITIES[Math.floor(Math.random() * MOCK_CITIES.length)];
  const alertType = ALERT_TYPES[Math.floor(Math.random() * ALERT_TYPES.length)];
  const severity = Math.floor(Math.random() * 10) + 1;
  return {
    id: uuid(),
    city: loc.city,
    lat: loc.lat,
    long: loc.long,
    zipcode: loc.zipcode,
    alertType,
    severity,
    description: `${alertType} alert in ${loc.city}`,
    timestamp: new Date().toISOString(),
    receivedVia: null,
    rebroadcasted: false,
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
      () => resolve(generateMockAlert({ receivedVia: ALERT_SOURCE_BLUETOOTH })),
      delayMs
    );
  });
}
