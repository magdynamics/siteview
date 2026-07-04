const express = require('express');
const router = express.Router();
const { db } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');

// Daily weather capture per site (technical guideline §10.4) — schedule
// variance explanations for lenders/owners. Uses Open-Meteo (free, keyless),
// captured by the daily cron and on demand. One doc per site per day.

const WEATHER_CODES = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Violent rain showers',
  85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Thunderstorm w/ hail',
};

async function captureSiteWeather(site) {
  // coordinates may be missing, or stored as empty strings on older site docs
  const lat = parseFloat(site.latitude), lng = parseFloat(site.longitude);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  const today = new Date().toISOString().split('T')[0];
  const docId = `${site.id}_${today}`;
  const existing = await db.collection('weather_logs').doc(docId).get();
  if (existing.exists) return existing.data();

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json();
  const d = data.daily;

  const log = {
    id: docId,
    siteId: site.id,
    date: today,
    tempMaxF: d.temperature_2m_max?.[0] ?? null,
    tempMinF: d.temperature_2m_min?.[0] ?? null,
    precipitationIn: d.precipitation_sum?.[0] ?? null,
    windMaxMph: d.wind_speed_10m_max?.[0] ?? null,
    weatherCode: d.weather_code?.[0] ?? null,
    conditions: WEATHER_CODES[d.weather_code?.[0]] || 'Unknown',
    capturedAt: new Date().toISOString(),
  };
  await db.collection('weather_logs').doc(docId).set(log);
  return log;
}

async function captureAllSites() {
  const sitesSnap = await db.collection('sites').where('isActive', '==', true).get();
  const results = [];
  for (const doc of sitesSnap.docs) {
    try {
      const log = await captureSiteWeather(doc.data());
      if (log) results.push(log);
    } catch (e) { console.error('[Weather]', doc.data().name, e.message); }
  }
  return results;
}

router.get('/', authenticate, async (req, res) => {
  try {
    const { siteId } = req.query;
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    if (!siteId) return res.status(400).json({ error: 'siteId is required' });
    const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
    const snap = await db.collection('weather_logs')
      .where('siteId', '==', siteId)
      .get();
    const logs = snap.docs.map(d => d.data()).filter(l => l.date >= since)
      .sort((a, b) => b.date.localeCompare(a.date));
    res.json(logs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/capture', authenticate, authorize('supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const logs = await captureAllSites();
    res.json({ message: `Weather captured for ${logs.length} site(s)`, logs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = { router, captureAllSites };
