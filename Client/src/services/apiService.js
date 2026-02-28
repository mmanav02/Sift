/**
 * HTTP client for central server: health, fetch alerts, create alert, types.
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

  setServerURL(url) {
    this._client.defaults.baseURL = url || defaultBaseURL;
  }

  async healthCheck() {
    try {
      const { data } = await this._client.get('/health');
      return data;
    } catch (e) {
      console.warn('[ApiService] healthCheck failed', e?.message);
      return null;
    }
  }

  async fetchAlerts(limit = 20, offsetTime = null) {
    try {
      const params = { limit };
      if (offsetTime != null) params.offsetTime = offsetTime;
      const { data } = await this._client.get('/api/alerts', { params });
      return Array.isArray(data) ? data : (data?.alerts ?? []);
    } catch (e) {
      console.warn('[ApiService] fetchAlerts failed', e?.message);
      return [];
    }
  }

  async fetchAlertsByCity(city, limit = 20) {
    try {
      const { data } = await this._client.get('/api/alerts', {
        params: { city, limit },
      });
      return Array.isArray(data) ? data : (data?.alerts ?? []);
    } catch (e) {
      console.warn('[ApiService] fetchAlertsByCity failed', e?.message);
      return [];
    }
  }

  async fetchAlertsByZipcode(zipcode, limit = 20) {
    try {
      const { data } = await this._client.get('/api/alerts', {
        params: { zipcode, limit },
      });
      return Array.isArray(data) ? data : (data?.alerts ?? []);
    } catch (e) {
      console.warn('[ApiService] fetchAlertsByZipcode failed', e?.message);
      return [];
    }
  }

  async getAlertById(alertId) {
    try {
      const { data } = await this._client.get(`/api/alerts/${encodeURIComponent(alertId)}`);
      return data ?? null;
    } catch (e) {
      console.warn('[ApiService] getAlertById failed', e?.message);
      return null;
    }
  }

  async createAlert(alertData) {
    try {
      const { data } = await this._client.post('/api/alerts', alertData);
      return data ?? null;
    } catch (e) {
      console.warn('[ApiService] createAlert failed', e?.message);
      return null;
    }
  }

  async getAlertTypes() {
    try {
      const { data } = await this._client.get('/api/alerts/types/list');
      return Array.isArray(data) ? data : (data?.types ?? []);
    } catch (e) {
      console.warn('[ApiService] getAlertTypes failed', e?.message);
      return [];
    }
  }
}

export const apiService = new ApiService();
