/**
 * BLE service: scan, connect, and broadcast alerts via react-native-ble-plx.
 */

import { BleManager } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { BLE_CONFIG } from '../config/constants.js';

const { SERVICE_UUID, CHARACTERISTIC_UUID, DEVICE_NAME_PREFIX, SCAN_DURATION_MS } = BLE_CONFIG;

class BluetoothService {
  constructor() {
    this._manager = new BleManager();
    this._connectedDevices = new Map();
    this._onMessage = null;
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
    this._manager.startDeviceScan(
      null,
      { allowDuplicates: false },
      (err, device) => {
        if (err) {
          console.warn('[BluetoothService] scan error', err);
          return;
        }
        if (device && device.name && device.name.startsWith(DEVICE_NAME_PREFIX)) {
          onDeviceFound?.(device);
        }
      }
    );
  }

  stopScanning() {
    this._manager.stopDeviceScan();
  }

  async connectToDevice(device) {
    try {
      await device.connect();
      const discovered = await device.discoverAllServicesAndCharacteristics();
      this._connectedDevices.set(device.id, { device: discovered });
      return discovered;
    } catch (e) {
      console.warn('[BluetoothService] connectToDevice failed', e);
      throw e;
    }
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
    const payload = typeof alert === 'object' ? JSON.stringify(alert) : String(alert);
    const base64 = this._toBase64(payload);

    for (const [, { device }] of this._connectedDevices) {
      try {
        await device.writeCharacteristicForService(
          SERVICE_UUID,
          CHARACTERISTIC_UUID,
          base64
        );
      } catch (e) {
        console.warn('[BluetoothService] broadcastAlert write failed', device.id, e);
      }
    }
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
    // Optional: subscribe to characteristic on connected devices when needed
  }

  destroy() {
    this.stopScanning();
    this._connectedDevices.clear();
    this._manager.destroy();
  }
}

export const bluetoothService = new BluetoothService();
