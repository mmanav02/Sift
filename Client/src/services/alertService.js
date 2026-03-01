/**
 * Alert service: process, de-dupe, store, and broadcast alerts.
 * Singleton; initialize with bluetoothService reference.
 */

import { STORAGE_LIMITS } from '../config/constants.js';
import { LocalStorageService } from '../store/localStorage.js';
import { AlertMessage } from '../utils/alertSchema.js';

class AlertService {
  constructor() {
    this._bluetoothService = null;
    this._onAlertReceived = null;
    this._onAlertBroadcasted = null;
  }

  async initialize(bluetoothService) {
    await LocalStorageService.initialize();
    this._bluetoothService = bluetoothService || null;
  }

  /**
   * Single entry point for any received alert (server, BLE, or fake).
   * Independent of registration: whenever a unique alert is received, we store and propagate via BLE.
   * Checks for duplicate; if new, stores and propagates via Bluetooth.
   * @param {object|AlertMessage} alert - Alert data (id required)
   * @param {string} source - ALERT_SOURCE_SERVER | ALERT_SOURCE_BLUETOOTH
   * @returns {Promise<boolean>} true if accepted and processed, false if duplicate/invalid
   */
  async processAlert(alert, source) {
    const msg = AlertMessage.fromJSON(typeof alert?.toJSON === 'function' ? alert.toJSON() : alert);
    if (!msg || !msg.id) return false;

    const duplicate = await LocalStorageService.isMessageDuplicate(msg.id);
    if (duplicate) return false;

    msg.source = source;
    await LocalStorageService.addMessageId(msg.id);
    await LocalStorageService.saveAlert(msg);

    // Propagate to nearby devices via BLE (same path for fake, server, or BLE-originated alerts)
    if (this._bluetoothService && typeof this._bluetoothService.broadcastAlert === 'function') {
      await this.broadcastAlert(msg);
    }

    if (this._onAlertReceived) this._onAlertReceived(msg);
    return true;
  }

  async broadcastAlert(alert) {
    const payload = typeof alert?.toJSON === 'function' ? alert.toJSON() : alert;
    if (this._bluetoothService && typeof this._bluetoothService.broadcastAlert === 'function') {
      await this._bluetoothService.broadcastAlert(payload);
    }
    if (this._onAlertBroadcasted) this._onAlertBroadcasted(payload);
  }

  async getLocalAlerts(limit = 50) {
    return LocalStorageService.getLocalAlerts(limit);
  }

  async getStatistics() {
    const ids = await LocalStorageService.getReceivedMessageIds();
    const alerts = await LocalStorageService.getLocalAlerts(STORAGE_LIMITS.MAX_LOCAL_ALERTS);
    const byType = {};
    const bySeverity = {};
    alerts.forEach((a) => {
      const t = a.type ?? a.alertType;
      byType[t] = (byType[t] || 0) + 1;
      bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1;
    });
    return {
      totalReceived: ids.length,
      storedCount: alerts.length,
      byType,
      bySeverity,
    };
  }

  onAlert(callback) {
    this._onAlertReceived = callback;
  }

  onBroadcast(callback) {
    this._onAlertBroadcasted = callback;
  }
}

export const alertService = new AlertService();
