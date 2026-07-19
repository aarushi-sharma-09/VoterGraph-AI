#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# VoterGraph.ai — Master Startup Script
# Run this script to start the database and all 3 microservices instantly.
# ─────────────────────────────────────────────────────────────────────────────

echo "🚀 Starting PostgreSQL Database via Docker..."
docker compose up -d

echo "⏳ Waiting for Database to be ready..."
sleep 3

echo "✨ Starting all microservices..."
echo "Press Ctrl+C at any time to stop everything."
echo ""

# We use npx concurrently to run all 3 services in a single terminal window.
# It automatically prefixes logs with colors so you can tell them apart!
npx concurrently -k -n "FRONTEND,MS1-CORE,MS2-AGENT" -c "cyan,blue,magenta" \
  "cd frontend && npm run dev" \
  "cd ms1-core && npm run dev" \
  "cd ms2-agent && source venv/bin/activate && uvicorn app.main:app --reload --port 8000"
