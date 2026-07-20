// ─────────────────────────────────────────────────────────────────────────────
// src/routes/chatRoutes.js
// Chat Route Definitions
// All routes here are protected by authMiddleware (JWT required)
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { processChat, getSessions, getSessionById, getQueueJobStatus, resumeChat, renameSession } = require('../controllers/chatController');

const router = express.Router();

// All chat routes require a valid JWT
router.use(authMiddleware);

// POST /api/chat → Send a message; starts or continues a session
router.post('/', processChat);

// GET /api/chat/sessions → List all past sessions for the logged-in user
router.get('/sessions', getSessions);

// GET /api/chat/sessions/:sessionId → Load a specific session's full history
router.get('/sessions/:sessionId', getSessionById);

// PATCH /api/chat/sessions/:sessionId → Rename a specific session
router.patch('/sessions/:sessionId', renameSession);

// GET /api/chat/queue/:jobId → Poll status of a queued chat job
router.get('/queue/:jobId', getQueueJobStatus);

// POST /api/chat/resume → Resume an ambiguous chat
router.post('/resume', resumeChat);

module.exports = router;
