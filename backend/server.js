const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const TouristBlockchain = require('./blockchain');
const Database = require('./database');
const AnomalyDetector = require('./anomalyDetection');

const PORT = Number(process.env.PORT || 3000);
const WS_PORT = Number(process.env.WS_PORT || 3001);

// Initialize systems
const blockchain = new TouristBlockchain();
const db = new Database();
const anomalyDetector = new AnomalyDetector();
const activeTourists = new Map();
const alertCooldowns = new Map();
const riskConfigFile = path.join(__dirname, '../data/risk-config.json');
const DEFAULT_RISK_CONFIG = {
  thresholds: { criticalKm: 3, highKm: 10, mediumKm: 25 },
  staleAfterMinutes: 5,
  zones: [
    { name: 'Remote Forest Area', lat: 25.5, lng: 91.8, radius: 5 },
    { name: 'Restricted Border Zone', lat: 25.6, lng: 91.9, radius: 3 }
  ]
};

function loadRiskConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(riskConfigFile, 'utf8'));
    return validateRiskConfig({ ...DEFAULT_RISK_CONFIG, ...saved });
  } catch {
    fs.mkdirSync(path.dirname(riskConfigFile), { recursive: true });
    fs.writeFileSync(riskConfigFile, `${JSON.stringify(DEFAULT_RISK_CONFIG, null, 2)}\n`);
    return DEFAULT_RISK_CONFIG;
  }
}

function validateRiskConfig(config) {
  const { criticalKm, highKm, mediumKm } = config.thresholds || {};
  if (![criticalKm, highKm, mediumKm].every(Number.isFinite) || criticalKm <= 0 || criticalKm >= highKm || highKm >= mediumKm || mediumKm > 500) {
    throw new Error('Thresholds must be ascending positive distances (critical < high < medium, max 500 km).');
  }
  if (!Number.isFinite(config.staleAfterMinutes) || config.staleAfterMinutes < 1 || config.staleAfterMinutes > 1440) {
    throw new Error('Stale threshold must be between 1 and 1440 minutes.');
  }
  if (!Array.isArray(config.zones) || config.zones.length > 100 || config.zones.some(zone =>
    typeof zone.name !== 'string' || !zone.name.trim() || zone.name.length > 80 ||
    !Number.isFinite(Number(zone.lat)) || Number(zone.lat) < -90 || Number(zone.lat) > 90 ||
    !Number.isFinite(Number(zone.lng)) || Number(zone.lng) < -180 || Number(zone.lng) > 180 ||
    !Number.isFinite(Number(zone.radius)) || Number(zone.radius) <= 0 || Number(zone.radius) > 500
  )) {
    throw new Error('Each risk zone needs a name, valid latitude/longitude, and radius from 0 to 500 km.');
  }
  return {
    thresholds: { criticalKm: Number(criticalKm), highKm: Number(highKm), mediumKm: Number(mediumKm) },
    staleAfterMinutes: Number(config.staleAfterMinutes),
    zones: config.zones.map(zone => ({ ...zone, name: zone.name.trim(), lat: Number(zone.lat), lng: Number(zone.lng), radius: Number(zone.radius) }))
  };
}

let riskConfig = loadRiskConfig();
anomalyDetector.configure(riskConfig);

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function maskValue(value) {
  const text = String(value || '');
  if (text.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(text.length - 4, 12))}${text.slice(-4)}`;
}

// WebSocket server for real-time updates
const wss = new WebSocket.Server({ port: WS_PORT });
const clients = new Set();

wss.on('error', (error) => {
  console.error('WebSocket server error:', error.message);
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${WS_PORT} is already in use. Close the previous instance or run the startup script again.`);
  }
});

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('Dashboard connected');

  ws.on('close', () => clients.delete(ws));
});

const DEBUG_MODE = true; // Set to false in production
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

function log(message, print=DEBUG_MODE) {
  if (print) {
    console.log(message);
  }
}

