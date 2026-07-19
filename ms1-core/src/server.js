// ─────────────────────────────────────────────────────────────────────────────
// src/server.js
// Express Application Entry Point
//
// Responsibilities:
//   - Load environment variables
//   - Initialize Express with global middleware (CORS, JSON body parser)
//   - Mount route files
//   - Start the HTTP server
//   - Graceful shutdown on SIGTERM/SIGINT (important for Docker)
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();

const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/authRoutes');
const chatRoutes = require('./routes/chatRoutes');
const geoRoutes = require('./routes/geoRoutes');
const searchRoutes = require('./routes/searchRoutes');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Global Middleware ─────────────────────────────────────────────────────────

// CORS: Allow requests from the React dev server and production domain
app.use(cors({
  origin: [
    'http://localhost:5173', // Vite React dev server
    'http://localhost:3000', // Alternative React port
    process.env.FRONTEND_URL, // Production domain (e.g. https://votergraph.in)
  ].filter(Boolean),
  credentials: true, // Allow cookies/auth headers
}));

// Parse incoming JSON bodies (limit prevents oversized payload attacks)
app.use(express.json({ limit: '1mb' }));

// ── Health Check ──────────────────────────────────────────────────────────────
// Used by Docker healthcheck, NGINX, and CI/CD pipeline to verify the server
// is alive without touching any database or external service.
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'ms1-core',
    timestamp: new Date().toISOString(),
  });
});

// ── Route Mounts ──────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/geo', geoRoutes);
app.use('/api/search', searchRoutes);

// ── 404 Catch-All ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'NotFound', message: 'Route does not exist.' });
});

// ── Global Error Handler ──────────────────────────────────────────────────────
// Catches any unhandled errors thrown in route handlers or middleware
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({
    error: 'InternalServerError',
    message: 'An unexpected error occurred.',
  });
});

const { startWorker } = require('./workers/chatQueueWorker');

// ── Start Server ──────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n🚀 ms1-core running on http://localhost:${PORT}`);
  console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Database    : ${process.env.DATABASE_URL ? '✅ connected' : '⚠️  DATABASE_URL not set'}`);
  console.log(`   ms2-agent   : ${process.env.MS2_URL || 'http://localhost:8000 (default)'}`);
  console.log(`   CORS origin : ${process.env.FRONTEND_URL || 'localhost (dev)'}\n`);
  
  // Start the background queue worker
  startWorker();
});

// ── Graceful Shutdown ─────────────────────────────────────────────────────────
// Required so Docker can stop the container cleanly without killing connections
const shutdown = (signal) => {
  console.log(`\n[server] ${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log('[server] HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
