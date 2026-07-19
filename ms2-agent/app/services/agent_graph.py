# ─────────────────────────────────────────────────────────────────────────────
# app/services/agent_graph.py
# LangGraph StateGraph — VoterGraph.ai AI Agent
#
# This replaces GraphCypherQAChain with a hand-built multi-node graph that
# implements:
#   1. Phonetic Preprocessing  — Double Metaphone name hashing
#   2. Cypher Generation       — Gemini LLM → Cypher (with error self-correction)
#   3. Cypher Execution        — Neo4j AuraDB query
#   4. Ambiguity Evaluation    — Structural deduplication (NOT text keyword matching)
#   5. Clarification Pause     — interrupt() human-in-the-loop (Postgres-persisted)
#   6. Answer Synthesis        — Gemini LLM → natural language answer
#   7. Failure Synthesis       — Graceful degradation (no LLM, no retries left)
#
# Graph topology (matches design doc exactly):
#   START
#   → phonetic_preprocess
#   → generate_cypher
#   → execute_cypher
#       ├─ (success)          → evaluate_ambiguity
#       ├─ (error, retry<3)   → generate_cypher      [RETRY LOOP]
#       └─ (error, retry>=3)  → synthesize_failure
#   evaluate_ambiguity
#       ├─ (1 match)          → synthesize_answer
#       └─ (>1 match)         → ask_clarification
#   ask_clarification  [INTERRUPT — graph pauses, waits for HTTP resume]
#   → generate_cypher         [loops back with enriched question]
#   synthesize_answer  → END
#   synthesize_failure → END
# ─────────────────────────────────────────────────────────────────────────────
import os
import logging
from typing import Optional

from langchain_core.prompts import ChatPromptTemplate, HumanMessagePromptTemplate, SystemMessagePromptTemplate
from langchain_core.output_parsers import StrOutputParser

from langgraph.graph import StateGraph, END
from langgraph.types import interrupt
from langgraph.checkpoint.postgres import PostgresSaver

from app.services.agent_state import AgentState
from app.services.phonetic import build_phonetic_hints
from app.services.graph_service import get_neo4j_graph, get_gemini_llm, VOTER_GRAPH_SCHEMA

logger = logging.getLogger(__name__)

# ── Module-level singleton ────────────────────────────────────────────────────
# The compiled graph is expensive to build (Neo4j + Gemini client construction).
# We build it ONCE at first use and cache it for the lifetime of the process.
# On Uvicorn --reload, the module is reloaded and the singleton is rebuilt.
# We do NOT rebuild on every request the way the old get_graph_chain() did.
_COMPILED_AGENT = None
_CHECKPOINTER = None


# ═════════════════════════════════════════════════════════════════════════════
# CHECKPOINTER
# ═════════════════════════════════════════════════════════════════════════════

def get_checkpointer() -> Optional[PostgresSaver]:
    """
    Creates a PostgresSaver checkpointer backed by the same PostgreSQL instance
    used by ms1-core's Prisma ORM.

    langgraph-checkpoint-postgres v3 + psycopg v3 API:
      - from_conn_string() is a @contextmanager in v3 — can't call .setup() on it directly.
      - Correct pattern for a long-running server: open a persistent psycopg connection
        with autocommit=True and pass it directly to PostgresSaver().
      - The connection stays open for the lifetime of the process (intentional —
        we don't want it garbage-collected mid-request).
      - .setup() is idempotent: creates the 4 checkpoint tables on first run, no-ops after.

    Env var: DATABASE_URL — same as ms1-core's .env
    """
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        logger.error("[agent_graph] ❌ DATABASE_URL not set — cannot create checkpointer")
        return None

    try:
        import psycopg  # psycopg v3

        # Open a persistent connection — autocommit required by LangGraph checkpointer
        conn = psycopg.connect(db_url, autocommit=True, prepare_threshold=0)
        checkpointer = PostgresSaver(conn)
        checkpointer.setup()  # Creates checkpoint tables if they don't exist (idempotent)
        logger.info("[agent_graph] ✅ PostgresSaver checkpointer initialized (psycopg v3)")
        return checkpointer
    except Exception as e:
        logger.error(f"[agent_graph] ❌ Checkpointer initialization failed: {e}")
        return None


