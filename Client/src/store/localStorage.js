/**
 * AsyncStorage wrapper for received message IDs, local alerts, and device settings.
 * All methods are static; no constructor state.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuid } from 'uuid';
import { STORAGE_KEYS, STORAGE_LIMITS } from '../config/constants.js';

const {
  RECEIVED_MESSAGE_IDS,
  LOCAL_ALERTS,
  SETTINGS,
} = STORAGE_KEYS;

const {
  MAX_MESSAGE_IDS,
  MAX_LOCAL_ALERTS,
} = STORAGE_LIMITS;

export const LocalStorageService = {
  async initialize() {
    try {
      const ids = await AsyncStorage.getItem(RECEIVED_MESSAGE_IDS);
      const alerts = await AsyncStorage.getItem(LOCAL_ALERTS);
      const settings = await AsyncStorage.getItem(SETTINGS);
      if (ids === null) await AsyncStorage.setItem(RECEIVED_MESSAGE_IDS, JSON.stringify([]));
      if (alerts === null) await AsyncStorage.setItem(LOCAL_ALERTS, JSON.stringify([]));
      if (settings === null) await AsyncStorage.setItem(SETTINGS, JSON.stringify({}));
    } catch (e) {
      console.warn('[LocalStorage] initialize failed', e);
    }
  },

  async isMessageDuplicate(messageId) {
    try {
      const raw = await AsyncStorage.getItem(RECEIVED_MESSAGE_IDS);
      const ids = raw ? JSON.parse(raw) : [];
      return ids.includes(messageId);
    } catch {
      return false;
    }
  },

  async addMessageId(messageId) {
    try {
      const raw = await AsyncStorage.getItem(RECEIVED_MESSAGE_IDS);
      const ids = raw ? JSON.parse(raw) : [];
      if (ids.includes(messageId)) return;
      ids.push(messageId);
      const trimmed = ids.slice(-MAX_MESSAGE_IDS);
      await AsyncStorage.setItem(RECEIVED_MESSAGE_IDS, JSON.stringify(trimmed));
    } catch (e) {
      console.warn('[LocalStorage] addMessageId failed', e);
    }
  },

  async getReceivedMessageIds() {
    try {
      const raw = await AsyncStorage.getItem(RECEIVED_MESSAGE_IDS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  async saveAlert(alert) {
    try {
      const raw = await AsyncStorage.getItem(LOCAL_ALERTS);
      const alerts = raw ? JSON.parse(raw) : [];
      const payload = typeof alert.toJSON === 'function' ? alert.toJSON() : alert;
      alerts.push(payload);
      const trimmed = alerts.slice(-MAX_LOCAL_ALERTS);
      await AsyncStorage.setItem(LOCAL_ALERTS, JSON.stringify(trimmed));
    } catch (e) {
      console.warn('[LocalStorage] saveAlert failed', e);
    }
  },

  async getLocalAlerts(limit = 50) {
    try {
      const raw = await AsyncStorage.getItem(LOCAL_ALERTS);
      const alerts = raw ? JSON.parse(raw) : [];
      const n = Math.min(limit, alerts.length);
      return alerts.slice(-n).reverse();
    } catch {
      return [];
    }
  },

  async clearAllData() {
    try {
      await AsyncStorage.multiRemove([RECEIVED_MESSAGE_IDS, LOCAL_ALERTS]);
    } catch (e) {
      console.warn('[LocalStorage] clearAllData failed', e);
    }
  },

  async getSettings() {
    try {
      const raw = await AsyncStorage.getItem(SETTINGS);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  },

  async updateSettings(settings) {
    try {
      const current = await this.getSettings();
      const next = { ...current, ...settings };
      await AsyncStorage.setItem(SETTINGS, JSON.stringify(next));
    } catch (e) {
      console.warn('[LocalStorage] updateSettings failed', e);
    }
  },

  async getDeviceId() {
    const settings = await this.getSettings();
    if (settings.deviceId) return settings.deviceId;
    const deviceId = uuid();
    await this.updateSettings({ deviceId });
    return deviceId;
  },
};
