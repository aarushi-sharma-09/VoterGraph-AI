// ─────────────────────────────────────────────────────────────────────────────
// src/routes/geoRoutes.js
// Geographic Reference Data Routes
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const {
  getStates,
  getDistricts,
  getConstituencies,
  getPollingStations,
} = require('../controllers/geoController');

const router = express.Router();

// Publicly accessible routes (no PII, safe for unauthenticated reference lookup)
router.get('/states', getStates);
router.get('/districts', getDistricts);
router.get('/constituencies', getConstituencies);
router.get('/polling-stations', getPollingStations);

module.exports = router;
