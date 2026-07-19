"""
generate_and_seed.py
─────────────────────────────────────────────────────────────────────────────
Generates realistic synthetic electoral-roll data (families with correct
father/son and husband/wife relationships, house numbers, ages, phonetic
hashes) and seeds BOTH:
  1. Neo4j AuraDB — Person/House/Constituency/District/State/PollingStation
     graph, matching VOTER_GRAPH_SCHEMA in ms2's graph_service.py
  2. Postgres — verifies the geo lookup tables (states/districts/constituencies/
     polling_stations) that prisma/seedGeo.js already created, so /api/geo/*
     endpoints and the graph reference the SAME constituency/polling-station codes.

Purpose: unblock tonight's demo without depending on decoding the legacy
Kruti-Dev-encoded PDF. This is clearly synthetic data, not real records —
label it as such anywhere it surfaces in a demo.

Usage:
    pip install neo4j psycopg2-binary metaphone python-dotenv --break-system-packages
    python generate_and_seed.py --families 60 --dry-run     # preview only
    python generate_and_seed.py --families 60                # actually seed
    python generate_and_seed.py --families 60 --wipe         # wipe then seed

Env vars required (.env or exported):
    NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE (default "neo4j")
    DATABASE_URL   (Postgres connection string, same one ms1 uses)
─────────────────────────────────────────────────────────────────────────────
"""

import os
import argparse
import random
import logging
from dataclasses import dataclass
from typing import Optional

from dotenv import load_dotenv
from neo4j import GraphDatabase
import psycopg2
from metaphone import doublemetaphone

load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "ms2-agent", ".env"))
load_dotenv(override=False)  # root .env supplies DATABASE_URL; does NOT clobber neo4j creds above

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("seed")

# ── Name pools (culturally consistent with the Bharatpur/Rajasthan sample) ──
MALE_FIRST_NAMES = [
    "Suresh", "Ramesh", "Mahesh", "Rajesh", "Dinesh", "Ramlal", "Govind",
    "Kishan", "Mohan", "Prakash", "Gopal", "Vijay", "Ashok", "Devendra",
    "Surendra", "Narendra", "Ram Singh", "Arjun", "Bhagwan", "Chandan",
    "Girish", "Harish", "Jagdish", "Krishan", "Laxman", "Manoj", "Naresh",
    "Om Prakash", "Prem", "Ranjit", "Sanjay", "Tarachand", "Umesh", "Vinod",
]
FEMALE_FIRST_NAMES = [
    "Sunita", "Anita", "Kavita", "Rekha", "Sarita", "Meera", "Radha",
    "Savitri", "Kamla", "Shanti", "Geeta", "Sarla", "Kanta", "Vimla",
    "Pushpa", "Usha", "Nirmala", "Sushila", "Lalita", "Santosh Devi",
    "Kaushalya", "Maya", "Sita", "Urmila", "Prem Lata", "Chanda", "Gita",
]
SURNAMES = [
    "Sharma", "Verma", "Yadav", "Chaudhary", "Gupta", "Singh", "Kumar",
    "Prajapati", "Meena", "Jatav", "Saini", "Gurjar", "Aggarwal",
]

GRANDFATHER_NAMES = MALE_FIRST_NAMES  # placeholder; no IS_FATHER_OF edge in schema


# ── Data model ───────────────────────────────────────────────────────────────
@dataclass
class SyntheticPerson:
    name: str
    age: int
    gender: str          # "M" | "F"
    voter_id: str
    house_number: str
    part_serial_no: int = 0
    father_name: Optional[str] = None    # name of a Person in the same house → IS_SON_OF
    husband_name: Optional[str] = None  # name of a Person in the same house → IS_WIFE_OF

    @property
    def phonetic_hash(self) -> str:
        primary, _ = doublemetaphone(self.name.split()[0])   # hash first word only
        return primary or ""


def random_name(gender: str) -> str:
    pool = MALE_FIRST_NAMES if gender == "M" else FEMALE_FIRST_NAMES
    return f"{random.choice(pool)} {random.choice(SURNAMES)}"


def make_voter_id(counter: int) -> str:
    # EPIC-style, namespaced "SYN/" so it can never be confused with a real ID
    return f"SYN/{counter:07d}"


