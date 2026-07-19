# ─────────────────────────────────────────────────────────────────────────────
# app/services/agent_state.py
# LangGraph Shared State — the single source of truth flowing through the graph
#
# Each node in the StateGraph receives this dict, mutates only its own fields,
# and returns the mutations. LangGraph merges them into a single running state.
# ─────────────────────────────────────────────────────────────────────────────
from typing import TypedDict, Optional, List, Dict, Any


class AgentState(TypedDict):
    """
    Shared state passed between every node in the VoterGraph StateGraph.

    Field ownership (which node writes which field):
      phonetic_preprocess → phonetic_hints
      generate_cypher     → cypher_query
      execute_cypher      → graph_nodes, cypher_error, retry_count
      evaluate_ambiguity  → is_ambiguous, clarification_options
      ask_clarification   → question (mutated with clarification), retry_count (reset)
      synthesize_answer   → final_answer, status
      synthesize_failure  → final_answer, status
    """
    # The user's NL question — mutated on clarification resume to include user's reply
    question: str

    # Preserved verbatim from the original request, never mutated, used for logging/telemetry
    original_question: str

    # Pre-formatted conversation history block — built once before graph entry by chat.py
    history_text: str

    # Optional hard geo-boundary provided by frontend context
    polling_station_id: Optional[str]
    constituency_id: Optional[str]

    # {"suresh": ("SRX", "SRS"), "mukherjee": ("MKRJ", "")} from Double Metaphone
    # Injected into the Cypher generation prompt so LLM can use phonetic filtering
    phonetic_hints: Dict[str, tuple]

    # The most recently generated Cypher query (may be from a previous failed attempt)
    cypher_query: Optional[str]

    # Set by execute_cypher on Neo4j failure; cleared on success.
    # Fed back into generate_cypher on retry so the LLM can self-correct.
    cypher_error: Optional[str]

    # How many times execute_cypher has failed for this request. Bounded at 3.
    retry_count: int

    # Raw list of node dicts returned by Neo4j (used by evaluate_ambiguity + frontend)
    graph_nodes: List[Dict[str, Any]]

    # True if multiple distinct Person entities were found (triggers ask_clarification)
    is_ambiguous: bool

    # Structured per-person options for the UI to render as selectable cards
    clarification_options: Optional[List[Dict[str, Any]]]

    # LangGraph Native Context Memory — preserved across turns (thread_id)
    resolved_person_id: Optional[str]
    resolved_house_number: Optional[str]

    # The final natural language answer — set by synthesize_answer OR synthesize_failure
    final_answer: Optional[str]

    # "success" | "failed" — set at the terminal nodes
    status: str
