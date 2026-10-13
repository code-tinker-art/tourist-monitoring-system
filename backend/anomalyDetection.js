class AnomalyDetector {
  constructor() {
    this.locationHistory = new Map();
    this.INACTIVITY_THRESHOLD = 30 * 60 * 1000; // 30 minutes
    this.HIGH_RISK_ZONES = [
      { name: 'Remote Forest Area', lat: 25.5, lng: 91.8, radius: 5 },
      { name: 'Restricted Border Zone', lat: 25.6, lng: 91.9, radius: 3 }
    ];
    this.RISK_THRESHOLDS = { criticalKm: 3, highKm: 10, mediumKm: 25 };
  }

  configure(config) {
    this.HIGH_RISK_ZONES = config.zones.map(zone => ({ ...zone }));
    this.RISK_THRESHOLDS = { ...config.thresholds };
  }

  calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  calculateSafetyScore(distanceKm) {
    const { criticalKm, highKm, mediumKm } = this.RISK_THRESHOLDS;
    if (!Number.isFinite(distanceKm) || distanceKm > mediumKm) return 100;
    if (distanceKm <= criticalKm) return Math.round(35 + (distanceKm / criticalKm) * 25);
    if (distanceKm <= highKm) return Math.round(60 + ((distanceKm - criticalKm) / (highKm - criticalKm)) * 20);
    return Math.round(80 + ((distanceKm - highKm) / (mediumKm - highKm)) * 20);
  }

  getSafetyAssessment(distanceKm, zoneName) {
    const { criticalKm, highKm, mediumKm } = this.RISK_THRESHOLDS;
    const safetyScore = this.calculateSafetyScore(distanceKm);
    let proximityBand = 'OUTSIDE MONITORED RANGE';
    if (Number.isFinite(distanceKm) && distanceKm <= criticalKm) proximityBand = 'CRITICAL PROXIMITY';
    else if (Number.isFinite(distanceKm) && distanceKm <= highKm) proximityBand = 'HIGH PROXIMITY';
    else if (Number.isFinite(distanceKm) && distanceKm <= mediumKm) proximityBand = 'MEDIUM PROXIMITY';

    return {
      safetyScore,
      scoreFactors: {
        estimateOnly: true,
        nearestRiskZone: zoneName || 'No configured zone',
        distanceToZoneEdgeKm: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(2)) : null,
        proximityBand,
        explanation: Number.isFinite(distanceKm)
          ? `${proximityBand.toLowerCase()} to ${zoneName || 'the nearest configured risk zone'} (${distanceKm.toFixed(1)} km from its boundary); prototype distance-only estimate.`
          : 'No location assessment is available; this prototype score is based only on proximity to configured risk zones.'
      }
    };
  }

  checkInactivity(touristId, lastUpdate) {
    const now = Date.now();
    const timeDiff = now - lastUpdate;
    
    if (timeDiff > this.INACTIVITY_THRESHOLD) {
      return {
        anomaly: true,
        type: 'PROLONGED_INACTIVITY',
        severity: 'HIGH',
        description: `No activity for ${Math.floor(timeDiff / 60000)} minutes`
      };
    }
    return { anomaly: false };
  }

  checkHighRiskZone(lat, lng) {
    const nearestZone = this.HIGH_RISK_ZONES
      .map(zone => ({
        ...zone,
        distanceKm: Math.max(0, this.calculateDistance(lat, lng, zone.lat, zone.lng) - zone.radius)
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm)[0];

    const { criticalKm, highKm, mediumKm } = this.RISK_THRESHOLDS;
    if (!nearestZone || nearestZone.distanceKm > mediumKm) {
      return {
        anomaly: false,
        distanceKm: nearestZone?.distanceKm ?? null,
        zoneName: nearestZone?.name ?? null
      };
    }

    const dangerCategory = nearestZone.distanceKm <= criticalKm
      ? 'CRITICAL'
      : nearestZone.distanceKm <= highKm
        ? 'HIGH'
        : 'MEDIUM';

    return {
      anomaly: true,
      type: 'DANGER_PROXIMITY',
      severity: dangerCategory,
      dangerCategory,
      distanceKm: Number(nearestZone.distanceKm.toFixed(2)),
      zoneName: nearestZone.name,
      description: `${dangerCategory} proximity: ${nearestZone.distanceKm.toFixed(1)} km from ${nearestZone.name}`
    };
  }

  checkRouteDeviation(touristId, currentLat, currentLng, plannedRoute) {
    // Simplified: check if current location is far from planned route
    if (!plannedRoute || plannedRoute.length === 0) return { anomaly: false };
    
    let minDistance = Infinity;
    plannedRoute.forEach(point => {
      const dist = this.calculateDistance(currentLat, currentLng, point.lat, point.lng);
      if (dist < minDistance) minDistance = dist;
    });

    if (minDistance > 10) { // 10km deviation
      return {
        anomaly: true,
        type: 'ROUTE_DEVIATION',
        severity: 'MEDIUM',
        description: `Deviated ${minDistance.toFixed(1)}km from planned route`
      };
    }
    return { anomaly: false };
  }

  analyze(touristId, locationData, plannedRoute) {
    const { lat, lng, timestamp } = locationData;
    
    // Check for inactivity
    const inactivityCheck = this.checkInactivity(touristId, timestamp);
    if (inactivityCheck.anomaly) return inactivityCheck;

    // Check configured high-risk zones and assign a category by distance.
    const zoneCheck = this.checkHighRiskZone(lat, lng);
    if (zoneCheck.anomaly) return zoneCheck;

    // Check route deviation
    const deviationCheck = this.checkRouteDeviation(touristId, lat, lng, plannedRoute);
    if (deviationCheck.anomaly) return deviationCheck;

    return { anomaly: false };
  }
}

module.exports = AnomalyDetector;
