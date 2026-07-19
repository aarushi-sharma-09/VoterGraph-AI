# ─────────────────────────────────────────────────────────────────────────────
# app/main.py
# FastAPI Application Entry Point
#
# Responsibilities:
#   - Create the FastAPI application instance
#   - Register global middleware (CORS)
#   - Mount route files (chat router)
#   - Provide a /health endpoint (used by Docker, NGINX, and ms1-core)
#   - Configure structured logging
# ─────────────────────────────────────────────────────────────────────────────
import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import chat, search
from app.models.schemas import HealthResponse

# Load .env variables before anything else runs
load_dotenv()

# ── Logging Configuration ──────────────────────────────────────────────────────
# Structured logging is important for debugging LangChain + Neo4j pipelines.
# In production (Docker), these logs are captured by the container runtime.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# ── FastAPI App Instance ──────────────────────────────────────────────────────
app = FastAPI(
    title="VoterGraph.ai — ms2-agent",
    description=(
        "The AI Graph Brain for VoterGraph.ai. "
        "Translates natural language queries into Neo4j Cypher, "
        "executes graph traversal, and synthesizes zero-hallucination civic answers."
    ),
    version="1.0.0",
    docs_url="/docs",       # Swagger UI at http://localhost:8000/docs
    redoc_url="/redoc",     # ReDoc UI at http://localhost:8000/redoc
)

# ── CORS Middleware ──────────────────────────────────────────────────────────
# ms2-agent is an internal service — only ms1-core should call it.
# In production, we restrict origins to ms1-core's internal IP/hostname.
# For development, we allow all origins for easy testing with ThunderClient.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # Locked down to ms1-core's URL in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Route Registration ────────────────────────────────────────────────────────
# The chat router handles all /agent/* endpoints.
# prefix="/agent" → full path becomes POST /agent/query
app.include_router(chat.router, prefix="/agent", tags=["Graph AI Agent"])
app.include_router(search.router, prefix="/search", tags=["Deterministic Search"])


# ── Health Check Endpoint ─────────────────────────────────────────────────────
@app.get("/health", response_model=HealthResponse, tags=["System"])
async def health_check():
    """
    Lightweight liveness probe.
    Called by:
      - Docker HEALTHCHECK to know if the container is alive
      - NGINX upstream health probing
      - ms1-core to verify ms2 is reachable before forwarding queries
    Does NOT test Neo4j/Gemini connectivity — that's done lazily on first query.
    """
    return HealthResponse(status="ok", service="ms2-agent")


# ── Startup Event ─────────────────────────────────────────────────────────────
@app.on_event("startup")
async def on_startup():
    """
    Runs once when the server boots. Logs the configuration so you can
    immediately see if environment variables are loaded correctly.
    """
    logger.info("=" * 60)
    logger.info("🚀 ms2-agent starting up")
    logger.info(f"   Neo4j URI  : {os.getenv('NEO4J_URI', '⚠️  NOT SET')}")
    logger.info(f"   Gemini Key : {'✅ set' if os.getenv('GEMINI_API_KEY') else '⚠️  NOT SET'}")
    logger.info(f"   API Docs   : http://localhost:{os.getenv('PORT', 8000)}/docs")
    logger.info("=" * 60)