# ═════════════════════════════════════════════════════════════════════════════
# PROMPT TEMPLATES (ported verbatim from old graph_service.py)
# ═════════════════════════════════════════════════════════════════════════════

def _build_cypher_prompt() -> ChatPromptTemplate:
    """
    Constructs the Cypher generation prompt.
    On retry, the human message will include the previous error + failed query.
    The template variables {schema}, {question}, {error_context}, {phonetic_context}
    are injected at node runtime.
    """
    return ChatPromptTemplate.from_messages([
        SystemMessagePromptTemplate.from_template(
            "You are an expert Neo4j Cypher query generator for a civic electoral records database.\n"
            "Your ONLY job is to translate natural language questions into valid Cypher queries.\n\n"
            "STRICT RULES:\n"
            "1. ONLY use the exact relationship names defined in the schema below — no variations.\n"
            "2. NEVER invent properties or relationships not in the schema.\n"
            "3. FORBIDDEN relationships: :LIVED_IN :LIVES_AT :RESIDES_IN :DAUGHTER_OF :IS_FATHER_OF :RESIDENT_OF\n"
            "4. Always add LIMIT 20 to prevent full database scans.\n"
            "5. Use toLower(p.name) CONTAINS toLower('name') for fuzzy name matching.\n"
            "6. Return node properties (p.name, p.age, h.number) and optionally relationship types if asked. Do NOT return COUNT or boolean expressions. Do NOT return entire nodes, only properties.\n"
            "7. Return ONLY the Cypher query — no explanation, no markdown, no code fences.\n\n"
            "DATABASE SCHEMA:\n{schema}\n\n"
            "{phonetic_context}"
        ),
        HumanMessagePromptTemplate.from_template(
            "Question: {question}\n\n"
            "{error_context}"
            "Cypher Query:"
        ),
    ])


def _build_qa_prompt() -> ChatPromptTemplate:
    """
    Constructs the answer synthesis prompt. Ported verbatim from the old chain.
    Zero-hallucination rules: only use retrieved data, never assert a false negative
    on empty results.
    """
    return ChatPromptTemplate.from_messages([
        SystemMessagePromptTemplate.from_template(
            "You are a civic records assistant for VoterGraph.ai.\n"
            "Your job is to answer the user's question using ONLY the retrieved electoral records data provided below.\n"
            "Do NOT use general knowledge or make assumptions.\n\n"
            "Retrieved Data:\n{context}\n\n"
            "Instructions:\n"
            "1. If the Retrieved Data is empty (e.g., '[]'), you MUST reply EXACTLY with: 'No matching electoral records were found. The database may not yet contain records for this person or house.'\n"
            "2. If the Retrieved Data contains records, summarize them clearly to answer the question.\n"
            "3. Absence of data is NOT a confirmed negative, never say 'No, they do not live there', just use the empty data fallback.\n"
            "4. For relationships: 'Outgoing IS_SON_OF' means the person is the son of the relative. 'Incoming IS_SON_OF' means the relative is the son of the person. 'Outgoing IS_WIFE_OF' means the person is the wife of the relative. 'Incoming IS_WIFE_OF' means the relative is the wife of the person.\n"
            "5. Do not output raw relationship terms like 'Incoming IS_WIFE_OF'. Translate them into natural language (e.g. 'Wife: Sarita Prajapati' or 'Sons: Suresh Yadav')."
        ),
        HumanMessagePromptTemplate.from_template("Question: {question}\n\nAnswer:"),
    ])


# ═════════════════════════════════════════════════════════════════════════════
# GRAPH NODES
# ═════════════════════════════════════════════════════════════════════════════

