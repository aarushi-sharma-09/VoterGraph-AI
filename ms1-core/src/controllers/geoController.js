// ─────────────────────────────────────────────────────────────────────────────
// src/controllers/geoController.js
// Geographic reference data lookup
//
// These endpoints power cascading dropdowns (State → District → Constituency → Polling Station).
// Uses node-cache to avoid querying PostgreSQL for static data on every keystroke.
// ─────────────────────────────────────────────────────────────────────────────
const NodeCache = require('node-cache');
const prisma = require('../lib/prisma');

// Cache with 10-minute TTL (600 seconds)
const geoCache = new NodeCache({ stdTTL: 600 });

const getStates = async (req, res) => {
  try {
    let states = geoCache.get('states');
    if (!states) {
      states = await prisma.state.findMany({ orderBy: { name: 'asc' } });
      geoCache.set('states', states);
    }
    return res.status(200).json({ states });
  } catch (err) {
    console.error('[geoController] getStates error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Could not fetch states.' });
  }
};

const getDistricts = async (req, res) => {
  const { stateId } = req.query;
  if (!stateId) {
    return res.status(400).json({ error: 'ValidationError', message: 'stateId query parameter is required.' });
  }

  try {
    const cacheKey = `districts_${stateId}`;
    let districts = geoCache.get(cacheKey);
    if (!districts) {
      districts = await prisma.district.findMany({
        where: { stateId },
        orderBy: { name: 'asc' },
      });
      geoCache.set(cacheKey, districts);
    }
    return res.status(200).json({ districts });
  } catch (err) {
    console.error('[geoController] getDistricts error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Could not fetch districts.' });
  }
};

const getConstituencies = async (req, res) => {
  const { districtId } = req.query;
  if (!districtId) {
    return res.status(400).json({ error: 'ValidationError', message: 'districtId query parameter is required.' });
  }

  try {
    const cacheKey = `constituencies_${districtId}`;
    let constituencies = geoCache.get(cacheKey);
    if (!constituencies) {
      constituencies = await prisma.constituency.findMany({
        where: { districtId },
        orderBy: { name: 'asc' },
      });
      geoCache.set(cacheKey, constituencies);
    }
    return res.status(200).json({ constituencies });
  } catch (err) {
    console.error('[geoController] getConstituencies error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Could not fetch constituencies.' });
  }
};

const getPollingStations = async (req, res) => {
  const { constituencyId } = req.query;
  if (!constituencyId) {
    return res.status(400).json({ error: 'ValidationError', message: 'constituencyId query parameter is required.' });
  }

  try {
    const cacheKey = `polling_stations_${constituencyId}`;
    let pollingStations = geoCache.get(cacheKey);
    if (!pollingStations) {
      pollingStations = await prisma.pollingStation.findMany({
        where: { constituencyId },
        orderBy: { name: 'asc' },
      });
      geoCache.set(cacheKey, pollingStations);
    }
    return res.status(200).json({ pollingStations });
  } catch (err) {
    console.error('[geoController] getPollingStations error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Could not fetch polling stations.' });
  }
};

module.exports = {
  getStates,
  getDistricts,
  getConstituencies,
  getPollingStations,
};