def generate_family(house_number: str, id_counter: list) -> list:
    """
    Builds one family: father + mother + 1-3 sons (optionally married,
    giving daughters-in-law) + 0-2 daughters (no family-edge, per schema).
    """
    people = []

    father_age = random.randint(45, 70)
    father = SyntheticPerson(
        name=random_name("M"), age=father_age, gender="M",
        voter_id=make_voter_id(id_counter[0]), house_number=house_number,
        # grandfather is NOT a generated node — store only for label, not for a graph edge
        father_name=None,
    )
    id_counter[0] += 1
    people.append(father)

    mother_age = father_age - random.randint(2, 8)
    mother = SyntheticPerson(
        name=random_name("F"), age=max(18, mother_age), gender="F",
        voter_id=make_voter_id(id_counter[0]), house_number=house_number,
        husband_name=father.name,
    )
    id_counter[0] += 1
    people.append(mother)

    for _ in range(random.randint(1, 3)):
        son_age = random.randint(18, max(18, father_age - 20))
        son = SyntheticPerson(
            name=random_name("M"), age=son_age, gender="M",
            voter_id=make_voter_id(id_counter[0]), house_number=house_number,
            father_name=father.name,   # edge target = the father Person node above
        )
        id_counter[0] += 1
        people.append(son)

        # ~40% of adult sons have a wife living in the same house
        if son_age >= 21 and random.random() < 0.4:
            dil = SyntheticPerson(
                name=random_name("F"), age=son_age - random.randint(1, 5), gender="F",
                voter_id=make_voter_id(id_counter[0]), house_number=house_number,
                husband_name=son.name,
            )
            id_counter[0] += 1
            people.append(dil)

    # Daughters — present as residents but no IS_DAUGHTER_OF edge (schema limitation)
    for _ in range(random.randint(0, 2)):
        d_age = random.randint(18, max(18, father_age - 20))
        daughter = SyntheticPerson(
            name=random_name("F"), age=d_age, gender="F",
            voter_id=make_voter_id(id_counter[0]), house_number=house_number,
        )
        id_counter[0] += 1
        people.append(daughter)

    return people


# ── Geo config — must exactly match prisma/seedGeo.js ────────────────────────
# Confirmed from seedGeo.js:
#   State  : Maharashtra (code MH)
#   District: Pune (code PUN)
#   Constituency: Kothrud (code 210)
#   Polling stations: 101 (MIT College Room 1), 102 (Karve Nagar Vidyalaya)
GEO_CONFIG = {
    "state_name":         "Maharashtra",
    "district_name":      "Pune",
    "constituency_code":  "210",
    "constituency_name":  "Kothrud",
    "polling_stations": [
        {"number": "101", "name": "MIT College Room 1"},
        {"number": "102", "name": "Karve Nagar Vidyalaya"},
    ],
}


def build_dataset(num_families: int, start_house: int) -> list:
    id_counter = [1]
    people = []
    house_num = start_house
    for _ in range(num_families):
        people.extend(generate_family(str(house_num), id_counter))
        house_num += random.randint(1, 3)
    return people


def assign_polling_stations(people: list) -> dict:
    """Distributes houses evenly across the configured polling stations and assigns serial numbers."""
    houses = sorted({p.house_number for p in people}, key=int)
    stations = GEO_CONFIG["polling_stations"]
    house_ps_map = {h: stations[i % len(stations)]["number"] for i, h in enumerate(houses)}
    
    # Assign part_serial_no sequentially per polling station
    serial_counters = {s["number"]: 1 for s in stations}
    for p in people:
        ps = house_ps_map[p.house_number]
        p.part_serial_no = serial_counters[ps]
        serial_counters[ps] += 1
        
    return house_ps_map


# ── Postgres verification (NOT insertion) ────────────────────────────────────
# prisma/seedGeo.js already populated these tables. We verify the codes match
# so the demo doesn't silently have a broken Postgres↔Neo4j join.
# Table names use Prisma's @@map values (lowercase), not the model name.
def verify_postgres_geo(dry_run: bool):
    if dry_run:
        logger.info("[DRY RUN] Skipping Postgres verification.")
        return

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.warning(
            "DATABASE_URL not set — skipping Postgres verification. "
            "Neo4j seeding will still proceed."
        )
        return

    try:
        conn = psycopg2.connect(database_url)
        cur = conn.cursor()

        # @@map("constituencies") → table name is constituencies (lowercase)
        cur.execute(
            'SELECT id FROM "constituencies" WHERE code = %s',
            (GEO_CONFIG["constituency_code"],),
        )
        row = cur.fetchone()
        cur.close()
        conn.close()

        if row is None:
            raise RuntimeError(
                f"Constituency code '{GEO_CONFIG['constituency_code']}' "
                f"({GEO_CONFIG['constituency_name']}) was NOT found in Postgres.\n"
                f"Run `node prisma/seedGeo.js` first, then re-run this script."
            )

        logger.info(
            f"✅ Postgres verified: constituency '{GEO_CONFIG['constituency_code']}' "
            f"({GEO_CONFIG['constituency_name']}) exists — Neo4j data will reference it correctly."
        )

    except psycopg2.errors.UndefinedTable as e:
        logger.warning(
            f"Postgres table name mismatch: {e}. "
            "The geo tables may not yet exist — run `node prisma/seedGeo.js` first. "
            "Proceeding with Neo4j seeding anyway."
        )
    except Exception as e:
        logger.warning(f"Postgres verification skipped due to error: {e}. Proceeding with Neo4j seeding.")