def phonetic_preprocess(state: AgentState) -> dict:
    """
    Node 1: Phonetic Preprocessing
    Extracts candidate names from the question and computes Double Metaphone codes.
    Pure Python — no LLM or DB calls. Should complete in <1ms.
    """
    logger.info("[agent_graph] 🔤 Node: phonetic_preprocess")
    hints = build_phonetic_hints(state["question"])
    return {"phonetic_hints": hints}


def generate_cypher(state: AgentState) -> dict:
    """
    Node 2: Cypher Generation
    Uses Gemini to translate the NL question into a Cypher query.
    On retry (cypher_error is set), feeds the previous error back into the prompt
    so the LLM can self-correct rather than regenerating blind.
    """
    logger.info(f"[agent_graph] 🧠 Node: generate_cypher (retry #{state['retry_count']})")

    llm = get_gemini_llm()
    if llm is None:
        # This shouldn't happen if get_agent() did a health check, but be defensive
        raise RuntimeError("Gemini LLM unavailable inside generate_cypher node")

    # Build phonetic context block for the prompt
    hints = state.get("phonetic_hints", {})
    if hints:
        hint_lines = "\n".join(
            f"  - '{name}' → Double Metaphone: primary='{codes[0]}', secondary='{codes[1]}'"
            for name, codes in hints.items()
        )
        phonetic_context = (
            "PHONETIC HINTS (use for p.phonetic_hash matching if the property exists):\n"
            f"{hint_lines}\n\n"
        )
    else:
        phonetic_context = ""

    # Build error-correction block on retry
    cypher_error = state.get("cypher_error")
    prev_query = state.get("cypher_query")
    if cypher_error and prev_query:
        error_context = (
            f"⚠️  Your previous query failed with this Neo4j error:\n"
            f"  {cypher_error}\n\n"
            f"Previous failed query:\n"
            f"  {prev_query}\n\n"
            f"Fix the query. Common issues: wrong relationship type name, "
            f"non-existent property, missing LIMIT clause.\n\n"
        )
    else:
        error_context = ""

    # Feature 4 & Geo Scoping: Inject resolved context and geo boundaries
    resolved_person_id = state.get("resolved_person_id")
    resolved_house_number = state.get("resolved_house_number")
    polling_station_id = state.get("polling_station_id")
    constituency_id = state.get("constituency_id")
    
    context_hint = ""
    if polling_station_id:
        context_hint += f"HARD CONSTRAINT: Only search within PollingStation {{number: '{polling_station_id}'}}. Ensure the query path traverses through this exact PollingStation number.\n"
    elif constituency_id:
        context_hint += f"HARD CONSTRAINT: Only search within Constituency {{code: '{constituency_id}'}}. Ensure the query path traverses through this exact Constituency code.\n"
    if resolved_person_id:
        context_hint += (
            f"MANDATORY: The user has ALREADY specified exactly which person they mean — "
            f"voter_id = '{resolved_person_id}'. Generate a query filtering with "
            f"WHERE p.voter_id = '{resolved_person_id}' (exact match). Do NOT filter only "
            f"by house number or name — that was already tried and was ambiguous.\n"
            f"CRITICAL: Because the user resolved a specific person, you MUST fetch rich details "
            f"about them to provide a comprehensive answer. Do NOT just return name and age. "
            f"You MUST include their relationships. Example pattern to use:\n"
            f"MATCH (p:Person {{voter_id: '{resolved_person_id}'}})-[:LIVES_IN]->(h:House)\n"
            f"OPTIONAL MATCH (p)-[r:IS_SON_OF|IS_WIFE_OF]-(relative:Person)\n"
            f"RETURN p.name, p.age, p.gender, p.voter_id, h.number, "
            f"CASE WHEN startNode(r) = p THEN 'Outgoing ' + type(r) ELSE 'Incoming ' + type(r) END as rel_type, "
            f"relative.name as relative_name\n"
        )
    elif resolved_house_number:
        context_hint += f"Previously identified house number: '{resolved_house_number}' — prefer queries that filter directly by house number if relevant.\n"
    if context_hint:
        error_context += f"RESOLVED CONTEXT / CONSTRAINTS:\n{context_hint}\n"

    cypher_prompt = _build_cypher_prompt()
    chain = cypher_prompt | llm | StrOutputParser()

    try:
        cypher_query = chain.invoke({
            "schema": VOTER_GRAPH_SCHEMA,
            "question": state["question"],
            "phonetic_context": phonetic_context,
            "error_context": error_context,
        })
    except Exception as e:
        err_str = str(e)
        if any(kw in err_str for kw in ("UNAVAILABLE", "503", "overloaded", "high demand", "429", "RESOURCE_EXHAUSTED", "quota")):
            logger.warning(f"[agent_graph] ⚠️ Gemini transient overload/quota in generate_cypher: {err_str[:120]}")
            raise RuntimeError(
                "Gemini is temporarily overloaded or rate-limited. Please wait a moment and retry your query."
            ) from e
        raise

    # Strip any accidental markdown fences the LLM might add despite instructions
    cypher_query = cypher_query.strip()
    if cypher_query.startswith("```"):
        lines = cypher_query.split("\n")
        cypher_query = "\n".join(
            line for line in lines
            if not line.startswith("```")
        ).strip()

    logger.info(f"[agent_graph] 📝 Generated Cypher: {cypher_query[:120]}")
    return {"cypher_query": cypher_query}


