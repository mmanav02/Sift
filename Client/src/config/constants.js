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

export const APP_CONFIG = {
  CENTRAL_SERVER_URL: 'https://api.example.com',
  VERSION: '1.0.0',
  DEBUG_MODE: __DEV__ ?? false,
};
