import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { alertService } from './src/services/alertService';
import { bluetoothService } from './src/services/bluetoothService';
import { apiService } from './src/services/apiService';
import { websocketService } from './src/services/websocketService';
import { LocalStorageService } from './src/store/localStorage';
import { isFromServer } from './src/utils/alertSchema';
import { generateMockAlert } from './src/utils/mockData';
import {
  APP_CONFIG,
  REGISTRATION_INTERVAL_MS,
  ALERT_SOURCE_SERVER,
  ALERT_SOURCE_BLUETOOTH,
  PLACEHOLDER_SERVER_URL,
  BLE_CONFIG,
  SEVERITY_COLORS,
} from './src/config/constants';
import AlertsMap from './src/components/AlertsMap';
import { blePeripheralService } from './src/services/blePeripheralService';

const ALERT_ICONS = {
  earthquake: '🌍',
  flood: '🌊',
  storm: '⛈️',
  wildfire: '🔥',
  fire: '🔥',
  tsunami: '🌊',
  tornado: '🌪️',
  hurricane: '🌀',
  landslide: '⛰️',
  drought: '☀️',
  infrastructure: '🏗️',
  other: '⚠️',
};

const TABS = [
  { key: 'alerts', label: 'Alerts', icon: '🔔' },
  { key: 'map', label: 'Map', icon: '🗺️' },
  { key: 'network', label: 'Network', icon: '📡' },
];

function getSeverityColor(severity) {
  if (!severity) return SEVERITY_COLORS.info;
  const key = String(severity).toLowerCase();
  if (SEVERITY_COLORS[key]) return SEVERITY_COLORS[key];
  const n = Number(severity);
  if (n >= 9) return SEVERITY_COLORS.critical;
  if (n >= 7) return SEVERITY_COLORS.high;
  if (n >= 4) return SEVERITY_COLORS.medium;
  return SEVERITY_COLORS.low;
}

function getSeverityLabel(severity) {
  if (!severity) return '—';
  const key = String(severity).toLowerCase();
  if (SEVERITY_COLORS[key]) return key.charAt(0).toUpperCase() + key.slice(1);
  const n = Number(severity);
  if (n >= 9) return 'Critical';
  if (n >= 7) return 'High';
  if (n >= 4) return 'Medium';
  return 'Low';
}

function getAlertIcon(type) {
  return ALERT_ICONS[type?.toLowerCase()] || '⚠️';
}

