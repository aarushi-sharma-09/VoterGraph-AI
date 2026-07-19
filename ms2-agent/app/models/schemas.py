# ─────────────────────────────────────────────────────────────────────────────
# app/models/schemas.py
# Pydantic Data Models — Request/Response Validation
#
# Pydantic is FastAPI's built-in validation layer. When a request hits an
# endpoint, FastAPI automatically:
#   1. Parses the incoming JSON body
#   2. Validates it against the Pydantic model
#   3. Returns a 422 Unprocessable Entity if any field is missing or wrong type
#
# This means we get input validation for FREE with zero boilerplate.
# ─────────────────────────────────────────────────────────────────────────────
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any


class MessageHistory(BaseModel):
    """A single message in the conversation history sent from ms1-core."""
    role: str           # "user" or "assistant"
    content: str        # The text of the message
    timestamp: Optional[str] = None


class ChatRequest(BaseModel):
    """
    The incoming request body from ms1-core.
    ms1-core POSTs to /agent/query with this structure.
    """
    message: str = Field(
        ...,                              # Required field (no default = required)
        min_length=1,
        description="The citizen's natural language query about electoral records."
    )
    session_id: Optional[str] = Field(
        default=None,
        description="PostgreSQL session ID, used as thread_id for LangGraph checkpoint."
    )
    user_id: Optional[str] = Field(
        default=None,
        description="PostgreSQL user ID of the authenticated citizen."
    )
    history: Optional[List[MessageHistory]] = Field(
        default=[],
        description="Last N messages of conversation history for multi-turn context."
    )
    polling_station_id: Optional[str] = Field(
        default=None,
        description="Optional ID to restrict graph search to a specific polling station."
    )
    constituency_id: Optional[str] = Field(
        default=None,
        description="Optional ID to restrict graph search to a specific constituency."
    )


class ClarificationOption(BaseModel):
    """
    A single selectable option in a clarification response.
    When ambiguous results are returned (multiple distinct Person entities),
    the frontend renders these as selectable cards for the citizen to choose from.
    """
    label: str                  # Human-readable label, e.g. "Suresh Kumar, Age 45, House 42"
    details: Dict[str, Any]     # Full raw node data (name, age, house, voter_id, etc.)


class ResumeRequest(BaseModel):
    """
    Request body for POST /agent/query/resume.
    Sent by ms1-core when the user responds to a clarification prompt.
    session_id is used to reload the persisted LangGraph checkpoint from Postgres.
    """
    session_id: str = Field(
        ...,
        description="The session_id from the original /agent/query response (thread_id)."
    )
    clarification_answer: str = Field(
        ...,
        min_length=1,
        description="The citizen's clarification reply — free text or a selected option label."
    )


class ChatResponse(BaseModel):
    """
    The response payload returned to ms1-core.
    ms1-core uses this to:
      - Display `answer` in the chat UI
      - Display `cypher_query` in the 'Explore Graph Evidence' drawer
      - Trigger the clarification flow if `needs_clarification` is True
      - Render `clarification_options` as selectable cards in the UI
    """
    answer: str
    cypher_query: Optional[str] = None
    graph_nodes: Optional[List[Dict[str, Any]]] = None
    status: str = "success"
    needs_clarification: bool = False
    clarification_prompt: Optional[str] = None          # Plain-text fallback for ms1 compat
    clarification_options: Optional[List[ClarificationOption]] = None  # Structured options (new)


class HealthResponse(BaseModel):
    """Health check response schema."""
    status: str
    service: str
