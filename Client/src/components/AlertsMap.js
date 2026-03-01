import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { alertService } from '../services/alertService';
import { MAP_CONFIG, STORAGE_LIMITS, SEVERITY_COLORS } from '../config/constants';

function hasValidCoords(alert) {
  const lat = alert?.lat ?? alert?.latitude;
  const lng = alert?.lng ?? alert?.longitude ?? alert?.long;
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !Number.isNaN(lat) &&
    !Number.isNaN(lng)
  );
}

function isActive(alert) {
  return alert?.active !== false;
}

function severityColor(severity) {
  if (!severity) return SEVERITY_COLORS.info;
  const key = String(severity).toLowerCase();
  if (SEVERITY_COLORS[key]) return SEVERITY_COLORS[key];
  const n = Number(severity);
  if (n >= 9) return SEVERITY_COLORS.critical;
  if (n >= 7) return SEVERITY_COLORS.high;
  if (n >= 4) return SEVERITY_COLORS.medium;
  return SEVERITY_COLORS.low;
}

function buildMapHTML(centerLat, centerLng, zoom, alerts, circleRadiusM, theme) {
  const points = (alerts || []).map((a) => ({
    lat: a.lat ?? a.latitude,
    lng: a.lng ?? a.longitude ?? a.long,
    title: a.title || a.type || 'Alert',
    desc: [a.city, a.state, a.country].filter(Boolean).join(', ') || a.description || '',
    color: severityColor(a.severity),
    severity: a.severity ? String(a.severity) : '',
  }));
  const pointsEscaped = JSON.stringify(points).replace(/</g, '\\u003c');
  const radius = circleRadiusM || 15000;
  const isDark = theme !== 'light';
  const tileUrl = isDark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  const bodyBg = isDark ? '#0a0a14' : '#f4f4f8';
  const popupBg = isDark ? '#1a1a2e' : '#ffffff';
  const popupBorder = isDark ? '#2e2e4e' : '#ddddee';
  const popupText = isDark ? '#f0f0f8' : '#111122';
  const popupSmall = isDark ? '#8888aa' : '#666688';

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
  <style>
    body { margin: 0; background: ${bodyBg}; }
    #map { width: 100%; height: 100vh; }
    .leaflet-popup-content-wrapper { background: ${popupBg}; color: ${popupText}; border: 1px solid ${popupBorder}; border-radius: 8px; }
    .leaflet-popup-tip { background: ${popupBg}; }
    .leaflet-popup-content b { color: ${popupText}; }
    .leaflet-popup-content small { color: ${popupSmall}; }
  </style>
</head>
<body>
  <div id="map"><\/div>
  <script>
    var center = [${centerLat}, ${centerLng}];
    var zoom = ${zoom};
    var points = ${pointsEscaped};
    var radiusM = ${radius};
    var map = L.map('map', { zoomControl: true }).setView(center, zoom);
    L.tileLayer('${tileUrl}', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(map);
    var bounds = null;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      var latlng = [p.lat, p.lng];
      var c = p.color || '#4a9eff';
      L.circle(latlng, { radius: radiusM, color: c, fillColor: c, fillOpacity: 0.12, weight: 1.5, opacity: 0.7 }).addTo(map);
      var dotIcon = L.divIcon({
        className: '',
        html: '<div style="width:12px;height:12px;border-radius:50%;background:' + c + ';border:2px solid rgba(255,255,255,0.6);box-shadow:0 0 8px ' + c + ';"><\/div>',
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });
      L.marker(latlng, { icon: dotIcon }).addTo(map)
        .bindPopup('<b>' + (p.title || 'Alert') + '<\/b>' + (p.desc ? '<br><small>' + p.desc + '<\/small>' : '') + (p.severity ? '<br><small style="color:' + c + '">' + p.severity + '<\/small>' : ''));
      if (!bounds) bounds = L.latLngBounds(latlng, latlng);
      else bounds.extend(latlng);
    }
    if (bounds && points.length > 0) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 12 });
  </script>
</body>
</html>`;
}

export default function AlertsMap({ alerts: alertsProp, style, theme = 'dark' }) {
  const [alerts, setAlerts] = useState(alertsProp ?? []);

  useEffect(() => {
    if (alertsProp != null) {
      setAlerts(alertsProp);
      return;
    }
    let mounted = true;
    async function load() {
      const list = await alertService.getLocalAlerts(STORAGE_LIMITS.MAX_LOCAL_ALERTS);
      if (mounted) setAlerts(list);
    }
    load();
    return () => { mounted = false; };
  }, [alertsProp]);

  const mapAlerts = alerts.filter((a) => isActive(a) && hasValidCoords(a));

  const alertsKey = mapAlerts.map((a) => `${a.lat ?? a.latitude},${a.lng ?? a.longitude ?? a.long}`).join('|');
  const html = useMemo(
    () =>
      buildMapHTML(
        MAP_CONFIG.DEFAULT_LATITUDE,
        MAP_CONFIG.DEFAULT_LONGITUDE,
        8,
        mapAlerts,
        MAP_CONFIG.ALERT_CIRCLE_RADIUS_M,
        theme
      ),
    [alertsKey, theme]
  );

  return (
    <View style={[styles.container, style]}>
      <WebView
        source={{ html }}
        style={styles.webview}
        scrollEnabled={true}
        bounces={false}
        javaScriptEnabled={true}
        originWhitelist={['*']}
        mixedContentMode="compatibility"
      />
      {mapAlerts.length === 0 && (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>No alerts with location yet</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: '#0a0a14',
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0a14',
    pointerEvents: 'none',
  },
  placeholderText: {
    color: '#4a4a6a',
    fontSize: 14,
  },
});
