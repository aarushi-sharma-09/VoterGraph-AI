// ─────────────────────────────────────────────────────────────────────────────
// src/controllers/chatController.js
// Chat Proxy & Session Persistence Logic
//
// Architecture (post Feature 1-4 implementation):
//
//   processChat()      — HTTP handler. Validates, finds/creates session,
//                        persists user Message, checks concurrency gate,
//                        calls runMs2Query() or enqueues a ChatQueueJob.
//
//   runMs2Query()      — Shared core logic. Calls ms2-agent, persists both
//                        Message rows (user already inserted, assistant here),
//                        returns the response shape. Used by BOTH the sync
//                        processChat path AND the chatQueueWorker — they must
//                        never diverge.
//
//   getSessionById()   — Returns session + cursor-paginated messages.
//   getSessions()      — Lists session titles for sidebar.
//   getQueueJobStatus()— Polls a queued job by ID.
//
// NOTE: activeMs2Requests is an IN-PROCESS counter. This concurrency gate
// only works correctly with a SINGLE ms1 instance. If ms1 is ever scaled
// horizontally, replace this counter with:
//   SELECT COUNT(*) FROM chat_queue_jobs WHERE status = 'PROCESSING'
// ─────────────────────────────────────────────────────────────────────────────
const axios  = require('axios');
const prisma = require('../lib/prisma');

const MS2_URL = process.env.MS2_URL || 'http://localhost:8000';
const MAX_CONCURRENT_MS2 = Number(process.env.MAX_CONCURRENT_MS2 || 3);

// ── Concurrency gate ──────────────────────────────────────────────────────────
let activeMs2Requests = 0;

// Export for use by chatQueueWorker
const getActiveMs2Requests    = () => activeMs2Requests;
const incrementActiveRequests = () => { activeMs2Requests++; };
const decrementActiveRequests = () => { activeMs2Requests--; };


// ── Shared core: call ms2, persist assistant Message, return response shape ───
//
// Called from BOTH processChat (synchronous path) and chatQueueWorker.
// Does NOT insert the user message — caller is responsible for that first.
// Returns a plain object matching the frontend's expected response shape.
//
const runMs2Query = async (sessionId, userId, message, pollingStationId, constituencyId) => {
  console.log(`[chatService] 📤 Forwarding to ms2: "${message.slice(0, 50)}..." (station: ${pollingStationId || 'none'})`);

  // Feature 4 (LangGraph native memory):
  // No history is sent. The LangGraph Postgres checkpointer persists context
  // across turns natively via thread_id = session_id. The messages table is
  // purely a display/audit log, fully decoupled from what the agent reasons over.
  const response = await axios.post(
    `${MS2_URL}/agent/query`,
    {
      message:            message.trim(),
      session_id:         sessionId,
      user_id:            userId,
      polling_station_id: pollingStationId || null,
      constituency_id:    constituencyId || null,
      // history intentionally omitted — LangGraph state handles multi-turn memory
    },
    {
      timeout: 120000, // Increased to 120s for Gemini cold-starts
      headers: { 'Content-Type': 'application/json' },
    }
  );

  const agentResponse = response.data;

  // Persist assistant reply as a Message row
  await prisma.message.create({
    data: {
      sessionId,
      role:       'assistant',
      content:    agentResponse.answer,
      cypherQuery: agentResponse.cypher_query || null,
      graphNodes:  agentResponse.graph_nodes  || null,
    },
  });

  console.log(`[chatService] ✅ Assistant message saved to session: ${sessionId}`);

  return {
    sessionId,
    reply:               agentResponse.answer,
    cypher_query:        agentResponse.cypher_query        || null,
    graph_nodes:         agentResponse.graph_nodes         || null,
    needs_clarification: agentResponse.needs_clarification || false,
    clarification_prompt: agentResponse.clarification_prompt || null,
    clarification_options: agentResponse.clarification_options || null,
  };
};



