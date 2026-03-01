/**
 * BLE service: scan, connect, and broadcast alerts via react-native-ble-plx.
 */

import { BleManager } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { Buffer } from 'buffer';
import { BLE_CONFIG, APP_CONFIG } from '../config/constants.js';

const { SERVICE_UUID, CHARACTERISTIC_UUID, DEVICE_NAME_PREFIX, SCAN_DURATION_MS } = BLE_CONFIG;

class BluetoothService {
  constructor() {
    this._manager = new BleManager();
    this._connectedDevices = new Map();
    this._connectingIds = new Set();
    this._onMessage = null;
    this._onDeviceFound = null;
  }

  async requestBluetoothPermissions() {
    if (Platform.OS !== 'android') return true;
    const apiLevel = Platform.Version;
    try {
      if (apiLevel >= 31) {
        const scan = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          { title: 'Bluetooth Scan', message: 'App needs Bluetooth to discover nearby devices.', buttonNeutral: 'Ask Later', buttonNegative: 'Cancel', buttonPositive: 'OK' }
        );
        const connect = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          { title: 'Bluetooth Connect', message: 'App needs Bluetooth to receive and share alerts.', buttonNeutral: 'Ask Later', buttonNegative: 'Cancel', buttonPositive: 'OK' }
        );
        return scan === PermissionsAndroid.RESULTS.GRANTED && connect === PermissionsAndroid.RESULTS.GRANTED;
      }
      const location = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        { title: 'Location', message: 'BLE scan requires location permission on this device.', buttonNeutral: 'Ask Later', buttonNegative: 'Cancel', buttonPositive: 'OK' }
      );
      return location === PermissionsAndroid.RESULTS.GRANTED;
    } catch (e) {
      console.warn('[BluetoothService] requestBluetoothPermissions failed', e);
      return false;
    }
  }

  async initialize() {
    return this.requestBluetoothPermissions();
  }

  startScanning(onDeviceFound) {
    this._onDeviceFound = onDeviceFound ?? null;
    this._manager.startDeviceScan(
      null,
      { allowDuplicates: false },
      (err, device) => {
        if (err) {
          console.warn('[BluetoothService] scan error', err);
          return;
        }
        if (device && device.name && device.name.startsWith(DEVICE_NAME_PREFIX)) {
          this._onDeviceFound?.(device);
        }
      }
    );
  }

  stopScanning() {
    this._manager.stopDeviceScan();
  }

  restartScanning() {
    if (!this._onDeviceFound) return;
    try { this.stopScanning(); } catch (_) {}
    setTimeout(() => this.startScanning(this._onDeviceFound), 500);
  }

  isDeviceConnected(deviceId) {
    return this._connectedDevices.has(deviceId);
  }

  async connectToDevice(device) {
    if (this._connectedDevices.has(device.id)) return this._connectedDevices.get(device.id).device;
    if (this._connectingIds.has(device.id)) return null;
    this._connectingIds.add(device.id);
    try {
      await device.connect({ refreshGatt: 'OnConnected' });
      await device.requestMTU(512);
      const discovered = await device.discoverAllServicesAndCharacteristics();
      this._connectedDevices.set(device.id, { device: discovered, name: device.name || null });
      discovered.onDisconnected(() => {
        this._connectedDevices.delete(device.id);
      });
      if (this._onMessage) {
        try {
          discovered.monitorCharacteristicForService(
            SERVICE_UUID,
            CHARACTERISTIC_UUID,
            (error, characteristic) => {
              if (error || !characteristic?.value || !this._onMessage) return;
              try {
                const decoded = Buffer.from(characteristic.value, 'base64').toString('utf8');
                const data = JSON.parse(decoded);
                this._onMessage(data);
              } catch (e) {
                if (APP_CONFIG.DEBUG_MODE) {
                  console.warn('[BluetoothService] monitor parse failed', e?.message);
                }
              }
            }
          );
        } catch (_) {}
      }
      return discovered;
    } catch (e) {
      console.warn('[BluetoothService] connectToDevice failed', e);
      throw e;
    } finally {
      this._connectingIds.delete(device.id);
    }
  }

  /**
   * List of BLE devices we send alerts to (connected peers).
   * @returns {{ id: string, name: string | null }[]}
   */
  getConnectedDevices() {
    const list = [];
    for (const [id, entry] of this._connectedDevices) {
      const name = entry.name ?? entry.device?.name ?? null;
      list.push({ id, name });
    }
    return list;
  }

  async disconnectDevice(deviceId) {
    try {
      await this._manager.cancelDeviceConnection(deviceId);
      this._connectedDevices.delete(deviceId);
    } catch (e) {
      console.warn('[BluetoothService] disconnectDevice failed', e);
    }
  }

  async broadcastAlert(alert) {
    if (this._connectedDevices.size === 0) {
      if (APP_CONFIG.DEBUG_MODE) {
        console.log('[BluetoothService] no devices connected; alert not sent via BLE');
      }
      return;
    }
    const payload = typeof alert === 'object' ? JSON.stringify(alert) : String(alert);
    const base64 = this._toBase64(payload);

    const toRemove = [];
    for (const [id, { device }] of this._connectedDevices) {
      try {
        await device.writeCharacteristicWithoutResponseForService(
          SERVICE_UUID,
          CHARACTERISTIC_UUID,
          base64
        );
      } catch (e) {
        const msg = (e?.message || String(e)).toLowerCase();
        if (msg.includes('not connected') || msg.includes('disconnected') || msg.includes('timed out') || msg.includes('rejected') || msg.includes('not found')) {
          toRemove.push(id);
        }
        if (APP_CONFIG.DEBUG_MODE) {
          console.warn('[BluetoothService] broadcastAlert write failed', device.id, e?.message);
        }
      }
    }
    toRemove.forEach((id) => this._connectedDevices.delete(id));
  }

  _toBase64(str) {
    if (typeof btoa !== 'undefined') {
      return btoa(unescape(encodeURIComponent(str)));
    }
    if (typeof global?.Buffer !== 'undefined') {
      return global.Buffer.from(str, 'utf8').toString('base64');
    }
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    let out = '';
    for (let i = 0; i < str.length; i += 3) {
      const a = str.charCodeAt(i);
      const b = str.charCodeAt(i + 1);
      const c = str.charCodeAt(i + 2);
      out += chars[a >> 2];
      out += chars[((a & 3) << 4) | (b >> 4)];
      out += isNaN(b) ? '=' : chars[((b & 15) << 2) | (c >> 6)];
      out += isNaN(c) ? '=' : chars[c & 63];
    }
    return out;
  }

  listenForAlerts(onMessage) {
    this._onMessage = onMessage;
  }

  destroy() {
    this.stopScanning();
    this._connectingIds.clear();
    this._connectedDevices.clear();
    this._manager.destroy();
  }
}

export const bluetoothService = new BluetoothService();