def execute_cypher(state: AgentState) -> dict:
    """
    Node 3: Cypher Execution
    Runs the generated Cypher against Neo4j AuraDB.
    On success: clears cypher_error, sets graph_nodes.
    On failure: sets cypher_error, increments retry_count. Does NOT raise —
    the conditional edge (route_after_execution) handles the retry/failure routing.
    """
    logger.info(f"[agent_graph] 🗄️  Node: execute_cypher")

    neo4j_graph = get_neo4j_graph()
    if neo4j_graph is None:
        return {
            "cypher_error": "Neo4j connection unavailable",
            "retry_count": state["retry_count"] + 1,
            "graph_nodes": [],
        }

    try:
        result = neo4j_graph.query(state["cypher_query"])
        nodes = result if isinstance(result, list) else []
        
        # If this query matched Person nodes, voter_id MUST be present — evaluate_ambiguity
        # and ask_clarification both depend on it for identity resolution. Treat a missing
        # voter_id as a retryable generation error rather than silently proceeding.
        query_touches_person = ":Person" in state["cypher_query"]
        if query_touches_person and nodes:
            has_voter_id = any(
                ("p.voter_id" in n or "voter_id" in n) for n in nodes if isinstance(n, dict)
            )
            if not has_voter_id:
                logger.warning("[agent_graph] ⚠️ Person query missing p.voter_id — forcing retry")
                return {
                    "cypher_error": (
                        "Your RETURN clause did not include p.voter_id. This is MANDATORY "
                        "whenever the query matches a Person node. Regenerate the query and "
                        "include p.voter_id in the RETURN clause."
                    ),
                    "retry_count": state["retry_count"] + 1,
                    "graph_nodes": [],
                }

        logger.info(f"[agent_graph] ✅ Cypher executed — {len(nodes)} nodes returned")
        return {
            "graph_nodes": nodes,
            "cypher_error": None,  # Clear any previous error
        }
    except Exception as e:
        error_msg = str(e)
        new_retry_count = state["retry_count"] + 1
        logger.error(
            f"[agent_graph] ❌ Cypher execution failed (attempt {new_retry_count}): {error_msg}"
        )
        return {
            "cypher_error": error_msg,
            "retry_count": new_retry_count,
            "graph_nodes": [],
        }


