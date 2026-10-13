const getRuntimeConfig = () => {
  const localApi = "https://qhmqmh-ip-59-98-39-192.tunnelmole.net" + "/api"; // Change this to your backend API URL if different
  const localWs = "https://5prjzg-ip-59-98-39-192.tunnelmole.net"; // Change this to your backend WebSocket URL if different

  return {
    api: localApi,
    ws: localWs
  };
};

const { api: API_URL, ws: WS_BASE_URL } = getRuntimeConfig();
const WS_URL = WS_BASE_URL.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
let ws;
let map;
let alertMarker;
let activeLocationMarkers = [];
let cachedAlerts = [];
let visibleAlerts = [];
let cachedTourists = [];
let cachedLocations = [];
let riskZoneLayers = [];
let riskConfig = null;
let selectedAlertId = null;

async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

async function refreshDashboard() {
  await Promise.all([loadTourists(), loadAlerts(), updateLocationsList()]);
}

// ---------------- WebSocket ----------------
function connectWebSocket() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setConnectionStatus('Connected', true);
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'ALERT' || message.type === 'PANIC_ALERT') {
      loadAlerts();
      loadTourists();
      playAlertSound();
    } else if (message.type === 'LOCATION_UPDATE') {
      updateLocationsList();
      loadTourists();
    } else if (message.type === 'ALERTS_CLEARED') {
      loadAlerts();
    } else if (message.type === 'ACTIVE_TOURISTS_CLEARED') {
      loadTourists();
      updateLocationsList();
    } else if (message.type === 'TOURISTS_CLEARED') {
      loadTourists();
    } else if (message.type === 'ALERT_WORKFLOW_UPDATED') {
      loadAlerts();
    } else if (message.type === 'ALERT_DELETED') {
      if (message.alertId === selectedAlertId) closeAlertDetails();
      loadAlerts();
    } else if (message.type === 'RISK_CONFIG_UPDATED') {
      loadRiskConfig();
    }
  };

  ws.onerror = (error) => {
    setConnectionStatus('Connection issue', false);
    console.error('WebSocket error:', error);
  };
  ws.onclose = () => {
    setConnectionStatus('Reconnecting', false);
    setTimeout(connectWebSocket, 3000);
  };
}

function setConnectionStatus(label, isConnected) {
  document.getElementById('connectionStatus').textContent = label;
  const indicator = document.getElementById('statusIndicator');
  indicator.classList.toggle('is-connected', isConnected);
  indicator.classList.toggle('is-disconnected', !isConnected);
}

function updateSystemClock() {
  const clock = document.getElementById('systemClock');
  const now = new Date();
  clock.dateTime = now.toISOString();
  clock.textContent = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(now);
}

document.getElementById('closeAlertDetails').addEventListener('click', () => {
  closeAlertDetails();
});

function closeAlertDetails() {
  document.getElementById('alertDetailPanel').classList.add('hidden');
  document.querySelector('.map-layout').classList.remove('has-selection');
  selectedAlertId = null;
}

document.getElementById('mapDisclosure').addEventListener('toggle', event => {
  if (!event.currentTarget.open) return;
  if (!map) initializeMap();
  renderRiskZones();
  renderLocations();
  window.setTimeout(() => map?.invalidateSize(), 100);
});

document.getElementById('riskConfigForm').addEventListener('submit', saveRiskConfig);
document.getElementById('visitorSearch').addEventListener('input', renderTourists);
['alertFilterPriority', 'alertFilterDanger', 'alertFilterStatus', 'alertFilterTime'].forEach(id => {
  document.getElementById(id).addEventListener('change', renderAlerts);
});

