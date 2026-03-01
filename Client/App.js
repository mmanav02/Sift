import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  SafeAreaView,
  StatusBar,
  Modal,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
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
  MANUAL_POLL_HOURS,
  STORAGE_LIMITS,
} from './src/config/constants';
import { v4 as uuid } from 'uuid';
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
  { key: 'messages', label: 'Messages', icon: '💬' },
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
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [pingSending, setPingSending] = useState(false);
  const [pingSent, setPingSent] = useState(0);
  const [pingsReceived, setPingsReceived] = useState([]);
  const [refreshingFromServer, setRefreshingFromServer] = useState(false);
  const [pollError, setPollError] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const statsIntervalRef = useRef(null);
  const pingsReceivedRef = useRef([]);
  const chatMessageIdsRef = useRef(new Set());
  const senderIdentityRef = useRef(null);

  const refreshAlertsFromServer = useCallback(async () => {
    const serverUrl = (APP_CONFIG.CENTRAL_SERVER_URL || '').trim().toLowerCase();
    if (!serverUrl || serverUrl === PLACEHOLDER_SERVER_URL.toLowerCase() || serverUrl.includes('api.example.com')) {
      setPollError('No server configured');
      return;
    }
    setPollError(null);
    setRefreshingFromServer(true);
    try {
      const alerts = await apiService.fetchAlertsFromServer(MANUAL_POLL_HOURS);
      for (const alert of alerts) {
        await alertService.processAlert(alert, ALERT_SOURCE_SERVER);
      }
      const updated = await alertService.getLocalAlerts(20);
      setLocalAlerts(updated);
    } catch (e) {
      setPollError(e?.message || 'Fetch failed');
    } finally {
      setRefreshingFromServer(false);
    }
  }, []);

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

        const deviceId = await LocalStorageService.getDeviceId();
        const shortId = (deviceId || '').replace(/-/g, '').slice(0, 8);
        const advertiseName = `${BLE_CONFIG.DEVICE_NAME_PREFIX}-${shortId || 'local'}`;
        senderIdentityRef.current = advertiseName;
        const loadedChat = await LocalStorageService.getChatMessages(STORAGE_LIMITS.MAX_CHAT_MESSAGES);
        loadedChat.forEach((m) => chatMessageIdsRef.current.add(m.id));
        if (mounted) setChatMessages(loadedChat.reverse());

        bluetoothService.listenForAlerts(async (payload) => {
          try {
            const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
            if (data && data._type === 'chat') {
              await onChatMessage(data);
              return;
            }
            if (data && data._type === 'ping') {
              const entry = { seq: data.seq, total: data.total, sender: data.sender, ts: Date.now() };
              pingsReceivedRef.current = [...pingsReceivedRef.current.slice(-19), entry];
              if (mounted) setPingsReceived([...pingsReceivedRef.current]);
              return;
            }
            await alertService.processAlert(data, ALERT_SOURCE_BLUETOOTH);
          } catch (e) {
            console.warn('[App] BLE alert parse failed', e?.message);
          }
        });

        await blePeripheralService.start(advertiseName, async (data) => {
          try {
            if (data && data._type === 'chat') {
              await onChatMessage(data);
              return;
            }
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

  const onChatMessage = useCallback(async (data) => {
    if (!data || data._type !== 'chat' || !data.id) return;
    if (chatMessageIdsRef.current.has(data.id)) return;
    chatMessageIdsRef.current.add(data.id);
    const msg = {
      id: data.id,
      text: data.text || '',
      sender: data.sender || 'Unknown',
      ts: data.ts || Date.now(),
    };
    await LocalStorageService.appendChatMessage(msg);
    setChatMessages((prev) => [...prev, msg].sort((a, b) => a.ts - b.ts));
  }, []);

  const sendChatMessage = useCallback(async () => {
    const text = (chatInput || '').trim();
    if (!text) return;
    const devices = bluetoothService.getConnectedDevices();
    if (devices.length === 0) {
      Alert.alert('No peers', 'No BLE devices connected. Connect to peers to send messages.');
      return;
    }
    const sender = senderIdentityRef.current || BLE_CONFIG.DEVICE_NAME_PREFIX;
    const payload = {
      _type: 'chat',
      id: uuid(),
      text,
      sender,
      ts: Date.now(),
    };
    try {
      await bluetoothService.broadcastAlert(payload);
      const msg = { id: payload.id, text: payload.text, sender: payload.sender, ts: payload.ts };
      chatMessageIdsRef.current.add(msg.id);
      await LocalStorageService.appendChatMessage(msg);
      setChatMessages((prev) => [...prev, msg].sort((a, b) => a.ts - b.ts));
      setChatInput('');
    } catch (e) {
      console.warn('[App] sendChatMessage failed', e?.message);
      Alert.alert('Send failed', e?.message || 'Could not send message.');
    }
  }, [chatInput]);

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
          <>
            <ScrollView
              style={styles.alertList}
              contentContainerStyle={styles.alertListContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={refreshingFromServer}
                  onRefresh={refreshAlertsFromServer}
                />
              }
            >
            {pollError ? (
              <Text style={styles.pollErrorText} numberOfLines={1}>{pollError}</Text>
            ) : null}
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
                  <Pressable
                    key={alert.id || (alert.created_at || alert.timestamp) + alert.city}
                    style={[styles.alertCard, { borderLeftColor: color }]}
                    onPress={() => setSelectedAlert(alert)}
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
                  </Pressable>
                );
              })
            )}
            </ScrollView>
          </>
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

        {view === 'messages' && (
          <KeyboardAvoidingView
            style={styles.messagesContainer}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
          >
            <ScrollView
              style={styles.chatList}
              contentContainerStyle={styles.chatListContent}
              showsVerticalScrollIndicator={false}
            >
              {bleDevices.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyIcon}>💬</Text>
                  <Text style={styles.emptyTitle}>No peers connected</Text>
                  <Text style={styles.emptySubtitle}>
                    Messages from nearby devices will appear here. Connect via the Network tab.
                  </Text>
                </View>
              ) : chatMessages.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyIcon}>💬</Text>
                  <Text style={styles.emptyTitle}>No messages yet</Text>
                  <Text style={styles.emptySubtitle}>
                    Send a message below; replies from peers will show here.
                  </Text>
                </View>
              ) : (
                chatMessages.map((msg) => (
                  <View key={msg.id} style={styles.chatMessageCard}>
                    <View style={styles.chatMessageHeader}>
                      <Text style={styles.chatMessageSender}>{msg.sender}</Text>
                      <Text style={styles.chatMessageTime}>{formatTime(msg.ts)}</Text>
                    </View>
                    <Text style={styles.chatMessageText}>{msg.text}</Text>
                  </View>
                ))
              )}
            </ScrollView>
            <View style={styles.chatInputRow}>
              <TextInput
                style={styles.chatInput}
                placeholder="Type a message…"
                placeholderTextColor={C.textMuted}
                value={chatInput}
                onChangeText={setChatInput}
                multiline
                maxLength={500}
                editable
              />
              <Pressable
                style={[styles.chatSendButton, (!chatInput || !chatInput.trim()) && styles.chatSendButtonDisabled]}
                onPress={sendChatMessage}
                disabled={!chatInput || !chatInput.trim()}
              >
                <Text style={styles.chatSendButtonText}>Send</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        )}
      </View>

      {/* Alert Detail Modal */}
      <Modal
        visible={!!selectedAlert}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedAlert(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedAlert(null)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            {selectedAlert && (() => {
              const color = getSeverityColor(selectedAlert.severity);
              const icon = getAlertIcon(selectedAlert.type);
              const sevLabel = getSeverityLabel(selectedAlert.severity);
              return (
                <>
                  <View style={styles.modalHandle} />
                  <View style={[styles.modalHeader, { borderLeftColor: color, borderLeftWidth: 4 }]}>
                    <Text style={styles.modalIcon}>{icon}</Text>
                    <Text style={styles.modalTitle}>{selectedAlert.title || selectedAlert.type || 'Alert'}</Text>
                  </View>

                  <View style={styles.modalRow}>
                    <Text style={styles.modalLabel}>Severity</Text>
                    <Text style={[styles.modalBadge, { color, borderColor: color }]}>{sevLabel}</Text>
                  </View>
                  <View style={styles.modalRow}>
                    <Text style={styles.modalLabel}>Type</Text>
                    <Text style={styles.modalValue}>{selectedAlert.type || '—'}</Text>
                  </View>
                  <View style={styles.modalRow}>
                    <Text style={styles.modalLabel}>Source</Text>
                    <Text style={styles.modalValue}>{isFromServer(selectedAlert) ? '🌐 Server' : '📶 BLE'}</Text>
                  </View>
                  <View style={styles.modalRow}>
                    <Text style={styles.modalLabel}>Location</Text>
                    <Text style={styles.modalValue}>
                      {[selectedAlert.city, selectedAlert.state, selectedAlert.country].filter(Boolean).join(', ') || '—'}
                    </Text>
                  </View>
                  <View style={styles.modalRow}>
                    <Text style={styles.modalLabel}>Time</Text>
                    <Text style={styles.modalValue}>{formatTime(selectedAlert.created_at || selectedAlert.timestamp)}</Text>
                  </View>
                  {selectedAlert.description ? (
                    <View style={styles.modalDescBox}>
                      <Text style={styles.modalLabel}>Description</Text>
                      <Text style={styles.modalDesc}>{selectedAlert.description}</Text>
                    </View>
                  ) : null}

                  <Pressable
                    style={styles.modalMapBtn}
                    onPress={() => { setSelectedAlert(null); setView('map'); }}
                  >
                    <Text style={styles.modalMapBtnText}>🗺️ View on Map</Text>
                  </Pressable>
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

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
  pollErrorText: {
    fontSize: 12,
    color: '#ff6b6b',
    marginBottom: 8,
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
  messagesContainer: { flex: 1 },
  chatList: { flex: 1 },
  chatListContent: { padding: 16, paddingBottom: 12 },
  chatMessageCard: {
    backgroundColor: C.card,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  chatMessageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  chatMessageSender: {
    fontSize: 12,
    fontWeight: '600',
    color: C.accent,
  },
  chatMessageTime: {
    fontSize: 11,
    color: C.textMuted,
  },
  chatMessageText: {
    fontSize: 14,
    color: C.textPrimary,
    lineHeight: 20,
  },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    padding: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.surface,
  },
  chatInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: C.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: C.textPrimary,
  },
  chatSendButton: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    backgroundColor: C.accent,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatSendButtonDisabled: {
    backgroundColor: C.border,
    opacity: 0.7,
  },
  chatSendButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
    borderTopWidth: 1,
    borderColor: C.border,
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 10,
    marginBottom: 20,
  },
  modalIcon: { fontSize: 28 },
  modalTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: C.textPrimary,
    lineHeight: 22,
  },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  modalLabel: {
    fontSize: 12,
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontWeight: '600',
  },
  modalValue: {
    fontSize: 14,
    color: C.textPrimary,
    maxWidth: '60%',
    textAlign: 'right',
  },
  modalBadge: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  modalDescBox: {
    marginTop: 16,
    gap: 6,
  },
  modalDesc: {
    fontSize: 14,
    color: C.textSecondary,
    lineHeight: 20,
    marginTop: 6,
  },
  modalMapBtn: {
    marginTop: 24,
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalMapBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
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