# ── Neo4j writer ──────────────────────────────────────────────────────────────
def seed_neo4j(people: list, house_ps_map: dict, dry_run: bool, wipe: bool):
    if dry_run:
        logger.info(f"[DRY RUN] Would write {len(people)} Person nodes to Neo4j.")
        logger.info(f"[DRY RUN] Unique houses: {len({p.house_number for p in people})}")
        return

    uri      = os.getenv("NEO4J_URI")
    user     = os.getenv("NEO4J_USERNAME")
    password = os.getenv("NEO4J_PASSWORD")
    database = os.getenv("NEO4J_DATABASE", "neo4j")

    if not all([uri, user, password]):
        raise RuntimeError("Missing NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD in environment.")

    driver = GraphDatabase.driver(uri, auth=(user, password))

    with driver.session(database=database) as session:

        # ── Optional wipe of SYNTHETIC data only ─────────────────────────────
        if wipe:
            logger.warning("--wipe flag set: deleting all nodes with voter_id starting 'SYN/'...")
            result = session.run("""
                MATCH (p:Person)
                WHERE p.voter_id STARTS WITH 'SYN/'
                DETACH DELETE p
            """)
            logger.info("✅ Synthetic Person nodes wiped.")
            # Also wipe orphaned Houses left from synthetic data
            session.run("""
                MATCH (h:House)
                WHERE NOT (h)<-[:LIVES_IN]-()
                DETACH DELETE h
            """)
            logger.info("✅ Orphaned House nodes wiped.")

        # ── Budget safety check ───────────────────────────────────────────────
        counts = session.run("MATCH (n) RETURN count(n) AS nodeCount").single()
        current_nodes = counts["nodeCount"]
        estimated_new = len(people) + len({p.house_number for p in people})
        logger.info(
            f"Current Neo4j node count: {current_nodes}. "
            f"Estimated new nodes: {estimated_new}. "
            f"Projected total: {current_nodes + estimated_new}."
        )
        if current_nodes + estimated_new > 200_000 * 0.9:
            raise RuntimeError(
                "This write would approach the AuraDB Free tier budget "
                "(200k nodes, 90% safety margin). Aborting. Reduce --families."
            )

        # ── Geo skeleton (idempotent MERGE) ───────────────────────────────────
        session.run("""
            MERGE (s:State {name: $state})
            MERGE (d:District {name: $district})
            MERGE (d)-[:LOCATED_IN]->(s)
            MERGE (c:Constituency {code: $code, name: $cname})
            MERGE (c)-[:LOCATED_IN]->(d)
        """,
            state=GEO_CONFIG["state_name"],
            district=GEO_CONFIG["district_name"],
            code=GEO_CONFIG["constituency_code"],
            cname=GEO_CONFIG["constituency_name"],
        )

        for ps in GEO_CONFIG["polling_stations"]:
            session.run("""
                MATCH (c:Constituency {code: $code})
                MERGE (ps:PollingStation {number: $number, constituency_code: $code})
                  ON CREATE SET ps.name = $name
                MERGE (ps)-[:PART_OF]->(c)
            """,
                code=GEO_CONFIG["constituency_code"],
                number=ps["number"],
                name=ps["name"],
            )
        logger.info("✅ Geo skeleton merged (State → District → Constituency → PollingStation).")

        # ── Pass 1: Person + House + LIVES_IN + BELONGS_TO ────────────────────
        batch = [
            {
                "voter_id":     p.voter_id,
                "name":         p.name,
                "age":          p.age,
                "gender":       p.gender,
                "phonetic_hash": p.phonetic_hash,
                "part_serial_no": p.part_serial_no,
                "house_number": p.house_number,
                "ps_number":    house_ps_map[p.house_number],
            }
            for p in people
        ]

        session.run("""
            UNWIND $rows AS row
            MERGE (p:Person {voter_id: row.voter_id})
              ON CREATE SET
                p.name          = row.name,
                p.age           = row.age,
                p.gender        = row.gender,
                p.phonetic_hash = row.phonetic_hash,
                p.part_serial_no = row.part_serial_no
            MERGE (h:House {number: row.house_number, ward: $code})
            MERGE (p)-[:LIVES_IN]->(h)
            WITH h, row
            MATCH (ps:PollingStation {number: row.ps_number, constituency_code: $code})
            MERGE (h)-[:BELONGS_TO]->(ps)
        """, rows=batch, code=GEO_CONFIG["constituency_code"])
        logger.info(f"✅ Pass 1 complete: {len(people)} Person nodes + House/PollingStation links.")

        # ── Pass 2: Family relationships ──────────────────────────────────────
        # Build name→voter_id lookup per-house (names unique within a synthetic family)
        by_house: dict = {}
        for p in people:
            by_house.setdefault(p.house_number, []).append(p)

        wife_rels = []
        son_rels  = []
        for members in by_house.values():
            name_to_id = {m.name: m.voter_id for m in members}
            for m in members:
                if m.husband_name and m.husband_name in name_to_id:
                    wife_rels.append({
                        "child_id":  m.voter_id,
                        "parent_id": name_to_id[m.husband_name],
                    })
                elif m.father_name and m.father_name in name_to_id:
                    son_rels.append({
                        "child_id":  m.voter_id,
                        "parent_id": name_to_id[m.father_name],
                    })

        if wife_rels:
            session.run("""
                UNWIND $rows AS row
                MATCH (w:Person {voter_id: row.child_id})
                MATCH (h:Person {voter_id: row.parent_id})
                MERGE (w)-[:IS_WIFE_OF]->(h)
            """, rows=wife_rels)

        if son_rels:
            session.run("""
                UNWIND $rows AS row
                MATCH (s:Person {voter_id: row.child_id})
                MATCH (f:Person {voter_id: row.parent_id})
                MERGE (s)-[:IS_SON_OF]->(f)
            """, rows=son_rels)

        logger.info(
            f"✅ Pass 2 complete: {len(wife_rels)} IS_WIFE_OF + {len(son_rels)} IS_SON_OF edges."
        )

    driver.close()


