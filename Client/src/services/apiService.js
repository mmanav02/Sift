/**
 * HTTP client for central server: device registration and manual alert poll.
 */

import axios from 'axios';
import { APP_CONFIG, PLACEHOLDER_SERVER_URL, MANUAL_POLL_HOURS } from '../config/constants.js';

const defaultBaseURL = APP_CONFIG.CENTRAL_SERVER_URL || 'https://api.example.com';

function isPlaceholderServerUrl(url) {
  const u = (url || defaultBaseURL || '').trim().toLowerCase();
  return !u || u === PLACEHOLDER_SERVER_URL.toLowerCase() || u.includes('api.example.com');
}

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

  /**
   * Fetch alerts from the last N hours (manual poll). Returns [] if server is placeholder or request fails.
   * @param {number} hours - Default MANUAL_POLL_HOURS (2)
   * @returns {Promise<Array>}
   */
  async fetchAlertsFromServer(hours = MANUAL_POLL_HOURS) {
    if (isPlaceholderServerUrl(defaultBaseURL)) {
      return [];
    }
    try {
      const { data } = await this._client.get('/alerts', {
        params: { hours, limit: 200 },
      });
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('[ApiService] fetchAlertsFromServer failed', e?.message);
      throw e;
    }
  }
}

export const apiService = new ApiService();