def evaluate_ambiguity(state: AgentState) -> dict:
    """
    Node 4: Ambiguity Evaluation
    Determines if the graph returned multiple distinct Person entities that
    require the user to clarify which one they mean.

    Structural approach: deduplicates by voter_id (or name as fallback) —
    NOT by keyword-matching the final answer text (which doesn't exist yet).
    Multiple rows can represent the same person via different relationship paths,
    so we count distinct identities, not raw row count.
    """
    logger.info("[agent_graph] 🔍 Node: evaluate_ambiguity")

    nodes = state.get("graph_nodes", [])

    # ── Deduplicate by voter_id, then by name ─────────────────────────────────
    seen_ids = set()
    distinct_persons = []

    for node in nodes:
        if not isinstance(node, dict):
            continue
        # Use voter_id as primary identity key; fall back to name
        identity_key = node.get("p.voter_id") or node.get("voter_id") or node.get("p.name") or node.get("name")
        if identity_key and identity_key not in seen_ids:
            seen_ids.add(identity_key)
            distinct_persons.append(node)

    is_ambiguous = len(distinct_persons) > 1
    logger.info(
        f"[agent_graph] {'⚠️  Ambiguous' if is_ambiguous else '✅ Unambiguous'}: "
        f"{len(distinct_persons)} distinct person(s) found"
    )

    clarification_options = None
    if is_ambiguous:
        # Build structured per-person option cards for the frontend UI
        clarification_options = []
        for person in distinct_persons:
            name = person.get("p.name") or person.get("name", "Unknown")
            age = person.get("p.age") or person.get("age")
            house = person.get("h.number") or person.get("house_number")
            voter_id = person.get("p.voter_id") or person.get("voter_id")

            # Build a human-readable label for the UI dropdown/card
            label_parts = [name]
            if age:
                label_parts.append(f"Age {age}")
            if house:
                label_parts.append(f"House {house}")

            clarification_options.append({
                "label": ", ".join(label_parts),
                "details": {
                    "name": name,
                    "age": age,
                    "house_number": house,
                    "voter_id": voter_id,
                    **{k: v for k, v in person.items()},  # include all raw fields
                },
            })

    resolved_person_id = state.get("resolved_person_id")
    resolved_house_number = state.get("resolved_house_number")

    if not is_ambiguous and len(distinct_persons) == 1:
        # We uniquely identified a person, store them in the thread context!
        person = distinct_persons[0]
        voter_id = person.get("p.voter_id") or person.get("voter_id")
        house_no = person.get("h.number") or person.get("house_number")
        
        if voter_id:
            resolved_person_id = voter_id
        if house_no:
            resolved_house_number = house_no
            
        logger.info(f"[agent_graph] 🧠 Context updated: voter_id={resolved_person_id}, house={resolved_house_number}")

    return {
        "is_ambiguous": is_ambiguous,
        "clarification_options": clarification_options,
        "resolved_person_id": resolved_person_id,
        "resolved_house_number": resolved_house_number,
    }


def ask_clarification(state: AgentState) -> dict:
    """
    Node 5: Ask Clarification — Human-in-the-Loop PAUSE
    This is the interrupt() node. Graph execution stops here and the state is
    persisted to PostgreSQL. The HTTP response is returned to ms1-core with
    needs_clarification=True and the clarification_options.

    When the user selects an option and ms1-core POSTs to /agent/query/resume,
    LangGraph reloads the checkpoint and resumes from this exact point.
    The user's reply is injected into the question, then execution continues
    back to generate_cypher with the enriched context.
    """
    logger.info("[agent_graph] ⏸️  Node: ask_clarification — suspending for user input")

    # interrupt() raises a special LangGraph exception that:
    #   1. Persists the current state to the PostgresSaver checkpointer
    #   2. Returns control to the caller with the payload as the interrupt value
    #   3. Resumes from this exact point when Command(resume=...) is sent
    user_reply = interrupt({
        "type": "clarification_needed",
        "options": state.get("clarification_options", []),
        "prompt": (
            "I found multiple matching records. Please select which person you mean, "
            "or provide more details (approximate age, father's name, or ward number)."
        ),
    })

    # Enrich the question with the user's clarification reply
    enriched_question = f"{state['original_question']} (Clarification: {user_reply})"
    logger.info(f"[agent_graph] ▶️  Resumed with clarification: '{user_reply[:60]}'")

    # Try to extract the voter_id from the user's reply if they picked an exact option
    # e.g., if the reply matches the label exactly, or if the UI passed the JSON string.
    # The UI is likely passing the selected text or label.
    resolved_person_id = state.get("resolved_person_id")
    resolved_house_number = state.get("resolved_house_number")

    clarification_options = state.get("clarification_options", [])
    if clarification_options:
        for opt in clarification_options:
            if user_reply == opt.get("label"):
                details = opt.get("details", {})
                resolved_person_id = details.get("voter_id") or resolved_person_id
                resolved_house_number = details.get("house_number") or resolved_house_number
                logger.info(f"[agent_graph] 🧠 Context updated from clarification: voter_id={resolved_person_id}, house={resolved_house_number}")
                break

    return {
        "question": enriched_question,
        "cypher_error": None,    # Fresh start — not a Cypher retry
        "retry_count": 0,        # Reset retry counter for the new clarified attempt
        "resolved_person_id": resolved_person_id,
        "resolved_house_number": resolved_house_number,
    }


