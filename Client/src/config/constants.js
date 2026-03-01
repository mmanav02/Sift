/**
 * Central configuration for Disaster News Mesh / Sift.
 * Alert types, BLE config, storage keys, polling, and app settings.
 */

export const ALERT_TYPES = [
  'earthquake',
  'flood',
  'storm',
  'wildfire',
  'tsunami',
  'tornado',
  'hurricane',
  'landslide',
  'drought',
  'other',
];

export const SEVERITY_LEVELS = {
  CRITICAL: 10,
  SEVERE: 8,
  HIGH: 6,
  MODERATE: 4,
  LOW: 2,
  INFO: 1,
};

export const BLE_CONFIG = {
  SERVICE_UUID: '0000180a-0000-1000-8000-00805f9b34fb',
  CHARACTERISTIC_UUID: '00002a29-0000-1000-8000-00805f9b34fb',
  DEVICE_NAME_PREFIX: 'DisasterNews',
  SCAN_DURATION_MS: 10000,
};

export const STORAGE_KEYS = {
  RECEIVED_MESSAGE_IDS: '@sift/received_message_ids',
  LOCAL_ALERTS: '@sift/local_alerts',
  SETTINGS: '@sift/settings',
};

export const STORAGE_LIMITS = {
  MAX_MESSAGE_IDS: 1000,
  MAX_LOCAL_ALERTS: 500,
  MAX_RUNTIME_ALERTS: 100,
};

export const POLLING_CONFIG = {
  POLL_INTERVAL_MS: 30000,
  ALERTS_PER_POLL: 20,
  RETRY_DELAY_MS: 5000,
  MAX_RETRIES: 3,
};

export const REGISTRATION_INTERVAL_MS = 60000;

export const WEBSOCKET_CONFIG = {
  PATH: '/ws',
  RECONNECT_DELAY_MS: 5000,
};

export const ALERT_SOURCE_SERVER = 'server';
export const ALERT_SOURCE_BLUETOOTH = 'bluetooth';

/** Placeholder URL: when this is the server URL, WebSocket and registration are skipped to avoid log spam. */
export const PLACEHOLDER_SERVER_URL = 'https://api.example.com';

export const APP_CONFIG = {
  CENTRAL_SERVER_URL: 'https://api.example.com',
  VERSION: '1.0.0',
  DEBUG_MODE: __DEV__ ?? false,
};

/** Default map region (e.g. US / California). For offline tiles use MAP_TILE_PATH. */
export const MAP_CONFIG = {
  DEFAULT_LATITUDE: 37.3382,
  DEFAULT_LONGITUDE: -121.8863,
  DEFAULT_LATITUDE_DELTA: 4,
  DEFAULT_LONGITUDE_DELTA: 4,
  /** Radius in meters for alert circle. */
  ALERT_CIRCLE_RADIUS_M: 1000,
  /** Optional: local tile path for offline map (e.g. file:///.../tiles or asset path). Empty = use default map provider. */
  MAP_TILE_PATH: '',
};
