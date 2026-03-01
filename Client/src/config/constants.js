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

export const SEVERITY_COLORS = {
  critical: '#ff4757',
  high: '#ff6b35',
  medium: '#ffa502',
  low: '#2ed573',
  info: '#4a9eff',
};

export const SEVERITY_LEVELS = {
  CRITICAL: 10,
  SEVERE: 8,
  HIGH: 6,
  MODERATE: 4,
  LOW: 2,
  INFO: 1,
};

export const BLE_CONFIG = {
  SERVICE_UUID: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  CHARACTERISTIC_UUID: 'a1b2c3d4-e5f6-7890-abcd-ef1234567891',
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

export const PLACEHOLDER_SERVER_URL = 'https://api.example.com';

export const APP_CONFIG = {
  /** Central server (droplet). Use http for port 8000; use https if behind nginx/SSL. */
  // CENTRAL_SERVER_URL: 'http://165.245.139.104:8000',
  CENTRAL_SERVER_URL: 'https://ae6c-129-210-115-231.ngrok-free.app',
  VERSION: '1.0.0',
  DEBUG_MODE: __DEV__ ?? false,
};

export const MAP_CONFIG = {
  DEFAULT_LATITUDE: 20.5937,
  DEFAULT_LONGITUDE: 78.9629,
  DEFAULT_LATITUDE_DELTA: 4,
  DEFAULT_LONGITUDE_DELTA: 4,
  ALERT_CIRCLE_RADIUS_M: 1000,
  MAP_TILE_PATH: '',
};
