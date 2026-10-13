const fs = require('fs');
const path = require('path');

class Database {
  constructor() {
    this.dataDir = path.join(__dirname, '../data');
    this.touristsFile = path.join(this.dataDir, 'tourists.csv');
    this.alertsFile = path.join(this.dataDir, 'alerts.csv');
    this.initFiles();
  }

  initFiles() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    if (!fs.existsSync(this.touristsFile)) {
      fs.writeFileSync(
        this.touristsFile,
        'TOURIST_ID,NAME,PASSPORT,PHONE,CHECKIN_DATE,CHECKOUT_DATE,ITINERARY,EMERGENCY_CONTACT,SAFETY_SCORE,STATUS\n'
      );
    }

    if (!fs.existsSync(this.alertsFile)) {
      fs.writeFileSync(
        this.alertsFile,
        'ALERT_ID,TOURIST_ID,TIMESTAMP,ALERT_TYPE,SEVERITY,LOCATION,DESCRIPTION,STATUS,DANGER_CATEGORY,DISTANCE_KM,PRIORITY,ASSIGNED_TO,ACTION_HISTORY\n'
      );
    } else {
      const contents = fs.readFileSync(this.alertsFile, 'utf-8');
      const lineBreak = contents.indexOf('\n');
      const header = lineBreak === -1 ? contents : contents.slice(0, lineBreak).replace(/\r$/, '');
      if (header && !header.includes('DANGER_CATEGORY')) {
        const rows = lineBreak === -1 ? '' : contents.slice(lineBreak + 1);
        fs.writeFileSync(this.alertsFile, `${header},DANGER_CATEGORY,DISTANCE_KM,PRIORITY,ASSIGNED_TO,ACTION_HISTORY\n${rows}`);
      } else if (header && !header.includes('ACTION_HISTORY')) {
        const rows = lineBreak === -1 ? '' : contents.slice(lineBreak + 1);
        const missingColumns = [];
        if (!header.includes('DISTANCE_KM')) missingColumns.push('DISTANCE_KM');
        if (!header.includes('PRIORITY')) missingColumns.push('PRIORITY');
        if (!header.includes('ASSIGNED_TO')) missingColumns.push('ASSIGNED_TO');
        missingColumns.push('ACTION_HISTORY');
        fs.writeFileSync(this.alertsFile, `${header},${missingColumns.join(',')}\n${rows}`);
      }
    }
  }

  csvEscape(value) {
    const stringValue = String(value ?? '');
    return /[",\n]/.test(stringValue)
      ? `"${stringValue.replace(/"/g, '""')}"`
      : stringValue;
  }

  parseCsvLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
        continue;
      }

      if (char === '\r') {
        continue;
      }

      current += char;
    }

    values.push(current);
    return values.map(value => value.replace(/^\s+|\s+$/g, ''));
  }

  saveTourist(tourist) {
    const row = [
      tourist.touristId,
      tourist.name,
      tourist.passport,
      tourist.phone,
      tourist.checkinDate,
      tourist.checkoutDate,
      tourist.itinerary,
      tourist.emergencyContact,
      tourist.safetyScore,
      tourist.status
    ].map(value => this.csvEscape(value)).join(',') + '\n';
    fs.appendFileSync(this.touristsFile, row);
  }

  saveAlert(alert) {
    const actionHistory = alert.actionHistory?.length
      ? alert.actionHistory
      : [{ action: 'CREATED', status: alert.status || 'ACTIVE', assignedTo: '', by: alert.simulated ? 'System (simulated)' : 'System', timestamp: alert.timestamp }];
    const row = [
      alert.alertId,
      alert.touristId,
      alert.timestamp,
      alert.alertType,
      alert.severity,
      alert.location,
      alert.description,
      alert.status,
      alert.dangerCategory || 'UNASSESSED',
      alert.distanceKm ?? '',
      alert.priority || alert.severity,
      alert.assignedTo || '',
      JSON.stringify(actionHistory)
    ].map(value => this.csvEscape(value)).join(',') + '\n';
    fs.appendFileSync(this.alertsFile, row);
  }

  updateTouristSafetyScore(touristId, safetyScore) {
    const tourists = this.getAllTourists();
    let updated = false;
    let changed = false;
    const rows = tourists.map(tourist => {
      if (tourist.touristId === touristId) {
        changed = String(tourist.safetyScore) !== String(safetyScore);
        tourist.safetyScore = safetyScore;
        updated = true;
      }

      return [
        tourist.touristId,
        tourist.name,
        tourist.passport,
        tourist.phone,
        tourist.checkinDate,
        tourist.checkoutDate,
        tourist.itinerary,
        tourist.emergencyContact,
        tourist.safetyScore,
        tourist.status
      ].map(value => this.csvEscape(value)).join(',');
    });

    if (updated && changed) {
      const header = 'TOURIST_ID,NAME,PASSPORT,PHONE,CHECKIN_DATE,CHECKOUT_DATE,ITINERARY,EMERGENCY_CONTACT,SAFETY_SCORE,STATUS';
      fs.writeFileSync(this.touristsFile, `${header}\n${rows.join('\n')}\n`);
    }

    return updated;
  }

  getTouristById(touristId) {
    return this.getAllTourists().find(tourist => tourist.touristId === touristId) || null;
  }

  updateAlertWorkflow(alertId, { status, assignedTo, by, timestamp = new Date().toISOString() }) {
    const alerts = this.getAllAlerts();
    const alert = alerts.find(item => item.alertId === alertId);
    if (!alert) return null;

    if (status) alert.status = status;
    if (assignedTo !== undefined) alert.assignedTo = assignedTo;
    alert.actionHistory.push({
      action: status || 'ASSIGNED',
      status: alert.status,
      assignedTo: alert.assignedTo || '',
      by,
      timestamp
    });

    const header = 'ALERT_ID,TOURIST_ID,TIMESTAMP,ALERT_TYPE,SEVERITY,LOCATION,DESCRIPTION,STATUS,DANGER_CATEGORY,DISTANCE_KM,PRIORITY,ASSIGNED_TO,ACTION_HISTORY';
    const rows = alerts.map(item => [
      item.alertId,
      item.touristId,
      item.timestamp,
      item.alertType,
      item.severity,
      item.location,
      item.description,
      item.status,
      item.dangerCategory,
      item.distanceKm ?? '',
      item.priority || item.severity,
      item.assignedTo || '',
      JSON.stringify(item.actionHistory || [])
    ].map(value => this.csvEscape(value)).join(','));
    fs.writeFileSync(this.alertsFile, `${header}\n${rows.join('\n')}${rows.length ? '\n' : ''}`);
    return alert;
  }

  getAllTourists() {
    const data = fs.readFileSync(this.touristsFile, 'utf-8');
    const lines = data.trim().split(/\r?\n/).slice(1);
    if (!lines[0]) return [];
    return lines.filter(line => line.trim()).map(line => {
      const parts = this.parseCsvLine(line);
      return {
        touristId: parts[0],
        name: parts[1],
        passport: parts[2],
        phone: parts[3],
        checkinDate: parts[4],
        checkoutDate: parts[5],
        itinerary: parts[6],
        emergencyContact: parts[7],
        safetyScore: parts[8],
        status: parts[9]
      };
    });
  }

  getAllAlerts() {
    const data = fs.readFileSync(this.alertsFile, 'utf-8');
    const lines = data.trim().split(/\r?\n/).slice(1);
    if (!lines[0]) return [];
    return lines.filter(line => line.trim()).map(line => {
      const parts = this.parseCsvLine(line);
      return {
        alertId: parts[0],
        touristId: parts[1],
        timestamp: parts[2],
        alertType: parts[3],
        severity: parts[4],
        location: parts[5],
        description: parts[6],
        status: parts[7],
        dangerCategory: parts[8] || 'UNASSESSED',
        distanceKm: parts[9] === '' || parts[9] === undefined ? null : Number(parts[9]),
        priority: parts[10] || parts[4],
        assignedTo: parts[11] || '',
        actionHistory: this.parseActionHistory(parts[12])
      };
    });
  }

  parseActionHistory(value) {
    if (!value) return [];
    try {
      const history = JSON.parse(value);
      return Array.isArray(history) ? history : [];
    } catch {
      return [];
    }
  }

  deleteAlert(alertId) {
    const alerts = this.getAllAlerts();
    const alert = alerts.find(item => item.alertId === alertId);
    if (!alert || alert.status !== 'RESOLVED') return false;

    const remainingAlerts = alerts.filter(item => item.alertId !== alertId);
    const header = 'ALERT_ID,TOURIST_ID,TIMESTAMP,ALERT_TYPE,SEVERITY,LOCATION,DESCRIPTION,STATUS,DANGER_CATEGORY,DISTANCE_KM,PRIORITY,ASSIGNED_TO,ACTION_HISTORY';
    const rows = remainingAlerts.map(item => [
      item.alertId,
      item.touristId,
      item.timestamp,
      item.alertType,
      item.severity,
      item.location,
      item.description,
      item.status,
      item.dangerCategory,
      item.distanceKm ?? '',
      item.priority || item.severity,
      item.assignedTo || '',
      JSON.stringify(item.actionHistory || [])
    ].map(value => this.csvEscape(value)).join(','));
    fs.writeFileSync(this.alertsFile, `${header}\n${rows.join('\n')}${rows.length ? '\n' : ''}`);
    return true;
  }

  // Clear all alerts
  clearAlerts() {
    fs.writeFileSync(
      this.alertsFile,
      'ALERT_ID,TOURIST_ID,TIMESTAMP,ALERT_TYPE,SEVERITY,LOCATION,DESCRIPTION,STATUS,DANGER_CATEGORY,DISTANCE_KM,PRIORITY,ASSIGNED_TO,ACTION_HISTORY\n'
    );
  }

  // Clear all tourists
  clearTourists() {
    fs.writeFileSync(
      this.touristsFile,
      'TOURIST_ID,NAME,PASSPORT,PHONE,CHECKIN_DATE,CHECKOUT_DATE,ITINERARY,EMERGENCY_CONTACT,SAFETY_SCORE,STATUS\n'
    );
  }
}

module.exports = Database;