async function loadRiskConfig() {
  try {
    riskConfig = await apiRequest('/risk-config');
    document.getElementById('criticalThreshold').value = riskConfig.thresholds.criticalKm;
    document.getElementById('highThreshold').value = riskConfig.thresholds.highKm;
    document.getElementById('mediumThreshold').value = riskConfig.thresholds.mediumKm;
    document.getElementById('staleAfterMinutes').value = riskConfig.staleAfterMinutes;
    document.getElementById('riskZonesJson').value = JSON.stringify(riskConfig.zones, null, 2);
    const { criticalKm, highKm, mediumKm } = riskConfig.thresholds;
    document.getElementById('riskThresholdNote').textContent = `Distance from nearest configured zone edge: Critical ≤ ${criticalKm} km · High ≤ ${highKm} km · Medium ≤ ${mediumKm} km.`;
    document.getElementById('staleThresholdNote').textContent = `Positions older than ${riskConfig.staleAfterMinutes} minutes are marked stale.`;
    document.getElementById('mapFreshnessNote').textContent = `Stale after ${riskConfig.staleAfterMinutes} min`;
    renderLocations();
    renderRiskZones();
  } catch (error) {
    document.getElementById('riskConfigStatus').textContent = error.message;
  }
}

async function saveRiskConfig(event) {
  event.preventDefault();
  const status = document.getElementById('riskConfigStatus');
  try {
    const zones = JSON.parse(document.getElementById('riskZonesJson').value);
    const result = await apiRequest('/risk-config', {
      method: 'POST',
      body: JSON.stringify({
        zones,
        thresholds: {
          criticalKm: Number(document.getElementById('criticalThreshold').value),
          highKm: Number(document.getElementById('highThreshold').value),
          mediumKm: Number(document.getElementById('mediumThreshold').value)
        },
        staleAfterMinutes: Number(document.getElementById('staleAfterMinutes').value)
      })
    });
    riskConfig = result.config;
    status.textContent = 'Risk settings saved.';
    await loadRiskConfig();
  } catch (error) {
    status.textContent = error.message.includes('JSON') ? 'Risk zones must be valid JSON.' : error.message;
  }
}

function renderRiskZones() {
  if (!map || !riskConfig || !window.L) return;
  riskZoneLayers.forEach(layer => layer.remove());
  riskZoneLayers = riskConfig.zones.map(zone => L.circle([zone.lat, zone.lng], {
    radius: zone.radius * 1000,
    color: '#d77d75',
    weight: 1,
    fillColor: '#a94e52',
    fillOpacity: 0.09
  }).addTo(map).bindPopup(escapeHTML(`${zone.name} · ${zone.radius} km radius`)));
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function initializeMap() {
  const mapStatus = document.getElementById('mapStatus');
  if (!window.L) {
    mapStatus.textContent = 'Interactive map is unavailable. Select an alert to open its coordinates in OpenStreetMap.';
    return;
  }

  const worldBounds = L.latLngBounds([-85.051129, -180], [85.051129, 180]);
  map = L.map('alertMap', {
    maxBounds: worldBounds,
    maxBoundsViscosity: 1,
    worldCopyJump: false
  }).setView([25.5, 91.8], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    noWrap: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
  }).addTo(map);
  mapStatus.innerHTML = 'Map data © OpenStreetMap contributors. Select an alert to view its reported coordinates.';
}

function getAlertCoordinates(alert) {
  const explicitLat = Number(alert.lat);
  const explicitLng = Number(alert.lng);
  if (Number.isFinite(explicitLat) && Number.isFinite(explicitLng) && alert.lat !== undefined && alert.lng !== undefined) {
    return { lat: explicitLat, lng: explicitLng };
  }

  const match = String(alert.location || '').match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) return null;
  return { lat: Number(match[1]), lng: Number(match[2]) };
}

