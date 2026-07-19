// ─────────────────────────────────────────────────────────────────────────────
// src/lib/prisma.js
// Singleton Prisma Client — reused across all requests to avoid connection
// pool exhaustion. This pattern is required in long-running Node.js processes.
//
// Prisma v7 (Rust-free): Requires an explicit driver adapter.
// We use @prisma/adapter-pg with a pg connection Pool.
// The DATABASE_URL is read from the environment at runtime.
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

// Create a standard pg connection pool using the DATABASE_URL env var
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Wire the pg pool into Prisma via the adapter
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  // 'query' removed — it floods the terminal with a SQL line for every poll,
  // every session INSERT, etc. Set PRISMA_QUERY_LOG=1 in .env to re-enable temporarily.
  log: process.env.PRISMA_QUERY_LOG === '1'
    ? ['query', 'warn', 'error']
    : ['warn', 'error'],
});

module.exports = prisma;