def synthesize_answer(state: AgentState) -> dict:
    """
    Node 6: Answer Synthesis
    Uses Gemini to translate raw Neo4j node data into a human-readable,
    zero-hallucination civic answer. Ported verbatim from the old qa_prompt.
    """
    logger.info("[agent_graph] 💬 Node: synthesize_answer")

    llm = get_gemini_llm()
    if llm is None:
        return {
            "final_answer": (
                "I retrieved the data but could not synthesize an answer because "
                "the language model is currently unavailable."
            ),
            "status": "failed",
        }

    # Format the raw graph nodes as readable context for Gemini
    graph_nodes = state.get("graph_nodes", [])
    context_str = str(graph_nodes) if graph_nodes else "[]"

    qa_prompt = _build_qa_prompt()
    chain = qa_prompt | llm | StrOutputParser()

    try:
        answer = chain.invoke({
            "context": context_str,
            "question": state["original_question"],  # Use the original question, not the enriched one
        })
    except Exception as e:
        err_str = str(e)
        if any(kw in err_str for kw in ("UNAVAILABLE", "503", "overloaded", "high demand", "429", "RESOURCE_EXHAUSTED", "quota")):
            logger.warning(f"[agent_graph] ⚠️ Gemini transient overload/quota in synthesize_answer: {err_str[:120]}")
            raise RuntimeError(
                "Gemini is temporarily overloaded or rate-limited. Please wait a moment and retry your query."
            ) from e
        raise

    logger.info(f"[agent_graph] ✅ Answer synthesized: '{answer[:80]}...'")
    return {
        "final_answer": answer.strip(),
        "status": "success",
    }


def synthesize_failure(state: AgentState) -> dict:
    """
    Node 7: Failure Synthesis — Graceful Degradation
    Reached after 3 failed Cypher generation/execution attempts.
    Does NOT call the LLM — this path must always succeed and respond quickly.
    Returns an honest, actionable message to the citizen.
    """
    logger.error(
        f"[agent_graph] 💥 Node: synthesize_failure — "
        f"giving up after {state['retry_count']} attempts. "
        f"Last error: {state.get('cypher_error', 'unknown')}"
    )
    return {
        "final_answer": (
            "I was unable to translate your question into a valid database query after "
            f"{state['retry_count']} attempt(s). "
            "Please try rephrasing with more specific details — for example, the person's "
            "full name, house number, or ward. "
            "If this issue persists, the records for this query may not yet be loaded "
            "into the database."
        ),
        "status": "failed",
    }


# ═════════════════════════════════════════════════════════════════════════════
# CONDITIONAL EDGES
# ═════════════════════════════════════════════════════════════════════════════

def route_after_execution(state: AgentState) -> str:
    """
    3-way branch after execute_cypher:
      - Cypher succeeded → evaluate_ambiguity
      - Cypher failed, retries left → generate_cypher (retry loop)
      - Cypher failed, no retries left → synthesize_failure (graceful degradation)
    """
    if state.get("cypher_error") is None:
        return "evaluate_ambiguity"
    if state.get("retry_count", 0) < 3:
        return "generate_cypher"
    return "synthesize_failure"