const runMs2Resume = async (sessionId, clarificationAnswer) => {
  const response = await axios.post(
    `${MS2_URL}/agent/query/resume`,
    { session_id: sessionId, clarification_answer: clarificationAnswer },
    { timeout: 120000, headers: { 'Content-Type': 'application/json' } }
  );
  
  const agentResponse = response.data;

  // Persist assistant reply as a Message row
  await prisma.message.create({
    data: {
      sessionId,
      role:       'assistant',
      content:    agentResponse.answer,
      cypherQuery: agentResponse.cypher_query || null,
      graphNodes:  agentResponse.graph_nodes  || null,
    },
  });

  return {
    sessionId,
    reply:               agentResponse.answer,
    cypher_query:        agentResponse.cypher_query        || null,
    graph_nodes:         agentResponse.graph_nodes         || null,
    needs_clarification: agentResponse.needs_clarification || false,
    clarification_prompt: agentResponse.clarification_prompt || null,
    clarification_options: agentResponse.clarification_options || null,
  };
};

const resumeChat = async (req, res) => {
  const { sessionId, clarificationAnswer } = req.body;
  if (!sessionId || !clarificationAnswer) {
    return res.status(400).json({ error: 'ValidationError', message: 'Missing sessionId or clarificationAnswer' });
  }

  try {
    // Persist user's clarification answer
    await prisma.message.create({
      data: { sessionId, role: 'user', content: clarificationAnswer },
    });

    activeMs2Requests++;
    try {
      const result = await runMs2Resume(sessionId, clarificationAnswer);
      return res.status(200).json(result);
    } catch (axiosErr) {
      const ms2Status = axiosErr.response?.status || 'NO_RESPONSE';
      const ms2Error  = axiosErr.response?.data   || axiosErr.message;
      return res.status(503).json({ error: 'AgentUnavailable', ms2_status: ms2Status, ms2_detail: ms2Error });
    } finally {
      activeMs2Requests--;
    }
  } catch (err) {
    return res.status(500).json({ error: 'InternalServerError' });
  }
};

// ── POST /api/chat ────────────────────────────────────────────────────────────
const processChat = async (req, res) => {
  const { message, sessionId, pollingStationId, constituencyId } = req.body;
  const { userId, email } = req.user;

  if (!message || message.trim() === '') {
    return res.status(400).json({
      error:   'ValidationError',
      message: 'Message cannot be empty.',
    });
  }

  if (!pollingStationId && !constituencyId) {
    return res.status(400).json({
      error:   'ValidationError',
      message: 'A Constituency or Polling Station must be selected to scope the search.',
    });
  }

  try {
    // ── Step 1: Find or create session ────────────────────────────────────────
    let session;

    if (sessionId) {
      session = await prisma.session.findFirst({ where: { id: sessionId, userId } });
      if (!session) {
        return res.status(404).json({
          error:   'NotFound',
          message: 'Session not found or does not belong to this user.',
        });
      }
    } else {
      session = await prisma.session.create({
        data: { userId, title: message.slice(0, 60) },
      });
      console.log(`[chatController] 🆕 New session: ${session.id} for user: ${email}`);
    }

    // ── Step 2: Persist user message immediately ───────────────────────────────
    await prisma.message.create({
      data: { sessionId: session.id, role: 'user', content: message.trim() },
    });

    // ── Step 3: Concurrency gate ───────────────────────────────────────────────
    if (activeMs2Requests >= MAX_CONCURRENT_MS2) {
      const job = await prisma.chatQueueJob.create({
        data: {
          sessionId: session.id,
          userId,
          message:   message.trim(),
          status:    'PENDING',
          pollingStationId: pollingStationId || null,
        },
      });

      // Count jobs ahead of this one in the queue
      const position = await prisma.chatQueueJob.count({
        where: { status: 'PENDING', createdAt: { lt: job.createdAt } },
      });

      console.log(
        `[chatController] 📋 Queued job ${job.id} at position ${position + 1} ` +
        `(active: ${activeMs2Requests}/${MAX_CONCURRENT_MS2})`
      );

      return res.status(202).json({
        queued:        true,
        jobId:         job.id,
        sessionId:     session.id,
        queuePosition: position + 1,
      });
    }

    // ── Step 4: Synchronous ms2 call ──────────────────────────────────────────
    activeMs2Requests++;
    try {
      const result = await runMs2Query(session.id, userId, message.trim(), pollingStationId, constituencyId);
      return res.status(200).json(result);
    } catch (axiosErr) {
      const ms2Status = axiosErr.response?.status || 'NO_RESPONSE';
      const ms2Error  = axiosErr.response?.data   || axiosErr.message;
      console.error(`[chatController] ms2 error (HTTP ${ms2Status}):`, ms2Error);

      return res.status(503).json({
        error:      'AgentUnavailable',
        message:    'The AI graph engine returned an error.',
        ms2_status: ms2Status,
        ms2_detail: ms2Error,
        sessionId:  session.id,
      });
    } finally {
      activeMs2Requests--;
    }

  } catch (err) {
    console.error('[chatController] processChat error:', err);
    return res.status(500).json({
      error:   'InternalServerError',
      message: 'An unexpected error occurred while processing your query.',
    });
  }
};


