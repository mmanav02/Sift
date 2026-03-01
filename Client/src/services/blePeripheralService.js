/**
 * BLE peripheral: advertise so other Sift devices can find and connect to us,
 * and receive alert payloads written to our characteristic (decentralized mesh).
 */

import { Platform, PermissionsAndroid } from 'react-native';
import Peripheral, { Permission, Property } from 'react-native-multi-ble-peripheral';
import { Buffer } from 'buffer';
import { BLE_CONFIG, APP_CONFIG } from '../config/constants.js';

const { SERVICE_UUID, CHARACTERISTIC_UUID, DEVICE_NAME_PREFIX } = BLE_CONFIG;

class BlePeripheralService {
  constructor() {
    this._peripheral = null;
    this._onAlertReceived = null;
    this._advertising = false;
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

    this._peripheral.on('write', ({ service, characteristic, value }) => {
      if (characteristic !== CHARACTERISTIC_UUID || !this._onAlertReceived) return;
      try {
        let data;
        if (typeof value === 'string') {
          try {
            data = JSON.parse(value);
          } catch {
            const decoded = Buffer.from(value, 'base64').toString('utf8');
            data = JSON.parse(decoded);
          }
        } else {
          data = value;
        }
        if (data && this._onAlertReceived) this._onAlertReceived(data);
      } catch (e) {
        console.warn('[BlePeripheralService] write parse failed', e?.message);
      }
    });

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

  isAdvertising() {
    return this._advertising && this._peripheral != null;
  }

  async stop() {
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
