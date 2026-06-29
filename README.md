# AI Advent Challenge

A Next.js + TypeScript playground for building an AI assistant step by step through the AI Advent Challenge.

The project started as small isolated LLM experiments and is now evolving into one practical assistant. Each day adds a visible feature and a small piece of agent architecture: API access, output control, reasoning, model evaluation, memory, token tracking, compression, branching, file-backed long-term context, personalization, and task orchestration.

## Current Stage

The current build is a unified assistant with automatic topic branches, context compression, global metrics, file-backed memory, manageable user profiles, language-agnostic profile-learning suggestions, lifecycle-only orchestration, MCP tool discovery, and a custom MCP tool around local Git data. Every user turn now runs through a persisted `Planning -> Execution -> Validation -> Acceptance -> Done` state machine, with a planning swarm, a structured requirements contract, explicit plan approval before execution, user acceptance before completion, stage-local agent contracts, dialog-scoped user invariants, semantic invariant gates, and transition logs. The assistant can connect to an existing filesystem MCP server to display available tools, and it can call its own Day 17 Git MCP server to read repository status before making project-state recommendations.

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

## Architecture Notes

- [Day 13-15 orchestrated task lifecycle](docs/day-13.md)
- [Day 16 MCP tool discovery](docs/day-16.md)
- [Day 17 custom Git MCP tool](docs/day-17.md)

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

Day 16 MCP discovery uses the locally installed `@modelcontextprotocol/server-filesystem` package and grants it access only to the repository root. It lists tools but does not call them.

Day 17 adds a custom stdio MCP server at `mcp/day17-git-server.mjs`. Its `get_repository_status` tool reads local Git state only: branch, changed files, and recent commits. The MCP tool provides data; the assistant performs the analysis and recommendation.

## Checks

Before committing a completed day:

```bash
npm run lint
npm run build
```

Do not commit `.env.local`, `.data`, `.next`, `node_modules`, or log files.