function broadcastToClients(data) {
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// HTTP Server
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const data = body ? JSON.parse(body) : {};
      const requestUrl = new URL(req.url, 'http://localhost');
      const requestPath = requestUrl.pathname;

      if (req.method === 'POST' && requestPath === '/api/risk-config') {
        riskConfig = validateRiskConfig(data);
        fs.writeFileSync(riskConfigFile, `${JSON.stringify(riskConfig, null, 2)}\n`);
        anomalyDetector.configure(riskConfig);
        broadcastToClients({ type: 'RISK_CONFIG_UPDATED', data: riskConfig });
        sendJson(res, 200, { success: true, config: riskConfig });
        return;
      }

      if (req.method === 'GET' && requestPath === '/api/risk-config') {
        sendJson(res, 200, riskConfig);
        return;
      }

      const alertDeleteMatch = requestPath.match(/^\/api\/alerts\/([^/]+)$/);
      if (req.method === 'DELETE' && alertDeleteMatch) {
        const alertId = decodeURIComponent(alertDeleteMatch[1]);
        const alert = db.getAllAlerts().find(item => item.alertId === alertId);
        if (!alert) {
          sendJson(res, 404, { success: false, error: 'Alert not found.' });
          return;
        }
        if (alert.status !== 'RESOLVED') {
          sendJson(res, 409, { success: false, error: 'Only resolved alerts can be deleted.' });
          return;
        }
        db.deleteAlert(alertId);
        broadcastToClients({ type: 'ALERT_DELETED', alertId });
        sendJson(res, 200, { success: true, alertId });
        return;
      }

      const alertWorkflowMatch = requestPath.match(/^\/api\/alerts\/([^/]+)\/workflow$/);
      if (req.method === 'POST' && alertWorkflowMatch) {
        const status = data.status;
        const assignedTo = data.assignedTo === undefined ? undefined : String(data.assignedTo).trim();
        if (status !== undefined && !['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED'].includes(status)) {
          sendJson(res, 400, { success: false, error: 'Status must be ACTIVE, ACKNOWLEDGED, or RESOLVED.' });
          return;
        }
        if (status === undefined && assignedTo === undefined) {
          sendJson(res, 400, { success: false, error: 'Provide a status update or assignee.' });
          return;
        }
        if (assignedTo !== undefined && !assignedTo) {
          sendJson(res, 400, { success: false, error: 'Assignee cannot be empty.' });
          return;
        }
        if (assignedTo !== undefined && assignedTo.length > 80) {
          sendJson(res, 400, { success: false, error: 'Assignee must be 80 characters or fewer.' });
          return;
        }
        const alert = db.updateAlertWorkflow(decodeURIComponent(alertWorkflowMatch[1]), {
          status,
          assignedTo,
          by: 'Operator'
        });
        if (!alert) {
          sendJson(res, 404, { success: false, error: 'Alert not found.' });
          return;
        }
        broadcastToClients({ type: 'ALERT_WORKFLOW_UPDATED', data: alert });
        sendJson(res, 200, { success: true, alert });
        return;
      }

      // ---------------- Register tourist ----------------
      if (req.method === 'POST' && requestPath === '/api/register') {
        const touristId = `T_${Date.now()}`;
        const tourist = {
          touristId,
          name: data.name,
          passport: data.passport,
          phone: data.phone,
          checkinDate: data.checkinDate,
          checkoutDate: data.checkoutDate,
          itinerary: data.itinerary,
          emergencyContact: data.emergencyContact,
          safetyScore: '',
          status: 'ACTIVE'
        };
        blockchain.addBlock(tourist);
        db.saveTourist(tourist);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, touristId, safetyScore: tourist.safetyScore, message: 'Tourist registered successfully' }));
        return;
      }

      // ---------------- Update location ----------------
      if (req.method === 'POST' && requestPath === '/api/location') {
        const { touristId, lat, lng, timestamp } = data;
        const ts = timestamp || Date.now();
        const simulated = data.simulated === true;

        const dangerAssessment = anomalyDetector.checkHighRiskZone(lat, lng);
        const scoreAssessment = anomalyDetector.getSafetyAssessment(dangerAssessment.distanceKm, dangerAssessment.zoneName);
        const { safetyScore, scoreFactors } = scoreAssessment;
        activeTourists.set(touristId, { lat, lng, timestamp: ts, simulated, safetyScore, scoreFactors });
        db.updateTouristSafetyScore(touristId, safetyScore);

        const anomaly = anomalyDetector.analyze(touristId, { lat, lng, timestamp: ts }, []);
        let alertCreated = false;
        if (anomaly.anomaly) {
          const cooldownKey = `${touristId}:${anomaly.type}:${anomaly.dangerCategory || anomaly.severity}`;
          const lastAlertAt = alertCooldowns.get(cooldownKey) || 0;
          if (Date.now() - lastAlertAt >= ALERT_COOLDOWN_MS) {
            const alert = {
              alertId: `A_${Date.now()}`,
              touristId,
              timestamp: new Date().toISOString(),
              alertType: anomaly.type,
              severity: anomaly.severity,
              dangerCategory: dangerAssessment.dangerCategory || 'UNASSESSED',
              priority: anomaly.severity,
              distanceKm: dangerAssessment.distanceKm,
              location: `${lat},${lng}`,
              description: simulated ? `[SIMULATED] ${anomaly.description}` : anomaly.description,
              simulated,
              status: 'ACTIVE'
            };
            alertCooldowns.set(cooldownKey, Date.now());
            db.saveAlert(alert);
            broadcastToClients({ type: 'ALERT', data: alert });
            alertCreated = true;
          }
        }

        broadcastToClients({
          type: 'LOCATION_UPDATE',
          data: {
            touristId,
            lat,
            lng,
            timestamp: ts,
            safetyScore,
            scoreFactors,
            simulated,
            dangerCategory: dangerAssessment.dangerCategory || null,
            distanceKm: dangerAssessment.distanceKm
          }
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          anomaly: anomaly.anomaly,
          alertCreated,
          safetyScore,
          scoreFactors,
          dangerCategory: dangerAssessment.dangerCategory || null,
          distanceKm: dangerAssessment.distanceKm
        }));
        return;
      }

      // ---------------- Panic button ----------------
      if (req.method === 'POST' && requestPath === '/api/panic') {
        const simulated = data.simulated === true;
        const panicDangerAssessment = anomalyDetector.checkHighRiskZone(Number(data.lat), Number(data.lng));
        const alert = {
          alertId: `A_${Date.now()}`,
          touristId: data.touristId,
          timestamp: new Date().toISOString(),
          alertType: 'PANIC_BUTTON',
          severity: 'CRITICAL',
          dangerCategory: panicDangerAssessment.dangerCategory || 'UNASSESSED',
          priority: 'CRITICAL',
          distanceKm: panicDangerAssessment.distanceKm,
          location: `${data.lat},${data.lng}`,
          description: simulated ? '[SIMULATED] Emergency panic button activated' : 'Emergency panic button activated',
          simulated,
          status: 'ACTIVE'
        };
        const scoreFactors = {
          estimateOnly: true,
          nearestRiskZone: panicDangerAssessment.zoneName || 'No configured zone',
          distanceToZoneEdgeKm: Number.isFinite(panicDangerAssessment.distanceKm) ? panicDangerAssessment.distanceKm : null,
          proximityBand: panicDangerAssessment.dangerCategory || 'UNASSESSED',
          explanation: 'Emergency alert submitted; prototype score is temporarily set to 35 pending operator assessment.'
        };
        activeTourists.set(data.touristId, {
          ...(activeTourists.get(data.touristId) || {}),
          lat: Number(data.lat),
          lng: Number(data.lng),
          timestamp: Date.now(),
          simulated,
          safetyScore: 35,
          scoreFactors
        });
        db.updateTouristSafetyScore(data.touristId, 35);
        db.saveAlert(alert);
        broadcastToClients({ type: 'PANIC_ALERT', data: alert });
        broadcastToClients({ type: 'LOCATION_UPDATE', data: { touristId: data.touristId, lat: Number(data.lat), lng: Number(data.lng), timestamp: Date.now(), safetyScore: 35, scoreFactors, simulated } });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, safetyScore: 35, scoreFactors, message: 'Emergency alert sent' }));
        return;
      }

      // ---------------- Clear alerts ----------------
      // Clear alerts
      if (req.method === 'POST' && requestPath === '/api/clearAlerts') {
          db.clearAlerts(); // clears alerts.csv
          broadcastToClients({ type: 'ALERTS_CLEARED' });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'All alerts cleared' }));
          return;
      }

      // Clear active tourists
      if (req.method === 'POST' && requestPath === '/api/clearActive') {
          activeTourists.clear(); // clears in-memory active tourists
          broadcastToClients({ type: 'ACTIVE_TOURISTS_CLEARED' });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'All active tourists cleared' }));
          return;
      }

      // Clear all tourists (optional)
      if (req.method === 'POST' && requestPath === '/api/clearTourists') {
          db.clearTourists();
          activeTourists.clear();
          broadcastToClients({ type: 'TOURISTS_CLEARED' });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'All tourists cleared' }));
          return;
      }


      // ---------------- GET requests ----------------
      if (req.method === 'GET') {
        if (requestPath === '/api/tourists') {
          const tourists = db.getAllTourists().map(tourist => {
            const latest = activeTourists.get(tourist.touristId);
            return {
              touristId: tourist.touristId,
              name: tourist.name,
              passport: maskValue(tourist.passport),
              phone: maskValue(tourist.phone),
              emergencyContact: maskValue(tourist.emergencyContact),
              checkinDate: tourist.checkinDate,
              checkoutDate: tourist.checkoutDate,
              itinerary: 'Restricted — use Reveal details',
              safetyScore: tourist.safetyScore,
              scoreFactors: latest?.scoreFactors || null,
              status: tourist.status
            };
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(tourists));
          return;
        }

        if (requestPath === '/api/alerts') {
          const alerts = db.getAllAlerts();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(alerts));
          return;
        }

        if (requestPath === '/api/locations') {
          const locations = Array.from(activeTourists.entries()).map(([id, data]) => ({ touristId: id, ...data }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(locations));
          return;
        }
      }

      // ---------------- 404 fallback ----------------
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));

    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: error.message }));
    }
  });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the previous Node process and try again.`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, () => {
  console.log(`✅ HTTP Server running on http://localhost:${PORT}`);
  console.log(`✅ WebSocket Server running on ws://localhost:${WS_PORT}`);
  console.log(`✅ Blockchain validated: ${blockchain.validateChain()}`);
});
