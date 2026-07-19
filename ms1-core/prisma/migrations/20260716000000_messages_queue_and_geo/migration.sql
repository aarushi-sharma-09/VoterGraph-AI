-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: messages_queue_and_geo
-- Changes:
--   1. Add messages table (replaces chatHistory JSONB)
--   2. Drop chatHistory column from sessions (data already backfilled)
--   3. Add chat_queue_jobs table
--   4. Add geo lookup tables: states, districts, constituencies, polling_stations
--   5. Add ChatQueueJob relation to users
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. messages table
CREATE TABLE "messages" (
    "id"          TEXT        NOT NULL,
    "sessionId"   TEXT        NOT NULL,
    "role"        TEXT        NOT NULL,
    "content"     TEXT        NOT NULL DEFAULT '',
    "cypherQuery" TEXT,
    "graphNodes"  JSONB,
    "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "messages_sessionId_createdAt_idx" ON "messages"("sessionId", "createdAt");

ALTER TABLE "messages" ADD CONSTRAINT "messages_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Drop chatHistory column (data safely backfilled to messages table)
ALTER TABLE "sessions" DROP COLUMN IF EXISTS "chatHistory";

-- 3. chat_queue_jobs table
CREATE TABLE "chat_queue_jobs" (
    "id"        TEXT        NOT NULL,
    "sessionId" TEXT        NOT NULL,
    "userId"    TEXT        NOT NULL,
    "message"   TEXT        NOT NULL,
    "status"    TEXT        NOT NULL DEFAULT 'PENDING',
    "result"    JSONB,
    "errorInfo" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_queue_jobs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "chat_queue_jobs" ADD CONSTRAINT "chat_queue_jobs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Geo lookup tables

CREATE TABLE "states" (
    "id"   TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "states_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "states_name_key" ON "states"("name");
CREATE UNIQUE INDEX "states_code_key" ON "states"("code");

CREATE TABLE "districts" (
    "id"      TEXT NOT NULL,
    "name"    TEXT NOT NULL,
    "code"    TEXT NOT NULL,
    "stateId" TEXT NOT NULL,

    CONSTRAINT "districts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "districts_stateId_code_key" ON "districts"("stateId", "code");

ALTER TABLE "districts" ADD CONSTRAINT "districts_stateId_fkey"
    FOREIGN KEY ("stateId") REFERENCES "states"("id") ON UPDATE CASCADE;

CREATE TABLE "constituencies" (
    "id"         TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "code"       TEXT NOT NULL,
    "districtId" TEXT NOT NULL,

    CONSTRAINT "constituencies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "constituencies_districtId_code_key" ON "constituencies"("districtId", "code");

ALTER TABLE "constituencies" ADD CONSTRAINT "constituencies_districtId_fkey"
    FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON UPDATE CASCADE;

CREATE TABLE "polling_stations" (
    "id"              TEXT NOT NULL,
    "number"          TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "houseRangeStart" TEXT,
    "houseRangeEnd"   TEXT,
    "constituencyId"  TEXT NOT NULL,

    CONSTRAINT "polling_stations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "polling_stations_constituencyId_number_key"
    ON "polling_stations"("constituencyId", "number");

ALTER TABLE "polling_stations" ADD CONSTRAINT "polling_stations_constituencyId_fkey"
    FOREIGN KEY ("constituencyId") REFERENCES "constituencies"("id") ON UPDATE CASCADE;