def route_ambiguity(state: AgentState) -> str:
    """
    2-way branch after evaluate_ambiguity:
      - Single/no match → synthesize_answer
      - Multiple distinct persons → ask_clarification (interrupt pause)
    """
    return "ask_clarification" if state.get("is_ambiguous") else "synthesize_answer"


# ═════════════════════════════════════════════════════════════════════════════
# GRAPH ASSEMBLY
# ═════════════════════════════════════════════════════════════════════════════

def build_agent_graph(checkpointer):
    """
    Assembles and compiles the StateGraph. Returns a compiled LangGraph object.
    The checkpointer is required for interrupt() to work — without it, the graph
    cannot persist state between the pause and the resume HTTP request.
    """
    g = StateGraph(AgentState)

    # Register all nodes
    g.add_node("phonetic_preprocess", phonetic_preprocess)
    g.add_node("generate_cypher",     generate_cypher)
    g.add_node("execute_cypher",      execute_cypher)
    g.add_node("evaluate_ambiguity",  evaluate_ambiguity)
    g.add_node("ask_clarification",   ask_clarification)
    g.add_node("synthesize_answer",   synthesize_answer)
    g.add_node("synthesize_failure",  synthesize_failure)

    # Entry point
    g.set_entry_point("phonetic_preprocess")

    # Linear edges
    g.add_edge("phonetic_preprocess", "generate_cypher")
    g.add_edge("generate_cypher",     "execute_cypher")
    g.add_edge("ask_clarification",   "generate_cypher")   # Resume loop
    g.add_edge("synthesize_answer",   END)
    g.add_edge("synthesize_failure",  END)

    # Conditional edges
    g.add_conditional_edges(
        "execute_cypher",
        route_after_execution,
        {
            "evaluate_ambiguity": "evaluate_ambiguity",
            "generate_cypher":    "generate_cypher",
            "synthesize_failure": "synthesize_failure",
        },
    )
    g.add_conditional_edges(
        "evaluate_ambiguity",
        route_ambiguity,
        {
            "ask_clarification": "ask_clarification",
            "synthesize_answer": "synthesize_answer",
        },
    )

    return g.compile(checkpointer=checkpointer, interrupt_before=["ask_clarification"])


def get_agent():
    """
    Public factory — returns the compiled LangGraph agent singleton.
    Mirrors the fail-soft pattern of the old get_graph_chain():
      - Returns None if Neo4j or Gemini are unavailable (→ 503 in chat.py)
      - Logs the specific failure reason

    Caching: The compiled graph is cached at module level. Building it involves
    Neo4j client construction (TCP connection) + Gemini client init, which is
    expensive to repeat on every request. The cache is invalidated only on
    process restart (e.g. Uvicorn --reload picks up code changes).
    """
    global _COMPILED_AGENT, _CHECKPOINTER

    if _COMPILED_AGENT is not None:
        return _COMPILED_AGENT

    logger.info("[agent_graph] 🔧 Building LangGraph agent (first use — cold start)")

    # Verify dependencies are available before assembling the graph
    neo4j_graph = get_neo4j_graph()
    if neo4j_graph is None:
        logger.error("[agent_graph] ❌ Neo4j unavailable — cannot build agent")
        return None

    llm = get_gemini_llm()
    if llm is None:
        logger.error("[agent_graph] ❌ Gemini unavailable — cannot build agent")
        return None

    checkpointer = get_checkpointer()
    if checkpointer is None:
        logger.error("[agent_graph] ❌ Checkpointer unavailable — cannot build agent")
        return None

    _CHECKPOINTER = checkpointer
    _COMPILED_AGENT = build_agent_graph(checkpointer)

    logger.info("[agent_graph] ✅ LangGraph agent compiled and cached")
    return _COMPILED_AGENT
