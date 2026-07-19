// ─────────────────────────────────────────────────────────────────────────────
// prisma/backfillMessages.js
// One-time backfill: chatHistory JSONB → messages table
//
// ⚠️  RUN THIS BEFORE `npm run migrate:dev` (the migration drops chatHistory).
//     This script uses raw SQL throughout so it works even when the Prisma
//     schema no longer references chatHistory or the messages table doesn't
//     exist yet — it creates the messages table itself if needed via raw SQL.
//
// What it does:
//   1. Creates a temporary `messages` table (safe — the migration will adopt it).
//   2. Reads all Session rows that still have a chatHistory column.
//   3. For each chatHistory entry, inserts one row preserving timestamps.
//   4. Is idempotent — skips sessions already migrated.
//
// Usage:
//   node prisma/backfillMessages.js
// ─────────────────────────────────────────────────────────────────────────────
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  console.log('🔄 Starting chatHistory → messages backfill...\n');

  try {
    // Step 1: Create messages table if it doesn't exist yet
    // (Prisma's migration will later add the index + constraints — this is safe)
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id           TEXT        NOT NULL PRIMARY KEY,
        "sessionId"  TEXT        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role         TEXT        NOT NULL,
        content      TEXT        NOT NULL DEFAULT '',
        "cypherQuery" TEXT,
        "graphNodes" JSONB,
        "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ messages table ready\n');

    // Step 2: Read all sessions with chatHistory
    const { rows: sessions } = await client.query(
      `SELECT id, "chatHistory" FROM sessions WHERE "chatHistory" IS NOT NULL`
    );
    console.log(`📋 Found ${sessions.length} session(s) with chatHistory data.`);

    let totalInserted = 0;
    let totalSkipped  = 0;

    for (const session of sessions) {
      const history = session.chatHistory;

      if (!Array.isArray(history) || history.length === 0) {
        console.log(`  ⏭  Session ${session.id}: empty chatHistory — skipping`);
        totalSkipped++;
        continue;
      }

      // Idempotency: skip if messages already exist for this session
      const { rows: existing } = await client.query(
        `SELECT COUNT(*) FROM messages WHERE "sessionId" = $1`,
        [session.id]
      );
      if (Number(existing[0].count) > 0) {
        console.log(`  ⏭  Session ${session.id}: already has ${existing[0].count} message(s) — skipping`);
        totalSkipped++;
        continue;
      }

      // Insert one row per chatHistory entry
      let insertedCount = 0;
      for (const entry of history) {
        // Generate a cuid-style id using timestamp + random suffix
        const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
        const createdAt = entry.timestamp ? new Date(entry.timestamp) : new Date();

        await client.query(
          `INSERT INTO messages (id, "sessionId", role, content, "cypherQuery", "graphNodes", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO NOTHING`,
          [
            id,
            session.id,
            entry.role || 'user',
            entry.content || '',
            entry.cypher_query || null,
            entry.graph_nodes ? JSON.stringify(entry.graph_nodes) : null,
            createdAt,
          ]
        );
        insertedCount++;
      }

      console.log(`  ✅ Session ${session.id}: inserted ${insertedCount} message(s)`);
      totalInserted += insertedCount;
    }

    console.log(`\n✅ Backfill complete.`);
    console.log(`   Messages inserted : ${totalInserted}`);
    console.log(`   Sessions skipped  : ${totalSkipped}`);
    console.log(`\n⚠️  You can now safely run: npm run migrate:dev`);

  } finally {
    client.release();
  }
}

main()
  .catch((e) => {
    console.error('❌ Backfill failed:', e);
    process.exit(1);
  })
  .finally(() => pool.end());
