# AI Advent Challenge

A Next.js + TypeScript playground for building an AI assistant step by step through the AI Advent Challenge.

The project started as small isolated LLM experiments and is now evolving into one practical assistant. Each day adds a visible feature and a small piece of agent architecture: API access, output control, reasoning, model evaluation, memory, token tracking, compression, branching, file-backed long-term context, personalization, and task orchestration.

## Current Stage

The current build is a unified assistant with automatic topic branches, context compression, global metrics, file-backed memory, manageable user profiles, language-agnostic profile-learning suggestions, and lifecycle-only orchestration. Every user turn now runs through a persisted `Planning -> Execution -> Validation -> Done` state machine, with a planning swarm, a structured requirements contract, explicit plan approval before execution, stage-local agent contracts, scoped invariants, validation gates, transition logs, and request-context inspection.

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
- Day 12: added full user profile management, language-agnostic confirmed profile update suggestions, profile-scoped prompt context, memory folder moves, global metrics, and request-context inspection so personalization and memory injection are visible and testable.
- Day 13-15: combined the task-state, invariant, swarm, and transition-control assignments into one unified assistant upgrade: an internal lifecycle-only task orchestrator routes every user turn through stage-local agents, runs a planning swarm, injects active invariants, validates before completion, and stores task state in the file-backed memory model.

## Architecture Notes

- [Day 13-15 orchestrated task lifecycle](docs/day-13.md)

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

## Checks

Before committing a completed day:

```bash
npm run lint
npm run build
```

Do not commit `.env.local`, `.data`, `.next`, `node_modules`, or log files.
