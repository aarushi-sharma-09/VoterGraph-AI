// ─────────────────────────────────────────────────────────────────────────────
// src/workers/chatQueueWorker.js
// Background Queue Processor for Chat Jobs
//
// Periodically polls the chat_queue_jobs table for PENDING jobs.
// Prevents overloading ms2-agent by respecting MAX_CONCURRENT_MS2.
// ─────────────────────────────────────────────────────────────────────────────
const prisma = require('../lib/prisma');
const {
  runMs2Query,
  getActiveMs2Requests,
  incrementActiveRequests,
  decrementActiveRequests,
  MAX_CONCURRENT_MS2,
} = require('../controllers/chatController');

let isPolling = false;

const startWorker = () => {
  console.log(`[chatQueueWorker] 👷 Worker started. Max concurrency: ${MAX_CONCURRENT_MS2}. Poll interval: 2s`);

  // Poll every 2 seconds (500ms was flooding dev logs with empty-queue SELECTs)
  setInterval(async () => {
    if (isPolling) return;

    // Check concurrency gate.
    // Use max(MAX_CONCURRENT_MS2, 1) so the worker always processes at least
    // 1 job at a time — even when MAX_CONCURRENT_MS2=0 (force-queue mode for
    // incoming HTTP requests to avoid Vercel proxy timeouts).
    const workerMaxConcurrency = Math.max(MAX_CONCURRENT_MS2, 1);
    if (getActiveMs2Requests() >= workerMaxConcurrency) {
      return;
    }

    isPolling = true;

    try {
      // Find the oldest PENDING job
      const job = await prisma.chatQueueJob.findFirst({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
      });

      if (!job) {
        isPolling = false;
        return;
      }

      // Claim the job
      await prisma.chatQueueJob.update({
        where: { id: job.id },
        data: { status: 'PROCESSING' },
      });

      console.log(`[chatQueueWorker] ⚙️  Processing job ${job.id}`);
      incrementActiveRequests();

      try {
        // Reuse the exact same shared logic as the sync path
        const result = await runMs2Query(job.sessionId, job.userId, job.message, job.pollingStationId);
        
        await prisma.chatQueueJob.update({
          where: { id: job.id },
          data: { status: 'DONE', result },
        });
        
        console.log(`[chatQueueWorker] ✅ Job ${job.id} complete`);
      } catch (err) {
        console.error(`[chatQueueWorker] ❌ Job ${job.id} failed:`, err);
        await prisma.chatQueueJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', errorInfo: { message: err.message } },
        });
      } finally {
        decrementActiveRequests();
      }

    } catch (err) {
      console.error('[chatQueueWorker] Polling loop error:', err);
    } finally {
      isPolling = false;
    }
  }, 2000);
};

module.exports = { startWorker };
