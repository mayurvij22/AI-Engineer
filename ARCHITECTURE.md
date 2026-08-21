# Architecture Note

## Overview

ParcelPilot's AI Support System is a full-stack application with a React frontend and a Python FastAPI backend. It supports two user contexts — **customer-facing** and **internal operations** — with a shared backend that enforces access control at the data layer.

```
┌────────────────────────────────────────────────────┐
│                    Frontend (React)                 │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Customer │  │   Internal   │  │    Ops       │  │
│  │   Chat   │  │     Chat     │  │  Dashboard   │  │
│  └────┬─────┘  └──────┬───────┘  └──────┬───────┘  │
└───────┼────────────────┼────────────────┼──────────┘
        │                │                │
        ▼                ▼                ▼
┌────────────────────────────────────────────────────┐
│              FastAPI Backend (/api/*)               │
│  ┌──────────────────────────────────────────────┐  │
│  │            AI Agent Router                    │  │
│  │   ┌─────────────┐   ┌────────────────────┐   │  │
│  │   │ Gemini 1.5  │   │  Local Fallback    │   │  │
│  │   │   Flash     │──▶│  Reasoning Engine  │   │  │
│  │   │  (primary)  │   │  (deterministic)   │   │  │
│  │   └─────────────┘   └────────────────────┘   │  │
│  └─────────────────────┬────────────────────────┘  │
│                        │                            │
│  ┌─────────────────────▼────────────────────────┐  │
│  │              Tool Layer (7 tools)             │  │
│  │  ┌────────────┐ ┌──────────┐ ┌────────────┐  │  │
│  │  │  Document  │ │Structured│ │   State-   │  │  │
│  │  │  Search    │ │   Data   │ │  Changing  │  │  │
│  │  │            │ │  Lookup  │ │  Actions   │  │  │
│  │  └────────────┘ └──────────┘ └────────────┘  │  │
│  └──────────────────────────────────────────────┘  │
│                        │                            │
│  ┌─────────────────────▼────────────────────────┐  │
│  │           Data Store (In-Memory)              │  │
│  │  ┌────────────┐  ┌───────────────────────┐   │  │
│  │  │   Excel    │  │    PDF Documents      │   │  │
│  │  │ (accounts, │  │  (policies, SOPs,     │   │  │
│  │  │  orders,   │  │   agreements)         │   │  │
│  │  │  tickets)  │  │                       │   │  │
│  │  └────────────┘  └───────────────────────┘   │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

## Agent Design

The AI agent uses a **hybrid architecture** with two reasoning engines:

### 1. Gemini 1.5 Flash (Primary)
When a valid API key is provided, the agent uses Google's Gemini 1.5 Flash model with a carefully structured prompt that includes:
- **System instruction** with source precedence rules, access control rules, and confirmation requirements
- **User-scoped data context** — only the accounts, orders, tickets, and documents the user is authorized to see
- **Injected tool results** — before calling the LLM, the agent pre-computes relevant calculations (cancellation assessments, service credit calculations) and injects them as verified facts into the prompt

This "**Compute-then-Reason**" pattern ensures the LLM reasons over verified data rather than attempting arithmetic itself, which dramatically reduces hallucination on numerical questions.

### 2. Local Fallback Engine (Deterministic)
When no API key is available (or the Gemini call fails), the agent falls back to a keyword-matching engine that:
- Parses the user query for intent (cancellation, credit, SLA, general)
- Extracts entity IDs (ORD-*, TKT-*)
- Calls the appropriate tool functions directly
- Formats structured responses with citations and source authorities

This ensures the application is **fully functional with zero external dependencies**.

## Tool Design

All 7 tools follow consistent design principles:

1. **Ownership verification first** — Every tool that accesses order or ticket data calls `check_order_ownership()` or `check_ticket_ownership()` before proceeding. This enforces access control at the tool layer, not just at the prompt layer.

2. **Two-phase actions** — State-changing tools accept a `confirmed` parameter:
   - `confirmed=False`: Returns an action summary for user review
   - `confirmed=True`: Executes the mutation

3. **Source citation** — Every calculation result includes a `rule_applied` field citing the exact document and section (e.g., "Northstar Logistics Enterprise Agreement Section 2").

4. **Custom agreement detection** — Tools check for account-specific contract overrides before applying standard SOP rules.

### Tool Inventory

| Tool | Category | Purpose |
|------|----------|---------|
| `search_documents` | Retrieval | Keyword search across policies, SOPs, and agreements with relevance scoring |
| `cancel_order_assessment` | Calculation | Evaluates cancellation eligibility, fees, and applicable rules |
| `calculate_service_credit` | Calculation | Computes service credit eligibility, delay hours, credit amount |
| `escalate_ticket` | Action | Escalates a ticket to P1 priority |
| `update_ticket_status` | Action | Updates ticket status |
| `apply_service_credit` | Action | Applies a computed credit to an order |
| `cancel_order_execute` | Action | Cancels an order with the computed fee |

## Document and Structured-Data Handling

### Structured Data (Excel)
- Loaded at startup via `openpyxl` from `ParcelPilot_Assessment_Data.xlsx`
- Three sheets: `accounts`, `orders`, `tickets`
- Stored in-memory as Python lists of dictionaries
- Queried by ID lookup and filtered by `account_id` for access scoping

### Policy Documents (PDFs)
- 6 PDF files loaded via `pypdf`, full text extracted
- Stored in an in-memory dictionary keyed by filename
- Searched via keyword frequency scoring with snippet extraction
- Access-scoped: customer agreements are filtered by the customer's `contract_file` field

## Source Reliability and Conflict Handling

The system implements a strict source precedence hierarchy:

| Priority | Source Type | Example |
|----------|-----------|---------|
| 1 (highest) | Signed Customer Agreements | Northstar Enterprise Agreement, LumenWorks Service Agreement |
| 2 | Current Policies (v3/v4) | Support Policy v3, SOP v4 |
| 3 | Product Operations Guide | Known Issues, Operations procedures |
| 4 (lowest) | Historical Ticket Resolutions | Past agent answers (treated as context only, may be wrong) |

**Conflict resolution example:** Historical ticket TKT-450 claims a INR 250 fee applies to Northstar after 30 minutes. However, the signed Northstar Enterprise Agreement Section 2 waives all cancellation fees before pickup. The system correctly applies the agreement (Priority 1) and explicitly flags the historical resolution as incorrect.

## Major Technical Trade-offs

| Decision | Trade-off | Rationale |
|----------|-----------|-----------|
| **In-memory data store** vs. database | Data doesn't persist across serverless cold starts | Acceptable for assessment scope; production would use a database |
| **Keyword search** vs. vector embeddings | Lower recall on semantically similar but lexically different queries | Simpler, no embedding infrastructure needed; adequate for the 6-document corpus |
| **Compute-then-Reason** vs. LLM function calling | Less flexible tool selection | More reliable numerical accuracy; tool choice is deterministic |
| **Dual engine** (Gemini + local) | Maintenance of two code paths | Ensures zero-dependency operation; demonstrates both AI and engineering skills |
| **Full context injection** vs. RAG chunking | Token-expensive for large document sets | With only 6 documents, full context fits within Gemini's context window and eliminates retrieval errors |