# ── CLI ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Generate and seed synthetic electoral roll data for VoterGraph.ai demo."
    )
    parser.add_argument(
        "--families", type=int, default=60,
        help="Number of synthetic families to generate (~4-6 people each, default: 60)"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Preview counts only — no writes to Neo4j or Postgres"
    )
    parser.add_argument(
        "--wipe", action="store_true",
        help="Delete all SYN/* Person nodes from Neo4j before seeding (idempotent re-seed)"
    )
    args = parser.parse_args()

    start_house = 100
    if not args.dry_run:
        uri      = os.getenv("NEO4J_URI")
        user     = os.getenv("NEO4J_USERNAME")
        password = os.getenv("NEO4J_PASSWORD")
        database = os.getenv("NEO4J_DATABASE", "neo4j")
        if all([uri, user, password]):
            try:
                driver = GraphDatabase.driver(uri, auth=(user, password))
                with driver.session(database=database) as session:
                    res = session.run("MATCH (h:House) RETURN max(toInteger(h.number)) AS maxH").single()
                    if res and res["maxH"] is not None:
                        start_house = res["maxH"] + 10
                driver.close()
            except Exception as e:
                logger.warning(f"Failed to fetch max house number, defaulting to 1000. Error: {e}")
                start_house = 1000
    else:
        start_house = 1000

    logger.info(f"⚙️  Generating {args.families} synthetic families starting from house {start_house}...")
    people = build_dataset(args.families, start_house)
    house_ps_map = assign_polling_stations(people)

    unique_houses    = len({p.house_number for p in people})
    unique_voter_ids = len({p.voter_id for p in people})
    logger.info(
        f"📊 Dataset: {len(people)} people | {unique_houses} houses | "
        f"{unique_voter_ids} voter IDs | "
        f"{len(GEO_CONFIG['polling_stations'])} polling stations"
    )

    # Step 1: Verify Postgres geo codes exist (read-only)
    verify_postgres_geo(args.dry_run)

    # Step 2: Write to Neo4j
    seed_neo4j(people, house_ps_map, args.dry_run, args.wipe)

    # Step 3: Sample preview
    logger.info("🔍 Sample records (first 5):")
    for p in people[:5]:
        rels = []
        if p.husband_name:
            rels.append(f"IS_WIFE_OF({p.husband_name})")
        if p.father_name:
            rels.append(f"IS_SON_OF({p.father_name})")
        logger.info(
            f"  {p.voter_id} | {p.name} | age {p.age} | {p.gender} | "
            f"house {p.house_number} | phonetic={p.phonetic_hash} | "
            f"rels={rels or 'none'}"
        )

    if not args.dry_run:
        logger.info(
            "\n✅ Seeding complete! To verify in Neo4j Browser:\n"
            "  MATCH (p:Person) WHERE p.voter_id STARTS WITH 'SYN/' RETURN p LIMIT 20\n"
            "  MATCH (p:Person)-[:IS_SON_OF]->(f:Person) RETURN p,f LIMIT 10\n"
            "  MATCH (p:Person)-[:LIVES_IN]->(h:House)-[:BELONGS_TO]->(ps:PollingStation) "
            "RETURN p.name, h.number, ps.number LIMIT 10"
        )
    else:
        logger.info("\n[DRY RUN] No data written. Remove --dry-run to actually seed.")


if __name__ == "__main__":
    main()
