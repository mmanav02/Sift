/**
 * BLE peripheral: advertise so other Sift devices can find and connect to us,
 * and receive alert payloads written to our characteristic (decentralized mesh).
 */

import { Platform, PermissionsAndroid, NativeModules, NativeEventEmitter } from 'react-native';
import Peripheral, { Permission, Property } from 'react-native-multi-ble-peripheral';
import { Buffer } from 'buffer';
import { BLE_CONFIG, APP_CONFIG } from '../config/constants.js';

const { SERVICE_UUID, CHARACTERISTIC_UUID, DEVICE_NAME_PREFIX } = BLE_CONFIG;

const { ReactNativeMultiBlePeripheral: NativeBlePeripheral } = NativeModules;
const nativeBleEvents = NativeBlePeripheral
  ? new NativeEventEmitter(NativeBlePeripheral)
  : null;

class BlePeripheralService {
  constructor() {
    this._peripheral = null;
    this._onAlertReceived = null;
    this._advertising = false;
    this._nativeWriteSub = null;
  }

  async requestAdvertisePermission() {
    if (Platform.OS !== 'android') return true;
    try {
      const apiLevel = Platform.Version;
      if (apiLevel >= 31) {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
          {
            title: 'Bluetooth Advertise',
            message: 'App needs to advertise so other Sift devices can find and send alerts.',
            buttonNeutral: 'Ask Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );
        return result === PermissionsAndroid.RESULTS.GRANTED;
      }
      return true;
    } catch (e) {
      console.warn('[BlePeripheralService] requestAdvertisePermission failed', e);
      return false;
    }
  }

  /**
   * Start advertising as a BLE peripheral so other devices can connect and write alerts to us.
   * @param {string} deviceName - Advertised name (e.g. DEVICE_NAME_PREFIX + '-' + shortId)
   * @param {(alert: object) => void} onAlertReceived - Called when a peer writes an alert to our characteristic
   */
  async start(deviceName, onAlertReceived) {
    if (this._peripheral) {
      if (APP_CONFIG.DEBUG_MODE) console.log('[BlePeripheralService] already running');
      return;
    }

    const ok = await this.requestAdvertisePermission();
    if (!ok) {
      console.warn('[BlePeripheralService] BLUETOOTH_ADVERTISE not granted');
      return;
    }

    this._onAlertReceived = onAlertReceived;
    const name = (deviceName || DEVICE_NAME_PREFIX).substring(0, 29);
    Peripheral.setDeviceName(name);

    this._peripheral = new Peripheral();

    // Listen to the native onWrite event directly instead of going through
    // the library's JS wrapper, which has a type-mismatch bug that silently
    // drops every write (native sends id as string, library compares with ===
    // against a number).
    if (nativeBleEvents) {
      this._nativeWriteSub = nativeBleEvents.addListener(
        'onWrite',
        ({ characteristic, value }) => {
          const charMatch =
            characteristic === CHARACTERISTIC_UUID ||
            (typeof characteristic === 'string' &&
              characteristic.toLowerCase() === CHARACTERISTIC_UUID.toLowerCase());
          if (!charMatch || !this._onAlertReceived) return;
          try {
            const data = this._parseWriteValue(value);
            if (data) {
              if (APP_CONFIG.DEBUG_MODE) {
                console.log(
                  '[BlePeripheralService] write received',
                  data._type === 'ping' ? '(ping)' : '(alert)',
                  typeof value,
                );
              }
              this._onAlertReceived(data);
            }
          } catch (e) {
            console.warn('[BlePeripheralService] write parse failed', e?.message);
          }
        },
      );
    }

    this._peripheral.on('error', (err) => {
      console.warn('[BlePeripheralService] error', err?.message);
    });

    await new Promise((resolve, reject) => {
      this._peripheral.on('ready', async () => {
        try {
          await this._peripheral.addService(SERVICE_UUID, true);
          await this._peripheral.addCharacteristic(
            SERVICE_UUID,
            CHARACTERISTIC_UUID,
            Property.READ | Property.WRITE | Property.WRITE_NO_RESPONSE,
            Permission.READABLE | Permission.WRITEABLE
          );
          await this._peripheral.startAdvertising();
          this._advertising = true;
          if (APP_CONFIG.DEBUG_MODE) {
            console.log('[BlePeripheralService] advertising as', name);
          }
          resolve();
        } catch (e) {
          console.warn('[BlePeripheralService] startAdvertising failed', e?.message);
          reject(e);
        }
      });
    });
  }

  /**
   * Decode the raw value from a BLE write event into a JS object.
   * Handles: JSON string, base64 string, byte array (number[]),
   * Uint8Array, ArrayBuffer, and Buffer.
   */
  _parseWriteValue(value) {
    if (!value) return null;

    // Already a parsed object (unlikely but safe)
    if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof ArrayBuffer) && value._type !== undefined) {
      return value;
    }

    let jsonStr = null;

    if (typeof value === 'string') {
      // Could be raw JSON or base64-encoded JSON
      if (value.startsWith('{') || value.startsWith('[')) {
        jsonStr = value;
      } else {
        try {
          jsonStr = Buffer.from(value, 'base64').toString('utf8');
        } catch {
          jsonStr = value;
        }
      }
    } else if (value instanceof ArrayBuffer) {
      jsonStr = Buffer.from(new Uint8Array(value)).toString('utf8');
    } else if (ArrayBuffer.isView(value)) {
      jsonStr = Buffer.from(value).toString('utf8');
    } else if (Array.isArray(value)) {
      // byte array: [123, 34, 95, ...] → convert to string
      jsonStr = String.fromCharCode(...value);
    } else if (typeof value === 'object' && value !== null && typeof value.length === 'number') {
      // Array-like object
      const arr = Array.from(value);
      jsonStr = String.fromCharCode(...arr);
    }

    if (!jsonStr) return null;

    try {
      return JSON.parse(jsonStr);
    } catch {
      // Maybe the string itself was double-base64-encoded
      try {
        const retry = Buffer.from(jsonStr, 'base64').toString('utf8');
        return JSON.parse(retry);
      } catch {
        return null;
      }
    }
  }

  isAdvertising() {
    return this._advertising && this._peripheral != null;
  }

  async stop() {
    if (this._nativeWriteSub) {
      this._nativeWriteSub.remove();
      this._nativeWriteSub = null;
    }
    if (!this._peripheral) return;
    try {
      await this._peripheral.stopAdvertising();
      await this._peripheral.destroy();
    } catch (e) {
      console.warn('[BlePeripheralService] stop failed', e?.message);
    }
    this._peripheral = null;
    this._advertising = false;
    this._onAlertReceived = null;
  }
}

export const blePeripheralService = new BlePeripheralService();
