# Product Note

## Additional Client Problem: Both Addressed

### Problem 1: Proactive Issue Detection

**Approach:** Built an internal Operations Dashboard (`/api/proactive-alerts`) that automatically scans the entire ticket and order database to surface issues before anyone asks about them.

**What it detects:**
- **SLA breaches** — Scans all open tickets against plan-specific and agreement-specific SLA targets. Northstar's custom 15-minute P1 SLA is enforced separately from standard Enterprise targets.
- **Known issue matching** — Automatically links open tickets to known bugs (KI-208: bulk upload failures, KI-211: SwiftShip webhook delays) by scanning ticket subject/description content.
- **Security incidents** — Flags tickets mentioning API key exposure or credential issues as CRITICAL alerts.
- **Carrier-fault pickup delays** — Identifies BOOKED orders that have exceeded their pickup window with carrier fault, and suggests service credit application.

**Why it matters:** A reactive chatbot only helps when someone knows to ask. The proactive dashboard surfaces the 3-4 most important issues across all accounts, helping a 20-person team prioritize their morning workflow instead of manually scanning hundreds of tickets.

### Problem 2: Trust and Reliability

**Approach:** Implemented a source precedence hierarchy enforced at the tool and data layer, not just in prompt instructions.

**Key decisions:**
- **Source ranking:** Signed agreements always override general policies. Current policies override deprecated versions. Historical ticket resolutions are labeled "context only" and are explicitly flagged when they conflict with authoritative sources.
- **Conflict surfacing:** When the system detects a conflict (e.g., TKT-450's incorrect fee claim vs. Northstar's agreement), it proactively surfaces both the correct answer and the reason the historical resolution was wrong.
- **Graceful uncertainty:** When the system cannot confidently answer from available sources, it offers to escalate to a human rather than guessing.
- **Dual engine resilience:** If the AI model produces an error or is unavailable, the deterministic fallback engine ensures consistent, verifiable answers.

**Why it matters:** A single confidently wrong answer about a cancellation fee or SLA target could cost ParcelPilot customer trust and potentially real money. The source precedence system makes the system's reasoning auditable.

---

## What Else I Would Build for ParcelPilot

### Priority 1: Persistent Database + Audit Trail
**Why:** The current in-memory store loses state on restart. A real deployment needs PostgreSQL (or similar) with a full audit trail of every action taken — who approved what credit, when a ticket was escalated, etc. This is essential for compliance and post-incident review.

### Priority 2: Vector Embedding Search (RAG)
**Why:** Keyword search works for 6 documents but won't scale. Using embeddings (e.g., Gemini Embedding API) with a vector store would enable semantic search across growing policy documentation, historical tickets, and customer communications.

### Priority 3: Multi-Turn Conversation Memory
**Why:** The current system passes chat history to Gemini but the local fallback engine is stateless. A proper conversation memory system would enable follow-up questions like "What about ORD-1002?" after asking about cancellation policy.

### Priority 4: Automated Escalation Workflows
**Why:** Currently, escalation is a status update. A production system should trigger actual notifications — Slack messages to CSMs, email alerts, PagerDuty for P1 incidents, and auto-assignment based on the CSM field in account data.

### Priority 5: Analytics and Reporting
**Why:** Track resolution times, agent accuracy, escalation rates, and customer satisfaction. This data would help ParcelPilot understand whether the AI system is actually reducing support load or if certain query types consistently require human intervention.

---

## What I Intentionally Left Out

1. **User authentication** — Mocked via a dropdown instead of implementing OAuth/JWT. The assessment spec says mock auth is acceptable, and real auth would add complexity without demonstrating AI capabilities.

2. **Vector embeddings / RAG pipeline** — With only 6 documents totaling ~50 pages, keyword search with frequency scoring is sufficient and more predictable. Full context injection into Gemini's 1M token window is actually more reliable than chunked retrieval for this corpus size.

3. **Database persistence** — Used in-memory storage to keep the assessment self-contained (no database setup required). Noted the trade-off in the architecture note.

4. **Rate limiting and error handling at scale** — Not production-hardened. Acceptable for an assessment prototype.

---

## Success Metric

**First-contact resolution rate** — the percentage of customer queries that are fully resolved by the AI agent without requiring human escalation.

**Why this metric:** It directly measures whether the product is useful. A high FCR means the system is confidently answering questions correctly. A low FCR could mean:
- The system's knowledge base has gaps (need more documents)
- Source conflicts are causing uncertainty (need better conflict resolution)
- Customers are asking questions outside the system's scope (need to expand tool capabilities)

This metric also naturally captures trust — if the system escalates too aggressively (low confidence), FCR drops. If it answers incorrectly and customers re-contact support, FCR also drops when measured against eventual resolution.

**Target:** >70% FCR within the first month of deployment for Tier 1 queries (account entitlements, cancellation policies, SLA inquiries).

---

## AI Tool Usage

I used the following AI coding tools during this assessment:

- **Google Gemini (Antigravity IDE / Claude)** — Used as a pair-programming assistant for:
  - Scaffolding the initial project structure
  - Writing boilerplate code (API routes, React component structure)
  - Debugging deployment configuration (Vercel serverless setup)
  - Creating documentation (this product note, architecture note, README)
  
- **Gemini 1.5 Flash** — Integrated into the application itself as the primary conversational AI engine

All core logic — tool implementations, source precedence rules, access control enforcement, proactive alert algorithms, and the deterministic fallback engine — was designed and implemented with my own reasoning about the assessment requirements and data pack contents.
