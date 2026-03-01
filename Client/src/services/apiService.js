/**
 * HTTP client for central server: device registration.
 * Alerts are received via server broadcast (WebSocket); client does not fetch or create alerts.
 */

import axios from 'axios';
import { APP_CONFIG } from '../config/constants.js';

const defaultBaseURL = APP_CONFIG.CENTRAL_SERVER_URL || 'https://api.example.com';

class ApiService {
  constructor() {
    this._client = axios.create({
      baseURL: defaultBaseURL,
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async registerDevice(deviceId) {
    try {
      await this._client.post('/api/register', { deviceId });
      return true;
    } catch (e) {
      console.warn('[ApiService] registerDevice failed', e?.message);
      return false;
    }
  }
}

export const apiService = new ApiService();
