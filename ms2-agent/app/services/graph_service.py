# ─────────────────────────────────────────────────────────────────────────────
# app/services/graph_service.py
# Core Neo4j and Gemini Client Factories
#
# This file provides the two shared infrastructure singletons used by the
# LangGraph nodes in agent_graph.py:
#   - get_neo4j_graph() → Neo4jGraph instance (for Cypher execution)
#   - get_gemini_llm()  → ChatGoogleGenerativeAI instance (for LLM calls)
#
# VOTER_GRAPH_SCHEMA is also exported here since it defines the shape of the
# civic electoral records database and is injected into every Cypher prompt.
#
# NOTE: GraphCypherQAChain was removed in the LangGraph migration.
# The old functions extract_cypher_from_steps(), extract_graph_nodes(), and
# get_graph_chain() have been deleted — they are fully superseded by the
# StateGraph nodes in agent_graph.py.
# ─────────────────────────────────────────────────────────────────────────────
import os
import logging
from typing import Optional

from dotenv import load_dotenv
from langchain_neo4j import Neo4jGraph
from langchain_google_genai import ChatGoogleGenerativeAI

load_dotenv()

logger = logging.getLogger(__name__)

# ── Neo4j Schema Context ──────────────────────────────────────────────────────
# This tells Gemini what the graph looks like so it can write accurate Cypher.
# We hardcode this because:
#   a) Auto-detection via `graph.get_schema` can be slow on cold start
#   b) We control the schema, so it's always accurate
#   c) Giving Gemini a precise schema = much better Cypher quality
VOTER_GRAPH_SCHEMA = """
Node Labels and their properties:
- Person: { name: string, age: integer, gender: string (M/F), voter_id: string, phonetic_hash: string, part_serial_no: integer }
- House: { number: string, ward: string }
- PollingStation: { number: string, name: string }
- Constituency: { name: string, code: string, state: string }
- District: { name: string, code: string }
- State: { name: string, code: string }

Relationship Types (directional edges) — USE THESE EXACT NAMES, NO VARIATIONS:
- (Person)-[:LIVES_IN]->(House)           # Person is a registered voter at this house
- (Person)-[:IS_SON_OF]->(Person)         # Father-son relationship
- (Person)-[:IS_WIFE_OF]->(Person)        # Husband-wife relationship (wife -> husband)
- (House)-[:BELONGS_TO]->(PollingStation) # House is assigned to this polling booth
- (PollingStation)-[:PART_OF]->(Constituency) # Polling booth is in this constituency
- (Constituency)-[:LOCATED_IN]->(District) # Constituency is in this district
- (District)-[:LOCATED_IN]->(State)       # District is in this state

FORBIDDEN — NEVER USE THESE (they do not exist in the schema):
- :LIVED_IN, :LIVES_AT, :RESIDES_IN, :RESIDENT_OF, :DAUGHTER_OF, :IS_FATHER_OF, :NEIGHBOR_OF

IMPORTANT RULES FOR QUERY GENERATION:
- ONLY use the exact relationship names listed above — no past tense, no synonyms
- House numbers are stored as strings (e.g., "42", not 42)
- All name matches: use toLower(p.name) CONTAINS toLower('suresh') for fuzzy matching
- Always use LIMIT 20 to avoid returning the entire database
- Return actual node properties (p.name, p.age etc.), NOT COUNT or boolean expressions
- For multi-hop family traversal, use variable-length paths: [:IS_SON_OF*1..3]
"""


def get_neo4j_graph() -> Optional[Neo4jGraph]:
    """
    Establishes a connection to Neo4j AuraDB.
    Returns None if credentials are missing or connection fails.
    This allows the graph nodes to return a clean error rather than crashing.
    """
    neo4j_uri      = os.getenv("NEO4J_URI")
    neo4j_user     = os.getenv("NEO4J_USERNAME")
    neo4j_password = os.getenv("NEO4J_PASSWORD")

    if not all([neo4j_uri, neo4j_user, neo4j_password]):
        logger.error("[graph_service] Neo4j credentials missing from .env")
        return None

    try:
        graph = Neo4jGraph(
            url=neo4j_uri,
            username=neo4j_user,
            password=neo4j_password,
            database=os.getenv("NEO4J_DATABASE", "neo4j"),
        )
        graph.refresh_schema()
        logger.info("[graph_service] ✅ Connected to Neo4j AuraDB")
        return graph
    except Exception as e:
        logger.error(f"[graph_service] ❌ Neo4j connection failed: {e}")
        return None


def get_gemini_llm() -> Optional[ChatGoogleGenerativeAI]:
    """
    Initializes the Google Gemini LLM via LangChain.
    temperature=0 → deterministic output (critical for Cypher generation).
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        logger.error("[graph_service] GEMINI_API_KEY missing from .env")
        return None

    try:
        llm = ChatGoogleGenerativeAI(
            model="gemini-3.5-flash",
            temperature=0,
            google_api_key=api_key,
            max_retries=2,  # Allow LangChain to self-heal transient 503/429s from Gemini
        )
        logger.info("[graph_service] ✅ Gemini LLM initialized")
        return llm
    except Exception as e:
        logger.error(f"[graph_service] ❌ Gemini initialization failed: {e}")
        return None
