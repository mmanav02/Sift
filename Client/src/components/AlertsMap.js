/**
 * Map showing alert locations as pins and circles.
 * Uses WebView + Leaflet (no native maps module) so it builds on RN 0.76.
 * Requires network for tile loading unless MAP_TILE_PATH is set to local tiles.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { alertService } from '../services/alertService';
import { MAP_CONFIG, STORAGE_LIMITS } from '../config/constants';

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

function buildMapHTML(centerLat, centerLng, zoom, alerts, circleRadiusM) {
  const points = (alerts || []).map((a) => ({
    lat: a.lat ?? a.latitude,
    lng: a.lng ?? a.longitude ?? a.long,
    title: a.title || a.type || 'Alert',
    desc: a.description || a.city || '',
  }));
  const pointsEscaped = JSON.stringify(points).replace(/</g, '\\u003c');
  const radius = circleRadiusM || 1000;

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
  <style>
    body { margin: 0; background: #1a1a2e; }
    #map { width: 100%; height: 100vh; }
  </style>
</head>
<body>
  <div id="map"><\/div>
  <script>
    var center = [${centerLat}, ${centerLng}];
    var zoom = ${zoom};
    var points = ${pointsEscaped};
    var radiusM = ${radius};
    var map = L.map('map').setView(center, zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    var bounds = null;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      var latlng = [p.lat, p.lng];
      L.circle(latlng, { radius: radiusM, color: 'rgba(200,80,80,0.6)', fillColor: 'rgba(200,80,80,0.15)', fillOpacity: 1, weight: 2 }).addTo(map);
      L.marker(latlng).addTo(map).bindPopup('<b>' + (p.title || 'Alert') + '<\/b><br>' + (p.desc || ''));
      if (!bounds) bounds = L.latLngBounds(latlng, latlng);
      else bounds.extend(latlng);
    }
    if (bounds && points.length > 0) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
  </script>
</body>
</html>`;
}

export default function AlertsMap({ alerts: alertsProp, style }) {
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
        MAP_CONFIG.ALERT_CIRCLE_RADIUS_M
      ),
    [alertsKey]
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
    backgroundColor: '#1a1a2e',
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    pointerEvents: 'none',
  },
  placeholderText: {
    color: '#888',
    fontSize: 14,
  },
});