// ── GET /api/chat/sessions ─────────────────────────────────────────────────────
const getSessions = async (req, res) => {
  const { userId } = req.user;

  try {
    const sessions = await prisma.session.findMany({
      where:   { userId },
      select:  { id: true, title: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return res.status(200).json({ sessions });
  } catch (err) {
    console.error('[chatController] getSessions error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Could not retrieve sessions.' });
  }
};


// ── GET /api/chat/sessions/:sessionId ─────────────────────────────────────────
// Supports cursor-based pagination via ?cursor=<messageId>&limit=<n>
const getSessionById = async (req, res) => {
  const { sessionId } = req.params;
  const { userId }    = req.user;
  const { cursor, limit = 30 } = req.query;

  try {
    const session = await prisma.session.findFirst({ where: { id: sessionId, userId } });
    if (!session) {
      return res.status(404).json({ error: 'NotFound', message: 'Session not found.' });
    }

    const messages = await prisma.message.findMany({
      where:   { sessionId },
      orderBy: { createdAt: 'asc' },
      take:    Number(limit),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    // Return the last message's id as nextCursor for the next page call
    const nextCursor = messages.length === Number(limit)
      ? messages[messages.length - 1].id
      : null;

    return res.status(200).json({ session: { ...session, messages }, nextCursor });
  } catch (err) {
    console.error('[chatController] getSessionById error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Could not retrieve session.' });
  }
};


// ── GET /api/chat/queue/:jobId ─────────────────────────────────────────────────
// Poll a queued job's status. Returns DONE with the response payload when ready.
const getQueueJobStatus = async (req, res) => {
  const { jobId } = req.params;
  const { userId } = req.user;

  try {
    // Ownership-scoped: a user can only see their own queue jobs
    const job = await prisma.chatQueueJob.findFirst({ where: { id: jobId, userId } });
    if (!job) {
      return res.status(404).json({ error: 'NotFound', message: 'Queue job not found.' });
    }

    if (job.status === 'PENDING') {
      const position = await prisma.chatQueueJob.count({
        where: { status: 'PENDING', createdAt: { lt: job.createdAt } },
      });
      return res.status(200).json({ status: 'PENDING', queuePosition: position + 1 });
    }
    if (job.status === 'PROCESSING') {
      return res.status(200).json({ status: 'PROCESSING' });
    }
    if (job.status === 'FAILED') {
      return res.status(200).json({ status: 'FAILED', error: job.errorInfo });
    }
    // DONE — spread the stored result
    return res.status(200).json({ status: 'DONE', ...job.result });
  } catch (err) {
    console.error('[chatController] getQueueJobStatus error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Could not retrieve job status.' });
  }
};


module.exports = {
  processChat,
  resumeChat,
  getSessions,
  getSessionById,
  getQueueJobStatus,
  // Exported for chatQueueWorker — these share the same counter
  runMs2Query,
  getActiveMs2Requests,
  incrementActiveRequests,
  decrementActiveRequests,
  MAX_CONCURRENT_MS2,
};
