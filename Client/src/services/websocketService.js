/**
 * Persistent WebSocket used only to receive alerts from the server.
 * The server sends alerts over this connection; the client does not send.
 * (Client opens the connection to the server; once open, traffic is server → client only.)
 */

import { APP_CONFIG, WEBSOCKET_CONFIG } from '../config/constants.js';

const { PATH, RECONNECT_DELAY_MS } = WEBSOCKET_CONFIG;

function getWebSocketUrl(serverBaseUrl, deviceId = null) {
  const base = (serverBaseUrl || APP_CONFIG.CENTRAL_SERVER_URL || 'https://api.example.com').trim();
  const url = new URL(base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = url.pathname.replace(/\/?$/, '') + (PATH.startsWith('/') ? PATH : `/${PATH}`);
  if (deviceId) {
    url.searchParams.set('deviceId', deviceId);
  }
  return url.toString();
}

class WebSocketService {
  constructor() {
    this._ws = null;
    this._serverBaseUrl = null;
    this._deviceId = null;
    this._onAlert = null;
    this._reconnectTimeoutId = null;
    this._intentionalClose = false;
  }

  setOnAlert(callback) {
    this._onAlert = callback;
  }

  connect(serverBaseUrl, deviceId = null) {
    this._intentionalClose = false;
    this._serverBaseUrl = serverBaseUrl || APP_CONFIG.CENTRAL_SERVER_URL;
    this._deviceId = deviceId;

    const url = getWebSocketUrl(this._serverBaseUrl, deviceId);

    try {
      this._ws = new WebSocket(url);
    } catch (e) {
      console.warn('[WebSocketService] connect failed', e?.message);
      this._scheduleReconnect();
      return;
    }

    this._ws.onopen = () => {
      if (APP_CONFIG.DEBUG_MODE) {
        console.log('[WebSocketService] connected');
      }
    };

    // Receive-only: server sends alerts; client never sends on this socket.
    this._ws.onmessage = (event) => {
      try {
        const raw = event.data;
        if (typeof raw !== 'string') return;
        const payload = JSON.parse(raw);
        const alert = payload?.data ?? payload?.alert ?? (payload?.id ? payload : null);
        if (alert && this._onAlert) {
          this._onAlert(alert);
        }
      } catch (e) {
        console.warn('[WebSocketService] message parse error', e?.message);
      }
    };

    this._ws.onerror = (e) => {
      console.warn('[WebSocketService] error', e?.message ?? 'unknown');
    };

    this._ws.onclose = () => {
      this._ws = null;
      if (!this._intentionalClose) {
        this._scheduleReconnect();
      }
    };
  }

  _scheduleReconnect() {
    if (this._reconnectTimeoutId) return;
    this._reconnectTimeoutId = setTimeout(() => {
      this._reconnectTimeoutId = null;
      if (this._intentionalClose) return;
      if (APP_CONFIG.DEBUG_MODE) {
        console.log('[WebSocketService] reconnecting…');
      }
      this.connect(this._serverBaseUrl, this._deviceId);
    }, RECONNECT_DELAY_MS);
  }

  disconnect() {
    this._intentionalClose = true;
    if (this._reconnectTimeoutId) {
      clearTimeout(this._reconnectTimeoutId);
      this._reconnectTimeoutId = null;
    }
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._serverBaseUrl = null;
    this._deviceId = null;
  }

  isConnected() {
    return this._ws != null && this._ws.readyState === WebSocket.OPEN;
  }
}

export const websocketService = new WebSocketService();
