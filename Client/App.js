/**
 * Sift / Disaster News Mesh – App entry and wiring.
 * Initializes services, registration retry, BLE scan. Server pushes alerts to client.
 */

import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { alertService } from './src/services/alertService';
import { bluetoothService } from './src/services/bluetoothService';
import { apiService } from './src/services/apiService';
import { websocketService } from './src/services/websocketService';
import { LocalStorageService } from './src/store/localStorage';
import { APP_CONFIG, REGISTRATION_INTERVAL_MS, ALERT_SOURCE_SERVER } from './src/config/constants';

export default function App() {
  const [status, setStatus] = useState('Initializing…');
  const [stats, setStats] = useState(null);
  const registrationIntervalRef = useRef(null);
  const statsIntervalRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    async function initializeApp() {
      try {
        setStatus('Starting services…');
        await alertService.initialize(bluetoothService);
        await bluetoothService.initialize();

        alertService.onAlert((alert) => {
          if (APP_CONFIG.DEBUG_MODE) {
            console.log('[App] Alert received', alert.id, alert.alertType, alert.city);
          }
        });
        alertService.onBroadcast((alert) => {
          if (APP_CONFIG.DEBUG_MODE) {
            console.log('[App] Alert broadcast', alert.id);
          }
        });

        bluetoothService.startScanning((device) => {
          if (APP_CONFIG.DEBUG_MODE) {
            console.log('[App] BLE device found', device.name, device.id);
          }
        });

        websocketService.setOnAlert(async (alert) => {
          await alertService.processAlert(alert, ALERT_SOURCE_SERVER);
        });

        async function tryRegister() {
          try {
            const deviceId = await LocalStorageService.getDeviceId();
            const ok = await apiService.registerDevice(deviceId);
            if (mounted && ok) setStatus('Client App Running');
          } catch (e) {
            console.warn('[App] Registration failed', e?.message);
          }
        }

        await tryRegister();
        const deviceId = await LocalStorageService.getDeviceId();
        websocketService.connect(APP_CONFIG.CENTRAL_SERVER_URL, deviceId);
        registrationIntervalRef.current = setInterval(tryRegister, REGISTRATION_INTERVAL_MS);

        statsIntervalRef.current = setInterval(async () => {
          if (!mounted) return;
          const s = await alertService.getStatistics();
          setStats(s);
        }, 10000);

        if (mounted) setStatus('Client App Running');
      } catch (e) {
        console.warn('[App] initializeApp failed', e);
        setStatus('Error: ' + (e?.message || 'Initialization failed'));
      }
    }

    initializeApp();

    return () => {
      mounted = false;
      if (registrationIntervalRef.current) clearInterval(registrationIntervalRef.current);
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
      websocketService.disconnect();
      bluetoothService.destroy();
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sift</Text>
      <Text style={styles.status}>{status}</Text>
      <Text style={styles.hint}>Check console for activity</Text>
      {stats && (
        <View style={styles.stats}>
          <Text style={styles.statsText}>
            Received: {stats.totalReceived} · Stored: {stats.storedCount}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#eee',
    marginBottom: 12,
  },
  status: {
    fontSize: 16,
    color: '#a0a0a0',
    marginBottom: 8,
  },
  hint: {
    fontSize: 12,
    color: '#666',
    marginBottom: 24,
  },
  stats: {
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#16213e',
    borderRadius: 8,
  },
  statsText: {
    fontSize: 14,
    color: '#a0a0a0',
  },
});
