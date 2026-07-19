# ─────────────────────────────────────────────────────────────────────────────
# app/api/chat.py
# API Router — POST /agent/query and POST /agent/query/resume
#
# Orchestrates the LangGraph StateGraph agent. Two endpoints:
#
#   POST /agent/query       — Start a new query (or continue a non-interrupted one)
#   POST /agent/query/resume — Resume a graph paused at ask_clarification
#
# ms1-core error contract (unchanged from the old GraphCypherQAChain version):
#   503 GraphEngineUnavailable — Neo4j or Gemini credentials missing/unreachable
#   500 ChainExecutionError    — Unexpected error during graph execution
# ─────────────────────────────────────────────────────────────────────────────
import logging
from fastapi import APIRouter, HTTPException

from app.models.schemas import ChatRequest, ChatResponse, ClarificationOption, ResumeRequest
from app.services.agent_graph import get_agent

router = APIRouter()
logger = logging.getLogger(__name__)


def _build_response_from_result(result: dict, session_id: str) -> ChatResponse:
    """
    Shared helper: converts a completed LangGraph state dict into a ChatResponse.
    """
    final_answer = result.get("final_answer") or "No matching electoral records were found."
    cypher_query = result.get("cypher_query")
    graph_nodes  = result.get("graph_nodes") or None
    status       = result.get("status", "success")

    return ChatResponse(
        answer=final_answer,
        cypher_query=cypher_query,
        graph_nodes=graph_nodes,
        status=status,
        needs_clarification=False,
    )


def _build_clarification_response(interrupt_payload: dict, session_id: str) -> ChatResponse:
    """
    Shared helper: converts an interrupt payload into a needs_clarification ChatResponse.
    Generates a plain-text clarification_prompt as a backward-compat fallback for ms1.
    """
    raw_options = interrupt_payload.get("options", [])
    prompt_text = interrupt_payload.get(
        "prompt",
        "I found multiple matching records. Please specify which person you mean."
    )

    # Convert raw dicts → ClarificationOption Pydantic objects
    structured_options = [
        ClarificationOption(
            label=opt.get("label", "Unknown"),
            details=opt.get("details", opt),
        )
        for opt in raw_options
    ] if raw_options else None

    return ChatResponse(
        answer=prompt_text,               # Used as the chat bubble text in the UI
        status="success",
        needs_clarification=True,
        clarification_prompt=prompt_text, # Plain-text backward-compat for ms1
        clarification_options=structured_options,
    )


@router.post("/query", response_model=ChatResponse)
async def process_query(request: ChatRequest):
    """
    Main endpoint called by ms1-core to process a citizen's natural language query.

    Full pipeline (via LangGraph StateGraph):
      1. Phonetic preprocessing (Double Metaphone name hashing)
      2. Cypher generation (Gemini LLM, with error self-correction on retry)
      3. Cypher execution (Neo4j AuraDB, retry loop up to 3x)
      4. Ambiguity evaluation (structural deduplication of Person entities)
      5. Answer synthesis (Gemini LLM) OR clarification pause (interrupt)
      6. Return ChatResponse

    If the graph pauses at ask_clarification (multiple distinct persons found),
    returns needs_clarification=True with structured options. The client must
    then POST to /agent/query/resume to continue the graph.

    Error handling (contract unchanged from old GraphCypherQAChain version):
      503: Neo4j or Gemini is unreachable (agent is None)
      500: Unexpected error during graph execution
    """
    logger.info(f"[chat] 📨 Received query: '{request.message[:80]}...' (session: {request.session_id})")

    # Get the cached LangGraph agent (built once on cold start)
    agent = get_agent()
    if agent is None:
        logger.error("[chat] ❌ Agent initialization failed — Neo4j, Gemini, or DB unavailable")
        raise HTTPException(
            status_code=503,
            detail={
                "error": "GraphEngineUnavailable",
                "message": "The graph AI engine is currently unavailable. Check Neo4j and Gemini credentials.",
            }
        )

    # LangGraph uses session_id as the thread_id to persist state between requests.
    # This is what enables interrupt() pause/resume across separate HTTP calls.
    session_id = request.session_id or "anonymous"
    config = {"configurable": {"thread_id": session_id}}

    try:
        logger.info("[chat] 🔗 Invoking LangGraph StateGraph...")
        result = agent.invoke(
            {
                "question":          request.message,
                "original_question": request.message,
                "history_text":      "",
                "polling_station_id": request.polling_station_id,
                "constituency_id":   request.constituency_id,
                "phonetic_hints":    {},
                "cypher_query":      None,
                "cypher_error":      None,
                "retry_count":       0,
                "graph_nodes":       [],
                "is_ambiguous":      False,
                "clarification_options": None,
                "final_answer":      None,
                "status":            "success",
            },
            config=config,
        )
        logger.info("[chat] ✅ Graph execution complete")

    except Exception as e:
        logger.error(f"[chat] ❌ Graph execution error: {e}")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "ChainExecutionError",
                "message": f"An error occurred while processing your query: {str(e)}",
            }
        )

    # Check if the graph paused at an interrupt() node (ask_clarification)
    # LangGraph returns the state dict on pause. We can detect this by checking
    # if is_ambiguous is True and clarification_options are present.
    if result.get("is_ambiguous") and result.get("clarification_options"):
        logger.info(f"[chat] ⚠️  Graph paused — clarification needed (session: {session_id})")
        interrupt_payload = {"options": result["clarification_options"]}
        return _build_clarification_response(interrupt_payload, session_id)

    # Normal completion — build and return the answer response
    logger.info(f"[chat] 📊 Cypher: {result.get('cypher_query', 'N/A')}")
    logger.info(f"[chat] 📦 Graph nodes returned: {len(result.get('graph_nodes') or [])}")
    return _build_response_from_result(result, session_id)


@router.post("/query/resume", response_model=ChatResponse)
async def resume_query(request: ResumeRequest):
    """
    Resume a graph that was paused at the ask_clarification interrupt node.

    Called by ms1-core after the user has selected a clarification option or
    typed a free-text reply. Reloads the persisted LangGraph checkpoint from
    PostgreSQL and continues execution from ask_clarification → generate_cypher.

    The graph then re-runs Cypher generation with the enriched question
    (original question + user's clarification) and proceeds to synthesize_answer.
    """
    logger.info(
        f"[chat] ▶️  Resuming graph (session: {request.session_id}, "
        f"reply: '{request.clarification_answer[:60]}')"
    )

    agent = get_agent()
    if agent is None:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "GraphEngineUnavailable",
                "message": "The graph AI engine is currently unavailable.",
            }
        )

    config = {"configurable": {"thread_id": request.session_id}}

    try:
        from langgraph.types import Command
        result = agent.invoke(
            Command(resume=request.clarification_answer),
            config=config,
        )
        logger.info("[chat] ✅ Graph resumed and completed")

    except Exception as e:
        logger.error(f"[chat] ❌ Graph resume error: {e}")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "ChainExecutionError",
                "message": f"An error occurred while resuming your query: {str(e)}",
            }
        )

    # Handle nested interrupt (e.g. resumed query is still ambiguous after clarification)
    if result.get("is_ambiguous") and result.get("clarification_options"):
        interrupt_payload = {"options": result["clarification_options"]}
        return _build_clarification_response(interrupt_payload, request.session_id)

    return _build_response_from_result(result, request.session_id)