export default function App() {
  const [status, setStatus] = useState('Initializing…');
  const [stats, setStats] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [localAlerts, setLocalAlerts] = useState([]);
  const [bleDevices, setBleDevices] = useState([]);
  const [bleAdvertising, setBleAdvertising] = useState(false);
  const [view, setView] = useState('alerts');
  const [mapTheme, setMapTheme] = useState('dark');
  const [pingSending, setPingSending] = useState(false);
  const [pingSent, setPingSent] = useState(0);
  const [pingsReceived, setPingsReceived] = useState([]);
  const statsIntervalRef = useRef(null);
  const pingsReceivedRef = useRef([]);

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

        const serverUrl = (APP_CONFIG.CENTRAL_SERVER_URL || '').trim().toLowerCase();
        const useServer =
          serverUrl &&
          serverUrl !== PLACEHOLDER_SERVER_URL.toLowerCase() &&
          !serverUrl.includes('api.example.com');

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
          const deviceId = await LocalStorageService.getDeviceId();
          websocketService.setOnConnectionOpen(tryRegister);
          websocketService.connect(APP_CONFIG.CENTRAL_SERVER_URL, deviceId);
        }

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

        const deviceId = await LocalStorageService.getDeviceId();
        const shortId = (deviceId || '').replace(/-/g, '').slice(0, 8);
        const advertiseName = `${BLE_CONFIG.DEVICE_NAME_PREFIX}-${shortId || 'local'}`;
        await blePeripheralService.start(advertiseName, async (data) => {
          try {
            if (data && data._type === 'ping') {
              console.log(`[App] PING received: ${data.seq}/${data.total} from ${data.sender}`);
              const entry = { seq: data.seq, total: data.total, sender: data.sender, ts: Date.now() };
              pingsReceivedRef.current = [...pingsReceivedRef.current.slice(-19), entry];
              if (mounted) setPingsReceived([...pingsReceivedRef.current]);
              return;
            }
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

        bluetoothService.startScanning((device) => {
          if (APP_CONFIG.DEBUG_MODE) {
            console.log('[App] BLE device found', device.name, device.id);
          }
          if (!bluetoothService.isDeviceConnected(device.id)) {
            bluetoothService
              .connectToDevice(device)
              .then(() => {
                if (mounted) setBleDevices(bluetoothService.getConnectedDevices());
              })
              .catch(() => {});
          }
        });

        statsIntervalRef.current = setInterval(async () => {
          if (!mounted) return;
          bluetoothService.restartScanning();
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
      if (isNaN(d.getTime())) return '—';
      const diff = Date.now() - d.getTime();
      if (diff < 60000) return 'Just now';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
      return d.toLocaleDateString();
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

  const sendPing = async () => {
    const devices = bluetoothService.getConnectedDevices();
    if (devices.length === 0) {
      Alert.alert('No devices', 'No BLE devices connected to ping.');
      return;
    }
    setPingSending(true);
    setPingSent(0);
    const total = 10;
    let sent = 0;
    for (let i = 1; i <= total; i++) {
      const ping = { _type: 'ping', seq: i, total, sender: status, ts: Date.now() };
      try {
        await bluetoothService.broadcastAlert(ping);
        sent++;
        setPingSent(i);
      } catch (e) {
        console.warn(`[App] PING FAILED: ${i}/${total}`, e?.message);
      }
      if (i < total) await new Promise((r) => setTimeout(r, 300));
    }
    setPingSending(false);
    Alert.alert('Ping complete', `Sent ${sent}/${total} pings to ${devices.length} device(s).`);
  };

  const clearPings = useCallback(() => {
    pingsReceivedRef.current = [];
    setPingsReceived([]);
  }, []);

  const alertLocation = (alert) =>
    [alert.city, alert.state, alert.country].filter(Boolean).join(', ') || '—';

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a14" />

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerIcon}>🛡️</Text>
          <View>
            <Text style={styles.title}>Sift</Text>
            <Text style={styles.subtitle}>Disaster Alert Network</Text>
          </View>
        </View>
        <View style={[styles.statusPill, wsConnected ? styles.pillGreen : styles.pillRed]}>
          <View style={[styles.statusDot, wsConnected ? styles.dotGreen : styles.dotRed]} />
          <Text style={[styles.headerStatus, wsConnected ? styles.statusTextGreen : styles.statusTextRed]}>
            {wsConnected ? 'Live' : 'Offline'}
          </Text>
        </View>
      </View>

      {stats && (
        <View style={styles.statsRow}>
          <View style={styles.pill}>
            <Text style={styles.pillText}>📥 {stats.totalReceived}</Text>
          </View>
          <View style={styles.pill}>
            <Text style={styles.pillText}>💾 {stats.storedCount}</Text>
          </View>
          <View style={styles.pill}>
            <Text style={styles.pillText}>📡 {bleDevices.length} BLE</Text>
          </View>
        </View>
      )}

      <View style={styles.content}>
        {view === 'alerts' && (
          <ScrollView
            style={styles.alertList}
            contentContainerStyle={styles.alertListContent}
            showsVerticalScrollIndicator={false}
          >
            {localAlerts.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>🔕</Text>
                <Text style={styles.emptyTitle}>No alerts yet</Text>
                <Text style={styles.emptySubtitle}>
                  Alerts from server and nearby devices will appear here
                </Text>
              </View>
            ) : (
              localAlerts.map((alert) => {
                const color = getSeverityColor(alert.severity);
                const icon = getAlertIcon(alert.type);
                const sevLabel = getSeverityLabel(alert.severity);
                return (
                  <View
                    key={alert.id || (alert.created_at || alert.timestamp) + alert.city}
                    style={[styles.alertCard, { borderLeftColor: color }]}
                  >
                    <View style={styles.alertCardTop}>
                      <Text style={styles.alertIcon}>{icon}</Text>
                      <View style={styles.alertCardMid}>
                        <Text style={styles.alertTitle} numberOfLines={1}>
                          {alert.title || alert.type || 'Alert'}
                        </Text>
                        <Text style={styles.alertLocation}>{alertLocation(alert)}</Text>
                      </View>
                      <View style={[styles.severityBadge, { borderColor: color }]}>
                        <Text style={[styles.severityText, { color }]}>{sevLabel}</Text>
                      </View>
                    </View>
                    <View style={styles.alertCardBottom}>
                      <Text style={styles.alertSource}>
                        {isFromServer(alert) ? '🌐 Server' : '📶 BLE'}
                      </Text>
                      <Text style={styles.alertTime}>
                        {formatTime(alert.created_at || alert.timestamp)}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        )}

        {view === 'map' && (
          <View style={{ flex: 1 }}>
            <View style={styles.mapToolbar}>
              <Pressable
                style={[styles.themeToggle, mapTheme === 'dark' && styles.themeToggleActive]}
                onPress={() => setMapTheme('dark')}
              >
                <Text style={styles.themeToggleText}>🌙 Dark</Text>
              </Pressable>
              <Pressable
                style={[styles.themeToggle, mapTheme === 'light' && styles.themeToggleActive]}
                onPress={() => setMapTheme('light')}
              >
                <Text style={styles.themeToggleText}>☀️ Light</Text>
              </Pressable>
            </View>
            <AlertsMap alerts={localAlerts} style={{ flex: 1 }} theme={mapTheme} />
          </View>
        )}

        {view === 'network' && (
          <ScrollView
            style={styles.networkScroll}
            contentContainerStyle={styles.networkContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.networkCard}>
              <Text style={styles.networkCardTitle}>Server</Text>
              <View style={styles.networkRow}>
                <View style={[styles.statusDot, wsConnected ? styles.dotGreen : styles.dotRed]} />
                <Text style={styles.networkValue}>
                  {wsConnected ? 'Connected' : 'Disconnected'}
                </Text>
              </View>
              <Text style={styles.networkSubtext}>{status}</Text>
            </View>

            <View style={styles.networkCard}>
              <Text style={styles.networkCardTitle}>Bluetooth (BLE)</Text>
              <View style={styles.networkRow}>
                <View
                  style={[styles.statusDot, bleAdvertising ? styles.dotGreen : styles.dotRed]}
                />
                <Text style={styles.networkValue}>
                  {bleAdvertising ? 'Advertising' : 'Not advertising'}
                </Text>
              </View>
              <Text style={styles.networkSubtext}>
                {bleDevices.length === 0
                  ? 'No devices connected'
                  : `${bleDevices.length} device(s) connected`}
              </Text>
              {bleDevices.map((d) => (
                <Text key={d.id} style={styles.bleDeviceItem}>
                  • {d.name || d.id}
                </Text>
              ))}
            </View>

            {pingsReceived.length > 0 && (
              <View style={styles.networkCard}>
                <View style={styles.networkCardHeaderRow}>
                  <Text style={styles.networkCardTitle}>
                    Pings received ({pingsReceived.length})
                  </Text>
                  <Pressable onPress={clearPings}>
                    <Text style={styles.clearText}>Clear</Text>
                  </Pressable>
                </View>
                {pingsReceived.slice(-5).reverse().map((p) => (
                  <Text key={`${p.ts}-${p.seq}`} style={styles.pingItem}>
                    #{p.seq}/{p.total} from {p.sender}
                  </Text>
                ))}
              </View>
            )}

            <Text style={styles.devLabel}>Developer Tools</Text>
            <View style={styles.devRow}>
              <Pressable style={styles.devButton} onPress={sendFakeAlerts}>
                <Text style={styles.devButtonText}>Send fake alerts</Text>
              </Pressable>
              <Pressable
                style={[styles.devButton, pingSending && styles.devButtonActive]}
                onPress={sendPing}
                disabled={pingSending}
              >
                <Text style={styles.devButtonText}>
                  {pingSending ? `Pinging ${pingSent}/10…` : 'Ping (10x)'}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        )}
      </View>

      <View style={styles.tabBar}>
        {TABS.map((tab) => (
          <Pressable key={tab.key} style={styles.tabItem} onPress={() => setView(tab.key)}>
            <Text style={styles.tabIcon}>{tab.icon}</Text>
            <Text style={[styles.tabLabel, view === tab.key && styles.tabLabelActive]}>
              {tab.label}
            </Text>
            {view === tab.key && <View style={styles.tabIndicator} />}
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const C = {
  bg: '#0a0a14',
  surface: '#13131f',
  card: '#1a1a2e',
  border: '#1e1e30',
  accent: '#4a9eff',
  textPrimary: '#f0f0f8',
  textSecondary: '#8888aa',
  textMuted: '#4a4a6a',
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIcon: {
    fontSize: 28,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: C.textPrimary,
    letterSpacing: 0.3,
    lineHeight: 26,
  },
  subtitle: {
    fontSize: 11,
    color: C.textMuted,
    letterSpacing: 0.3,
    marginTop: 1,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillGreen: {
    backgroundColor: 'rgba(46,213,115,0.1)',
    borderColor: 'rgba(46,213,115,0.3)',
  },
  pillRed: {
    backgroundColor: 'rgba(255,71,87,0.1)',
    borderColor: 'rgba(255,71,87,0.3)',
  },
  headerStatus: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusTextGreen: { color: '#2ed573' },
  statusTextRed: { color: '#ff4757' },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotGreen: { backgroundColor: '#2ed573' },
  dotRed: { backgroundColor: '#ff4757' },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  pill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  pillText: {
    fontSize: 12,
    color: C.textSecondary,
  },
  content: {
    flex: 1,
  },
  alertList: {
    flex: 1,
  },
  alertListContent: {
    padding: 16,
    paddingBottom: 8,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 8,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: C.textSecondary,
  },
  emptySubtitle: {
    fontSize: 14,
    color: C.textMuted,
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 20,
  },
  alertCard: {
    backgroundColor: C.card,
    borderRadius: 10,
    marginBottom: 10,
    padding: 14,
    borderLeftWidth: 4,
  },
  alertCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  alertIcon: {
    fontSize: 22,
    lineHeight: 26,
  },
  alertCardMid: {
    flex: 1,
  },
  alertTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textPrimary,
    marginBottom: 2,
  },
  alertLocation: {
    fontSize: 12,
    color: C.textSecondary,
  },
  severityBadge: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  severityText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  alertCardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  alertSource: {
    fontSize: 11,
    color: C.textMuted,
  },
  alertTime: {
    fontSize: 11,
    color: C.textMuted,
  },
  mapToolbar: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  themeToggle: {
    paddingVertical: 5,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  themeToggleActive: {
    borderColor: C.accent,
    backgroundColor: 'rgba(74,158,255,0.12)',
  },
  themeToggleText: {
    fontSize: 12,
    color: C.textSecondary,
  },
  networkScroll: { flex: 1 },
  networkContent: { padding: 16, paddingBottom: 24 },
  networkCard: {
    backgroundColor: C.card,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  networkCardTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: C.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  networkCardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  networkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  networkValue: {
    fontSize: 15,
    fontWeight: '500',
    color: C.textPrimary,
  },
  networkSubtext: {
    fontSize: 12,
    color: C.textMuted,
    marginTop: 2,
  },
  bleDeviceItem: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 4,
    marginLeft: 4,
  },
  clearText: { fontSize: 12, color: C.textMuted },
  pingItem: { fontSize: 12, color: C.textSecondary, marginTop: 4, marginLeft: 4 },
  devLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginTop: 4,
  },
  devRow: { flexDirection: 'row', gap: 10 },
  devButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: C.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
  },
  devButtonActive: { backgroundColor: '#0d1f0d', borderColor: '#2e5a2e' },
  devButtonText: { fontSize: 13, color: C.textSecondary },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingBottom: 4,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
    position: 'relative',
  },
  tabIcon: { fontSize: 20, marginBottom: 2 },
  tabLabel: { fontSize: 10, color: C.textMuted, letterSpacing: 0.3 },
  tabLabelActive: { color: C.accent, fontWeight: '600' },
  tabIndicator: {
    position: 'absolute',
    top: 0,
    width: 24,
    height: 2,
    backgroundColor: C.accent,
    borderRadius: 1,
  },
});
