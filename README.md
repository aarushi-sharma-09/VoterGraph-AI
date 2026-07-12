# VoterGraph.ai 🏛️🕸️
**GraphRAG Civic Intelligence & Electoral Roll Architecture**
*Built for the Programming Pathshala Capstone Build Series*

---

## 📌 Executive Summary
In India, historical civic and electoral records—such as the 2002 municipal voter rolls—are fragmented across millions of unstructured pages and legacy databases. When users attempt to search these records using modern AI, standard Vector RAG (Retrieval-Augmented Generation) pipelines fail catastrophically: cosine similarity in vector databases is mathematically incapable of precise relational matching, frequently hallucinating names, house numbers, and family linkages. Furthermore, historical Indian datasets suffer from severe English transliteration inconsistencies (e.g., *Choudhary* vs. *Chowdhary*, *Mukherji* vs. *Mukherjee*), rendering exact-match keyword searches useless.

**VoterGraph.ai** is a deterministic civic intelligence platform built on **GraphRAG (Neo4j + LangGraph)**. Instead of dumping documents into a vector database, an offline ingestion pipeline converts unstructured civic records into a connected mathematical knowledge graph (`Person`, `House`, and `Constituency` nodes linked by explicit relational edges). To solve transliteration friction, every node is indexed with phonetic hashes (**Double Metaphone**) at load time. When a user queries the platform in natural language, a stateful LangGraph agent dynamically translates the prompt into a **Neo4j Cypher query**, executes exact multi-hop relational traversal, and synthesizes a zero-hallucination answer backed by visual graph evidence.

---

## 🏛️ System Architecture
The platform is built as a cloud-native, polyglot microservice architecture within a unified Git monorepo.

```text
[ Citizen / Admin UI ]  ---> ( React + Tailwind CSS )
          │
          ▼  [ HTTP / REST ]
[ System of Record ]    ---> ( Express.js / Node.js - ms1-core )
          │                  ├── PostgreSQL (User Auth, JWTs, Chat Sessions)
          │                  └── AWS SES (PDF Lineage Proof Dispatch)
          ▼  [ Internal HTTP / JSON ]
[ Graph AI Brain ]      ---> ( FastAPI / Python - ms2-agent )
                             ├── LangGraph / LangChain (Stateful AI Agent)
                             ├── Double Metaphone (Phonetic Indexing Engine)
                             └── Neo4j AuraDB (Graph Database Traversal)
```



# Core Microservices

## Frontend (React / Next.js)
- Responsive web interface featuring Citizen and Civic Admin portals.
- Renders conversational AI threads alongside an interactive "Explore Graph Evidence" drawer that displays executed Cypher logic and relational node maps.

## ms1-core (Express.js / Node.js)
- The relational system of record.
- Enforces Role-Based Access Control (citizen vs. civic_admin) via custom JWT authentication and bcrypt hashing.
- Manages multi-turn conversational session history in PostgreSQL.
- Compiles retrieved graph trees into official PDF lineage reports dispatched via AWS SES.

## ms2-agent (FastAPI / Python)
- The AI orchestration and graph engine.
- Houses the offline ingestion pipeline using pdfplumber and jellyfish to compute Double Metaphone phonetic hashes.
- Implements cyclic LangGraph state machines: Text-to-Cypher translation, execution, and an Ambiguity Resolution Node that pauses to ask users clarifying questions if duplicate names collide.

## 🗄️ Database Schemas (Dual-Database Design)

### 1. Relational Database: PostgreSQL (ms1-core)
Used exclusively for transactional user accounts, security, and session persistence.

#### users Table:
- **id** : UUID (Primary Key)
- **email** : String (Unique, Indexed)
- **password_hash** : String (Bcrypt)
- **role** : Enum (citizen, civic_admin)
- **created_at** : Timestamp

#### sessions Table:
- **id** : UUID (Primary Key)
- **user_id** : UUID (Foreign Key -> users.id)
- **title** : String
- **chat_history** : JSONB (Stores multi-turn user/assistant messages)
- **created_at** : Timestamp

### 2. Knowledge Graph: Neo4j AuraDB (ms2-agent)
Used exclusively for civic entities and multi-generational lineage traversal.

#### Nodes:
- `(:Person { name: String, age: Integer, gender: String, phonetic_hash: String, voter_id: String })`
- `(:House { number: String, ward: String })`
- `(:Constituency { name: String, code: String })`

#### Relational Edges:
- `(:Person)-[:LIVES_IN]->(:House)`
- `(:Person)-[:IS_SON_OF]->(:Person)`
- `(:Person)-[:IS_WIFE_OF]->(:Person)`
- `(:House)-[:BELONGS_TO]->(:Constituency)`

## 🛠️ Technology Stack & Mandated Infrastructure
- **Frontend**: React (Vite) / Next.js App Router, Tailwind CSS, Axios / Fetch API.
- **Backend API (ms1)**: Node.js, Express.js, Prisma ORM, JSON Web Tokens (JWT), Bcrypt, AWS SDK (SES).
- **Backend AI (ms2)**: Python 3.10+, FastAPI, Uvicorn, LangGraph, LangChain (GraphCypherQAChain), Neo4j Python Driver, Jellyfish (Double Metaphone), Pydantic.
- **Databases**: PostgreSQL 15, Neo4j AuraDB (Cloud) / Neo4j 5.x Community.
- **DevOps & Cloud**: Docker, Docker Compose, AWS EC2, NGINX Reverse Proxy (Let's Encrypt HTTPS / TLS Termination), GitHub Actions CI/CD.
- **Observability**: OpenTelemetry (OTel) distributed latency and LLM token tracing.

## 🚀 Local Development Setup

### Prerequisites
- Node.js (v18+)
- Python (v3.10+)
- Docker Desktop
- A free Neo4j AuraDB cloud instance.

### 1. Clone & Boot Infrastructure
Clone the repository and start the isolated PostgreSQL database container using Docker Compose:

```bash
git clone https://github.com/YourUsername/VoterGraph-AI.git
cd VoterGraph-AI
docker-compose up -d

# Start ms1 (Node/Express API)
cd ms1-core
npm install
npm run dev

# Start ms2 (Python/FastAPI Agent)
cd ../ms2-agent
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

Access the UI at http://localhost:3001
