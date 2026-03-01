/**
 * Sift / Disaster News Mesh – App entry and wiring.
 * Initializes services, registration retry, BLE scan. Server pushes alerts to client.
 */

import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { alertService } from './src/services/alertService';
import { bluetoothService } from './src/services/bluetoothService';
import { apiService } from './src/services/apiService';
import { websocketService } from './src/services/websocketService';
import { LocalStorageService } from './src/store/localStorage';
import { isFromServer } from './src/utils/alertSchema';
import { generateMockAlert } from './src/utils/mockData';
import { APP_CONFIG, REGISTRATION_INTERVAL_MS, ALERT_SOURCE_SERVER, ALERT_SOURCE_BLUETOOTH, PLACEHOLDER_SERVER_URL, BLE_CONFIG } from './src/config/constants';
import AlertsMap from './src/components/AlertsMap';
import { blePeripheralService } from './src/services/blePeripheralService';

export default function App() {
  const [status, setStatus] = useState('Initializing…');
  const [stats, setStats] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [localAlerts, setLocalAlerts] = useState([]);
  const [bleDevices, setBleDevices] = useState([]);
  const [bleAdvertising, setBleAdvertising] = useState(false);
  const [view, setView] = useState('alerts');
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
            console.log('[App] Alert received', alert.id, alert.type, alert.city);
          }
          alertService.getLocalAlerts(20).then((alerts) => {
            if (mounted) setLocalAlerts(alerts);
          });
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
          if (!bluetoothService.isDeviceConnected(device.id)) {
            bluetoothService.connectToDevice(device).then(() => {
              if (mounted) setBleDevices(bluetoothService.getConnectedDevices());
              if (APP_CONFIG.DEBUG_MODE) {
                console.log('[App] BLE connected to', device.name || device.id);
              }
            }).catch(() => {});
          }
        });

        // ——— Registration (separate concern): optional, only when a real server URL is set ———
        const serverUrl = (APP_CONFIG.CENTRAL_SERVER_URL || '').trim().toLowerCase();
        const useServer = serverUrl && serverUrl !== PLACEHOLDER_SERVER_URL.toLowerCase() && !serverUrl.includes('api.example.com');

        async function tryRegister() {
          if (!useServer) return;
          try {
            const deviceId = await LocalStorageService.getDeviceId();
            const ok = await apiService.registerDevice(deviceId);
            if (mounted && ok) setStatus('Client App Running');
          } catch (e) {
            console.warn('[App] Registration failed', e?.message);
          }
        }

        if (useServer) {
          await tryRegister();
          const deviceId = await LocalStorageService.getDeviceId();
          websocketService.connect(APP_CONFIG.CENTRAL_SERVER_URL, deviceId);
          registrationIntervalRef.current = setInterval(tryRegister, REGISTRATION_INTERVAL_MS);
        }

        // ——— Receiving/sending alerts (separate concern): whenever a unique alert is received, store and propagate via BLE ———
        websocketService.setOnConnectionChange(setWsConnected);
        websocketService.setOnAlert(async (alert) => {
          await alertService.processAlert(alert, ALERT_SOURCE_SERVER);
        });

        bluetoothService.listenForAlerts(async (payload) => {
          try {
            const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
            await alertService.processAlert(data, ALERT_SOURCE_BLUETOOTH);
          } catch (e) {
            console.warn('[App] BLE alert parse failed', e?.message);
          }
        });

        // ——— Decentralized BLE: advertise so other Sift devices can find us and send alerts ———
        const deviceId = await LocalStorageService.getDeviceId();
        const shortId = (deviceId || '').replace(/-/g, '').slice(0, 8);
        const advertiseName = `${BLE_CONFIG.DEVICE_NAME_PREFIX}-${shortId || 'local'}`;
        await blePeripheralService.start(advertiseName, async (data) => {
          try {
            await alertService.processAlert(data, ALERT_SOURCE_BLUETOOTH);
            if (mounted) {
              const alerts = await alertService.getLocalAlerts(20);
              setLocalAlerts(alerts);
            }
          } catch (e) {
            console.warn('[App] BLE peripheral alert failed', e?.message);
          }
        });
        if (mounted) setBleAdvertising(blePeripheralService.isAdvertising());

        statsIntervalRef.current = setInterval(async () => {
          if (!mounted) return;
          const s = await alertService.getStatistics();
          setStats(s);
          const alerts = await alertService.getLocalAlerts(20);
          if (mounted) setLocalAlerts(alerts);
          if (mounted) setWsConnected(websocketService.isConnected());
          if (mounted) setBleDevices(bluetoothService.getConnectedDevices());
          if (mounted) setBleAdvertising(blePeripheralService.isAdvertising());
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
      blePeripheralService.stop();
      bluetoothService.destroy();
    };
  }, []);

  const formatTime = (ts) => {
    if (!ts) return '—';
    try {
      const d = new Date(ts);
      return isNaN(d.getTime()) ? '—' : d.toLocaleString();
    } catch {
      return '—';
    }
  };

  const sendFakeAlerts = async () => {
    const alerts = [
      generateMockAlert(),
      generateMockAlert(),
      generateMockAlert({ source: ALERT_SOURCE_BLUETOOTH }),
    ];
    await alertService.processAlert(alerts[0], ALERT_SOURCE_SERVER);
    await alertService.processAlert(alerts[1], ALERT_SOURCE_SERVER);
    await alertService.processAlert(alerts[2], ALERT_SOURCE_BLUETOOTH);
    const updated = await alertService.getLocalAlerts(20);
    setLocalAlerts(updated);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sift</Text>
      <Text style={styles.status}>{status}</Text>
      <Text style={styles.connection}>
        Server: {wsConnected ? 'connected' : 'disconnected'}
      </Text>
      <Text style={styles.hint}>Check console for activity</Text>
      {stats && (
        <View style={styles.stats}>
          <Text style={styles.statsText}>
            Received: {stats.totalReceived} · Stored: {stats.storedCount}
          </Text>
        </View>
      )}
      <View style={styles.bleSection}>
        <Text style={styles.bleSectionTitle}>Decentralized BLE</Text>
        {bleAdvertising ? (
          <Text style={styles.bleDevice}>Advertising (others can find & send alerts)</Text>
        ) : (
          <Text style={styles.bleEmpty}>Not advertising</Text>
        )}
        <Text style={[styles.bleSectionTitle, { marginTop: 6 }]}>Sending alerts via BLE to</Text>
        {bleDevices.length === 0 ? (
          <Text style={styles.bleEmpty}>No BLE devices connected</Text>
        ) : (
          bleDevices.map((d) => (
            <Text key={d.id} style={styles.bleDevice}>
              • {d.name || d.id}
            </Text>
          ))
        )}
      </View>
      <View style={styles.tabRow}>
        <Pressable style={[styles.tab, view === 'alerts' && styles.tabActive]} onPress={() => setView('alerts')}>
          <Text style={[styles.tabText, view === 'alerts' && styles.tabTextActive]}>Alerts</Text>
        </Pressable>
        <Pressable style={[styles.tab, view === 'map' && styles.tabActive]} onPress={() => setView('map')}>
          <Text style={[styles.tabText, view === 'map' && styles.tabTextActive]}>Map</Text>
        </Pressable>
      </View>
      <Pressable style={styles.fakeButton} onPress={sendFakeAlerts}>
        <Text style={styles.fakeButtonText}>Send fake alerts</Text>
      </Pressable>
      {view === 'alerts' && (
        <>
          <Text style={styles.sectionTitle}>Recent alerts</Text>
          <ScrollView style={styles.alertList} contentContainerStyle={styles.alertListContent}>
            {localAlerts.length === 0 ? (
              <Text style={styles.emptyText}>No alerts yet</Text>
            ) : (
              localAlerts.map((alert) => (
                <View key={alert.id || (alert.created_at || alert.timestamp) + alert.city} style={styles.alertRow}>
                  <Text style={styles.alertSource}>
                    {isFromServer(alert) ? 'Server' : 'Bluetooth'}
                  </Text>
                  <Text style={styles.alertType}>{alert.title || alert.type || 'other'}</Text>
                  <Text style={styles.alertCity}>{alert.city || '—'}</Text>
                  <Text style={styles.alertMeta}>
                    Severity {alert.severity ?? '—'} · {formatTime(alert.created_at || alert.timestamp)}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>
        </>
      )}
      {view === 'map' && (
        <View style={styles.mapContainer}>
          <AlertsMap alerts={localAlerts} style={styles.map} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#eee',
    marginBottom: 12,
    textAlign: 'center',
  },
  status: {
    fontSize: 16,
    color: '#a0a0a0',
    marginBottom: 4,
    textAlign: 'center',
  },
  connection: {
    fontSize: 14,
    color: '#888',
    marginBottom: 4,
    textAlign: 'center',
  },
  hint: {
    fontSize: 12,
    color: '#666',
    marginBottom: 16,
    textAlign: 'center',
  },
  stats: {
    marginBottom: 16,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#16213e',
    borderRadius: 8,
    alignSelf: 'center',
  },
  statsText: {
    fontSize: 14,
    color: '#a0a0a0',
  },
  bleSection: {
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#16213e',
    borderRadius: 8,
  },
  bleSectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8af',
    marginBottom: 4,
  },
  bleEmpty: {
    fontSize: 12,
    color: '#666',
  },
  bleDevice: {
    fontSize: 12,
    color: '#ccc',
    marginLeft: 4,
  },
  fakeButton: {
    alignSelf: 'center',
    marginBottom: 16,
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: '#16213e',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#4a6fa5',
  },
  fakeButtonText: {
    fontSize: 14,
    color: '#8af',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ccc',
    marginBottom: 8,
  },
  alertList: {
    flex: 1,
    maxHeight: 280,
  },
  alertListContent: {
    paddingBottom: 24,
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
  },
  alertRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: '#16213e',
    borderRadius: 8,
  },
  alertSource: {
    fontSize: 11,
    color: '#8af',
    marginBottom: 2,
  },
  alertType: {
    fontSize: 14,
    fontWeight: '600',
    color: '#eee',
  },
  alertCity: {
    fontSize: 13,
    color: '#aaa',
  },
  alertMeta: {
    fontSize: 11,
    color: '#666',
    marginTop: 4,
  },
  tabRow: {
    flexDirection: 'row',
    alignSelf: 'center',
    marginBottom: 12,
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    marginHorizontal: 4,
    borderRadius: 8,
    backgroundColor: '#16213e',
  },
  tabActive: {
    backgroundColor: '#4a6fa5',
  },
  tabText: {
    fontSize: 14,
    color: '#8af',
  },
  tabTextActive: {
    color: '#eee',
    fontWeight: '600',
  },
  mapContainer: {
    flex: 1,
    minHeight: 280,
    borderRadius: 8,
    overflow: 'hidden',
  },
  map: {
    flex: 1,
  },
});
