# AI Advent Challenge

A Next.js + TypeScript playground for building an AI assistant step by step through the AI Advent Challenge.

The project started as small isolated LLM experiments and is now evolving into one practical assistant. Each day adds a visible feature and a small piece of agent architecture: API access, output control, reasoning, model evaluation, memory, token tracking, compression, branching, file-backed long-term context, personalization, and task orchestration.

## Current Stage

The current build has two practical surfaces:

- the unified assistant, with file-backed memory, profile learning, task lifecycle orchestration, MCP discovery, a custom Git MCP tool, and the Day 18-20 MCP scheduler/briefing/workflow chain;
- the `/rag` toolkit for Days 21-25, with document ingestion, fixed-vs-structural indexing, RAG querying, rerank/filter controls, cited answers, and a small RAG chat with task memory.

Day 21 now uses an explicit source workflow. The UI starts with an empty **Sources to index** list, lets the user add uploads, URLs, site crawls, GitHub URLs, or server-local paths, and shows **Indexed sections** only after a real index build. The backend still keeps CLI/API fallback sources for repeatable demos and automated `rag:all` checks.

## Progress

- Day 1: built the baseline OpenAI-compatible API request flow and proved the app can call an external LLM provider from a clean Next.js UI.
- Day 2: added response-format controls to compare free-form answers with constrained output, including token limits and stop sequences.
- Day 3: compared reasoning patterns for the same task, including direct answering, step-by-step reasoning, generated prompts, and expert-style roles.
- Day 4: analyzed temperature as a model behavior lever by running the same prompt across deterministic and more creative settings.
- Day 5: compared weak, medium, and strong models by quality, latency, token usage, and provider cost to make model choice visible.
- Day 6: introduced a first agent loop with a system role and traceable execution, moving from raw chat calls toward agent behavior.
- Day 7: added persistent conversation memory so the assistant can reuse prior context across turns instead of treating each request as isolated.
- Day 8: built a chat lab for token and cost analysis, making context growth measurable across multi-turn dialogs.
- Day 9: added context compression, where older messages are summarized and recent messages stay live in the prompt.
- Day 10: explored context strategies under the hood, including sliding windows, sticky facts, and branch-based topic separation.
- Day 11: merged compression, branching, and memory layers into the main assistant with editable JSON/Markdown-backed memory files.
- Day 12: added full user profile management, language-agnostic confirmed profile update suggestions, profile-scoped prompt context, memory folder moves, and global metrics so personalization and memory behavior are visible and testable.
- Day 13-15: combined the task-state, invariant, swarm, and transition-control assignments into one unified assistant upgrade: an internal lifecycle-only task orchestrator routes every user turn through stage-local agents, runs a planning swarm, injects active-dialog and task-local invariants, checks stage artifacts through semantic gates instead of keyword rules, validates before completion, and stores task state in the file-backed memory model.
- Day 16: added MCP tool discovery by connecting an SDK client to the existing filesystem MCP server over stdio and showing the returned tool list inside the unified assistant.
- Day 17: added a custom Git MCP server with a read-only `get_repository_status` tool, an API route and UI panel for direct calls, and automatic injection of Git MCP results into the unified assistant when project status is relevant.
- Day 18: added a generic MCP scheduler that can scan a local message export on demand or on a schedule and persist a briefing cache.
- Day 19: added a briefing MCP tool chain that extracts relevant cached messages, builds a challenge digest, and saves JSON/Markdown outputs.
- Day 20: orchestrated multiple MCP servers into one visible workflow that refreshes the scheduler, builds the digest, reads it through filesystem MCP, checks Git status, and saves a workflow report.
- Day 21: added the RAG document indexer with upload/URL/site/GitHub/local-path sources, fixed and structural chunking, local hash embeddings, index artifacts, and reset support.
- Day 22: added the first RAG query tool that compares plain answers with retrieved-context answers, parses PDF sources into readable text, and shows model presets only for live LLM generation.
- Day 23: added query rewriting, similarity thresholding, and MMR reranking for cleaner retrieval.
- Day 24: added cited answers with source quotes and an anti-hallucination fallback to `не знаю` when context is weak.
- Day 25: added a small RAG chat that keeps task state and returns sources/citations on every assistant turn.

## Architecture Notes

- [Day 13-15 orchestrated task lifecycle](docs/day-13.md)
- [Day 16 MCP tool discovery](docs/day-16.md)
- [Day 17 custom Git MCP tool](docs/day-17.md)
- [Day 18 MCP scheduler](docs/day-18.md)
- [Day 19 briefing MCP chain](docs/day-19.md)
- [Day 20 cross-MCP workflow](docs/day-20.md)
- [Day 21 RAG indexing](docs/day-21.md)
- [Day 22 first RAG query](docs/day-22.md)
- [Day 23 rerank and filtering](docs/day-23.md)
- [Day 24 citations and anti-hallucination](docs/day-24.md)
- [Day 25 RAG chat](docs/day-25.md)

## Run Locally

Install dependencies:

```bash
npm install
```

Create local environment variables:

```bash
cp .env.example .env.local
```

Configure an OpenAI-compatible provider, for example OpenRouter:

```bash
OPENAI_COMPATIBLE_BASE_URL=https://openrouter.ai/api/v1
OPENAI_COMPATIBLE_API_KEY=your_key
DEFAULT_MODEL=openai/gpt-4o
MODEL_WEAK=meta-llama/llama-3.2-1b-instruct
MODEL_MEDIUM=qwen/qwen3-32b
MODEL_STRONG=qwen/qwen3-235b-a22b-thinking-2507
NEXT_PUBLIC_MODEL_WEAK=meta-llama/llama-3.2-1b-instruct
NEXT_PUBLIC_MODEL_MEDIUM=qwen/qwen3-32b
NEXT_PUBLIC_MODEL_STRONG=qwen/qwen3-235b-a22b-thinking-2507
```

Start the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

Open `http://localhost:3000/rag` for the Day 21-25 RAG toolkit.

Day 16 MCP discovery uses the locally installed `@modelcontextprotocol/server-filesystem` package and grants it access only to the repository root. It lists tools but does not call them.

Day 17 adds a custom stdio MCP server at `mcp/day17-git-server.mjs`. Its `get_repository_status` tool reads local Git state only: branch, changed files, and recent commits. The MCP tool provides data; the assistant performs the analysis and recommendation.

Day 21-25 RAG scripts:

```bash
npm run rag:day21
npm run rag:day22
npm run rag:day23
npm run rag:day24
npm run rag:day25
npm run rag:all
```

RAG data is stored under `.data/rag-week`, including indexes, reports, evaluations, chat state, uploaded files, source records, and artifacts. This local data is intentionally ignored by Git. After changing PDF extraction or replacing sources, use **Build indexes** with rebuild enabled or **Reset RAG data** so old chunks are regenerated.

## Checks

Before committing a completed day:

```bash
npm run lint
npm run build
```

For the RAG toolkit, run the full validation suite:

```bash
npm run test:all
```

Do not commit `.env.local`, `.data`, `.next`, `node_modules`, or log files.