function selectAlert(index) {
  const alert = visibleAlerts[index];
  if (!alert) return;

  document.querySelectorAll('.alert-select').forEach((item, itemIndex) => {
    item.classList.toggle('is-selected', itemIndex === index);
  });

  selectedAlertId = alert.alertId;
  const simulated = String(alert.description || '').startsWith('[SIMULATED]');
  const label = `${simulated ? 'SIMULATED · ' : ''}${alert.alertType.replace(/_/g, ' ')} · ${alert.touristId}`;
  document.getElementById('mapSelection').textContent = label;
  const mapDisclosure = document.getElementById('mapDisclosure');
  mapDisclosure.open = true;
  if (!map) initializeMap();
  renderAlertDetails(alert);
  const coordinates = getAlertCoordinates(alert);
  const mapStatus = document.getElementById('mapStatus');

  if (!coordinates || coordinates.lat < -90 || coordinates.lat > 90 || coordinates.lng < -180 || coordinates.lng > 180) {
    mapStatus.textContent = 'This alert does not contain valid map coordinates.';
    document.getElementById('alertDetailContent').insertAdjacentHTML('beforeend', '<p>Coordinates are unavailable for this alert.</p>');
    return;
  }

  const dangerCategory = alert.dangerCategory || 'UNASSESSED';
  const priority = alert.priority || alert.severity;
  const distance = alert.distanceKm === null || alert.distanceKm === '' || alert.distanceKm === undefined
    ? NaN
    : Number(alert.distanceKm);
  const distanceLabel = Number.isFinite(distance) ? ` · ${distance.toFixed(1)} km from risk-zone edge` : '';
  const popupText = `${simulated ? 'SIMULATED · ' : ''}${priority} priority / ${dangerCategory} proximity: ${coordinates.lat.toFixed(5)}, ${coordinates.lng.toFixed(5)}${distanceLabel}`;

  if (map) {
    if (alertMarker) alertMarker.remove();
    alertMarker = L.marker([coordinates.lat, coordinates.lng]).addTo(map);
    alertMarker.bindPopup(escapeHTML(popupText)).openPopup();
    window.setTimeout(() => {
      map.invalidateSize();
      map.setView([coordinates.lat, coordinates.lng], Math.max(map.getZoom(), 13), { animate: true });
      alertMarker.openPopup();
    }, 120);
    mapStatus.textContent = `Showing ${priority} priority / ${dangerCategory} proximity alert coordinates.${distanceLabel}`;
  } else {
    const link = `https://www.openstreetmap.org/?mlat=${coordinates.lat}&mlon=${coordinates.lng}#map=13/${coordinates.lat}/${coordinates.lng}`;
    mapStatus.innerHTML = `Coordinates: ${coordinates.lat.toFixed(5)}, ${coordinates.lng.toFixed(5)} · <a href="${link}" target="_blank" rel="noopener noreferrer">Open in OpenStreetMap</a>`;
  }

  document.getElementById('mapSection').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderAlertDetails(alert) {
  const panel = document.getElementById('alertDetailPanel');
  const layout = document.querySelector('.map-layout');
  panel.classList.remove('hidden');
  layout.classList.add('has-selection');
  const position = getAlertCoordinates(alert);
  const dangerCategory = alert.dangerCategory || 'UNASSESSED';
  const description = String(alert.description || '').replace(/^\[SIMULATED\]\s*/, '');

  document.getElementById('alertDetailTitle').textContent = String(alert.alertType || 'Alert').replace(/_/g, ' ');
  document.getElementById('alertDetailContent').innerHTML = `
    <div><strong>Visitor:</strong> ${escapeHTML(alert.touristId)}</div>
    <div><strong>Priority:</strong> ${escapeHTML(alert.priority || alert.severity)}</div>
    <div><strong>Danger category:</strong> ${escapeHTML(dangerCategory)}</div>
    <div><strong>Reported:</strong> ${escapeHTML(new Date(alert.timestamp).toLocaleString())}</div>
    <div><strong>Coordinates:</strong> ${position ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}` : 'Unavailable'}</div>
    <div><strong>Distance to risk-zone edge:</strong> ${alert.distanceKm === null || alert.distanceKm === '' || alert.distanceKm === undefined ? 'Not assessed' : `${escapeHTML(alert.distanceKm)} km`}</div>
    <div><strong>Response status:</strong> <span id="detailAlertStatus">${escapeHTML(alert.status)}</span></div>
    <div><strong>Description:</strong> ${escapeHTML(description)}</div>
    ${String(alert.description || '').startsWith('[SIMULATED]') ? '<div class="simulation-label">SIMULATED DATA</div>' : ''}
  `;
  document.getElementById('resolveAlertBtn').disabled = alert.status === 'RESOLVED';
  document.getElementById('deleteAlertBtn').disabled = alert.status !== 'RESOLVED';
  document.getElementById('resolveAlertBtn').onclick = () => updateAlertWorkflow(alert, { status: 'RESOLVED' });
  document.getElementById('deleteAlertBtn').onclick = () => deleteAlert(alert);
}

async function updateAlertWorkflow(alert, changes) {
  try {
    await apiRequest(`/alerts/${encodeURIComponent(alert.alertId)}/workflow`, {
      method: 'POST',
      body: JSON.stringify(changes)
    });
    await loadAlerts();
    const updated = cachedAlerts.find(item => item.alertId === alert.alertId);
    if (updated) {
      const index = visibleAlerts.findIndex(item => item.alertId === updated.alertId);
      if (index >= 0) selectAlert(index);
    }
  } catch (error) {
    window.alert(error.message);
  }
}

async function deleteAlert(alert) {
  if (alert.status !== 'RESOLVED' || !window.confirm('Delete this resolved alert? This cannot be undone.')) return;
  try {
    await apiRequest(`/alerts/${encodeURIComponent(alert.alertId)}`, { method: 'DELETE' });
    closeAlertDetails();
    await loadAlerts();
  } catch (error) {
    window.alert(error.message);
  }
}

// ---------------- Alert Sound ----------------
function playAlertSound() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  const audioContext = new AudioContextClass();
  const oscillator = audioContext.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
  oscillator.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.2);
}

// ---------------- Tourists ----------------
async function loadTourists() {
  try {
    cachedTourists = await apiRequest('/tourists');
    renderTourists();
  } catch (err) {
    console.error('Error loading tourists:', err);
  }
}

function renderTourists() {
  const container = document.getElementById('touristsList');
  const query = document.getElementById('visitorSearch').value.trim().toLowerCase();
  document.getElementById('totalRegistered').textContent = cachedTourists.length;
  document.getElementById('totalTourists').textContent = cachedTourists.filter(t => new Date(t.checkoutDate) >= new Date()).length;
  const tourists = cachedTourists.filter(t => `${t.name} ${t.touristId}`.toLowerCase().includes(query));

  if (!tourists.length) {
    container.innerHTML = `<p class="no-data">${cachedTourists.length ? 'No visitors match this search.' : 'No visitors registered.'}</p>`;
    return;
  }

  container.innerHTML = tourists.map(t => `
    <article class="tourist-item">
      <div class="alert-header">
        <span class="alert-type">${escapeHTML(t.name)}</span>
        <span class="severity-badge status-active">${escapeHTML(t.status)}</span>
      </div>
      <div class="tourist-details">
        <div>ID: ${escapeHTML(t.touristId)}</div>
        <div>Passport: ${escapeHTML(t.passport)}</div>
        <div>Phone: ${escapeHTML(t.phone)}</div>
        <div>Emergency contact: ${escapeHTML(t.emergencyContact)}</div>
        <div>Safety score: ${t.safetyScore === '' || t.safetyScore === null ? 'Pending' : `${escapeHTML(t.safetyScore)}/100`}</div>
        <div>Check-out: ${escapeHTML(t.checkoutDate)}</div>
      </div>
      <details class="nested-foldout score-explanation">
        <summary>Score basis <span class="prototype-label">PROTOTYPE</span></summary>
        <p>${escapeHTML(t.scoreFactors?.explanation || 'Awaiting a current location assessment. This is a prototype estimate, not a validated safety assessment.')}</p>
      </details>
    </article>
  `).join('');
}

// ---------------- Alerts ----------------
async function loadAlerts() {
  try {
    cachedAlerts = await apiRequest('/alerts');
    cachedAlerts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const activeAlerts = cachedAlerts.filter(a => a.status === 'ACTIVE' || a.status === 'ACKNOWLEDGED');
    const criticalAlerts = cachedAlerts.filter(a => (a.priority || a.severity) === 'CRITICAL' && a.status !== 'RESOLVED');

    document.getElementById('activeAlerts').textContent = activeAlerts.length;
    document.getElementById('criticalAlerts').textContent = criticalAlerts.length;
    renderAlerts();
  } catch (err) {
    console.error('Error loading alerts:', err);
  }
}

function renderAlerts() {
  const container = document.getElementById('alertsList');
  const priorityFilter = document.getElementById('alertFilterPriority').value;
  const dangerFilter = document.getElementById('alertFilterDanger').value;
  const statusFilter = document.getElementById('alertFilterStatus').value;
  const hours = Number(document.getElementById('alertFilterTime').value);
  const cutoff = hours ? Date.now() - hours * 60 * 60 * 1000 : 0;
  visibleAlerts = cachedAlerts.filter(alert => {
    const priority = alert.priority || alert.severity;
    const category = alert.dangerCategory || 'UNASSESSED';
    return (priorityFilter === 'ALL' || priority === priorityFilter) &&
      (dangerFilter === 'ALL' || category === dangerFilter) &&
      (statusFilter === 'ALL' || alert.status === statusFilter) &&
      (!cutoff || new Date(alert.timestamp).getTime() >= cutoff);
  });
  document.getElementById('filterCount').textContent = visibleAlerts.length === cachedAlerts.length
    ? `${cachedAlerts.length} total`
    : `${visibleAlerts.length} of ${cachedAlerts.length}`;

  if (!visibleAlerts.length) {
    container.innerHTML = `<p class="no-data">${cachedAlerts.length ? 'No alerts match these filters.' : 'No alerts recorded.'}</p>`;
    return;
  }

  container.innerHTML = visibleAlerts.map((a, index) => `
      <button type="button" class="alert-item alert-select ${escapeHTML(String(a.priority || a.severity).toLowerCase())}" data-alert-index="${index}" aria-label="Show ${escapeHTML(a.priority || a.severity)} priority alert on the map">
        <div class="alert-header">
          <span class="alert-type">${escapeHTML(String(a.alertType).replace(/_/g, ' '))}</span>
          <span class="severity-badge severity-${escapeHTML(String(a.priority || a.severity).toLowerCase())}">${escapeHTML(a.priority || a.severity)} priority</span>
        </div>
        <div class="alert-details">
          ${String(a.description || '').startsWith('[SIMULATED]') ? '<div class="simulation-label">SIMULATED DATA</div>' : ''}
          <span class="alert-workflow-status">${escapeHTML(a.status)} · ${escapeHTML(a.dangerCategory || 'UNASSESSED')} proximity</span>
          <div class="timestamp">Time: ${escapeHTML(new Date(a.timestamp).toLocaleString())}</div>
        </div>
      </button>
    `).join('');

  container.querySelectorAll('.alert-select').forEach(button => {
    button.addEventListener('click', () => selectAlert(Number(button.dataset.alertIndex)));
  });

  if (selectedAlertId) {
    const selected = visibleAlerts.find(alert => alert.alertId === selectedAlertId);
    if (selected) renderAlertDetails(selected);
  }
}

// ---------------- Locations ----------------
async function updateLocationsList() {
  try {
    cachedLocations = await apiRequest('/locations');
    renderLocations();
  } catch (err) {
    console.error('Error loading locations:', err);
  }
}

function renderLocations() {
    const container = document.getElementById('locationsList');
    activeLocationMarkers.forEach(marker => marker.remove());
    activeLocationMarkers = [];

    if (!cachedLocations.length) {
      container.innerHTML = '<p class="no-data">No active locations</p>';
      return;
    }

    const staleAfterMs = (riskConfig?.staleAfterMinutes || 5) * 60 * 1000;
    container.innerHTML = cachedLocations.map(loc => {
      const updatedAt = new Date(loc.timestamp).getTime();
      const ageMs = Number.isFinite(updatedAt) ? Math.max(0, Date.now() - updatedAt) : Infinity;
      const isStale = ageMs > staleAfterMs;
      const ageText = Number.isFinite(ageMs) ? ageMs < 60000 ? 'Updated just now' : `Updated ${Math.floor(ageMs / 60000)} min ago` : 'Update time unavailable';
      return `
      <div class="location-item ${isStale ? 'stale-location' : ''}">
        <div class="alert-header">
          <span class="alert-type">${escapeHTML(loc.touristId)}</span>
          <span class="severity-badge ${loc.simulated ? 'status-simulated' : isStale ? 'status-stale' : 'status-active'}">${loc.simulated ? 'SIMULATED' : isStale ? 'STALE' : 'LIVE'}</span>
        </div>
        <div class="location-details">
          <div>Latitude: ${Number(loc.lat).toFixed(6)}</div>
          <div>Longitude: ${Number(loc.lng).toFixed(6)}</div>
          <div class="freshness-badge ${isStale ? 'stale' : ''}">${ageText}</div>
        </div>
      </div>
      `;
    }).join('');

    if (map) {
      cachedLocations.forEach(loc => {
        const lat = Number(loc.lat);
        const lng = Number(loc.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const updatedAt = new Date(loc.timestamp).getTime();
        const isStale = !Number.isFinite(updatedAt) || Date.now() - updatedAt > staleAfterMs;
        const marker = L.circleMarker([lat, lng], {
          radius: 6,
          color: loc.simulated ? '#e5ae5b' : isStale ? '#8993a0' : '#74c4a4',
          weight: 2,
          fillColor: loc.simulated ? '#9b7131' : isStale ? '#565e68' : '#2d8a6c',
          fillOpacity: 0.85
        }).addTo(map);
        marker.bindPopup(escapeHTML(`${loc.simulated ? 'SIMULATED location' : isStale ? 'STALE location' : 'Live visitor'}: ${loc.touristId}`));
        activeLocationMarkers.push(marker);
      });
    }
}

// ---------------- Reset Dashboard ----------------
document.getElementById('resetDashboardBtn').addEventListener('click', async () => {
  const btn = document.getElementById('resetDashboardBtn');
  if (!window.confirm('Clear active locations and all alert records? This cannot be undone.')) return;
  btn.disabled = true;

  try {
    await Promise.all([
      apiRequest('/clearActive', { method: 'POST' }),
      apiRequest('/clearAlerts', { method: 'POST' })
    ]);

    await refreshDashboard();
  } catch (err) {
    console.error('Error clearing dashboard:', err);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('resetregister').addEventListener('click', async () => {
  if (!window.confirm('Permanently clear every visitor record, location and alert? This cannot be undone.')) return;
  try {
    await Promise.all([
      apiRequest('/clearActive', { method: 'POST' }),
      apiRequest('/clearAlerts', { method: 'POST' }),
      apiRequest('/clearTourists', { method: 'POST' })
    ]);
    selectedAlertId = null;
    await refreshDashboard();
  } catch (error) {
    window.alert(error.message);
  }
});

// ---------------- Auto Refresh ----------------
setInterval(() => {
  refreshDashboard();
}, 10000);
setInterval(renderLocations, 15000);

// ---------------- Initialize ----------------
updateSystemClock();
setInterval(updateSystemClock, 1000);
refreshDashboard();
connectWebSocket();
loadRiskConfig();
