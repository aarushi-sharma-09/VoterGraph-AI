# ─────────────────────────────────────────────────────────────────────────────
# app/services/phonetic.py
# Phonetic Preprocessing — Double Metaphone Name Hashing
#
# Purpose: Extract likely proper names from a citizen's NL question and compute
# their Double Metaphone codes. These codes are injected into the Cypher
# generation prompt so Gemini can optionally filter on phonetic_hash in Neo4j
# instead of (or in addition to) toLower(...) CONTAINS toLower(...) matching.
#
# This enables queries like:
#   MATCH (p:Person) WHERE p.phonetic_hash = "SRX" RETURN p
# to work even when the user spells "Suresh" as "Suresh", "Sooresh", or "Sooreish".
#
# Limitation: Name extraction uses a simple capitalized-word heuristic — NOT
# an NER model. It will miss lowercase name mentions and may include false
# positives (e.g. a capitalised word at the start of a sentence). This is
# intentional for MVP simplicity and is sufficient for the demo use case.
# ─────────────────────────────────────────────────────────────────────────────
import re
import logging
from typing import Dict

from doublemetaphone import doublemetaphone

logger = logging.getLogger(__name__)

# ── Civic/Question Stopwords ──────────────────────────────────────────────────
# Words that are capitalised in electoral-records questions but are NOT names.
# This list is conservative — false negatives (missing a name) are fine;
# false positives (treating a stopword as a name) are noisy but harmless.
_CIVIC_STOPWORDS = {
    # English question words
    "did", "does", "is", "was", "are", "were", "has", "have", "had",
    "who", "what", "where", "when", "which", "whose", "whom", "why", "how",
    # Civic/record domain words
    "house", "ward", "ward", "constituency", "voter", "voters", "electoral",
    "record", "records", "number", "no", "street", "road", "block", "area",
    "district", "state", "city", "town", "village", "zone", "booth",
    # Relational words
    "son", "daughter", "wife", "husband", "father", "mother", "brother",
    "sister", "family", "relative", "relation", "spouse",
    # Common English sentence starters / articles / prepositions
    "the", "a", "an", "of", "in", "at", "on", "to", "for", "with",
    "from", "by", "about", "and", "or", "but", "if", "not",
    # India-specific administrative terms
    "gram", "panchayat", "mandal", "taluka", "tehsil", "mcd", "nagar",
}


def extract_candidate_names(question: str) -> list[str]:
    """
    Extracts likely proper names from a natural-language electoral query.

    Strategy:
      1. Find all capitalised-word runs (e.g. "Suresh Kumar" → ["Suresh", "Kumar"])
      2. Filter out known civic stopwords (House, Ward, Son, etc.)
      3. Filter out single-character tokens (initials like "A" are noise)

    Returns a list of unique candidate name tokens.
    """
    # Match any token that starts with an uppercase letter followed by lowercase letters
    # (catches "Suresh", "Mukherjee", "Aarav" but not "MCD", "LIVES_IN")
    capitalised_tokens = re.findall(r"\b[A-Z][a-z]+\b", question)

    # Deduplicate while preserving order, filter stopwords and short tokens
    seen = set()
    candidates = []
    for token in capitalised_tokens:
        lower = token.lower()
        if lower not in _CIVIC_STOPWORDS and len(token) > 1 and lower not in seen:
            seen.add(lower)
            candidates.append(token)

    logger.debug(f"[phonetic] Extracted candidates from '{question[:60]}': {candidates}")
    return candidates


def phonetic_hash(name: str) -> tuple:
    """
    Returns the Double Metaphone code pair for a single name token.

    Double Metaphone returns a tuple of two codes: (primary, secondary).
    The secondary code handles alternative pronunciations (e.g. "Schmidt" → ("XMT", "SMT")).
    For Indian names, primary and secondary are usually identical.

    Example:
        phonetic_hash("Suresh")     → ("SRX", "SRX")
        phonetic_hash("Mukherjee")  → ("MKRJ", "MKRJ")
        phonetic_hash("Anika")      → ("ANK", "ANK")
    """
    return doublemetaphone(name)


def build_phonetic_hints(question: str) -> Dict[str, tuple]:
    """
    Main entry point for phonetic_preprocess node.
    Returns a dict mapping each candidate name to its Double Metaphone codes.

    Example output:
        {
            "Suresh": ("SRX", "SRX"),
            "Mukherjee": ("MKRJ", "MKRJ"),
        }
    """
    candidates = extract_candidate_names(question)
    hints = {name: phonetic_hash(name) for name in candidates}
    if hints:
        logger.info(f"[phonetic] 🔤 Phonetic hints: {hints}")
    else:
        logger.info("[phonetic] 🔤 No candidate names extracted from query")
    return hints
