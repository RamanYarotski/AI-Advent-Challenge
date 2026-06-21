# AI Advent Challenge

A Next.js + TypeScript playground for building an AI assistant step by step through the AI Advent Challenge.

The project started as small isolated LLM experiments and is now evolving into one practical assistant. By Day 11, the main screen is a unified memory assistant that combines context compression, topic branches, and file-backed memory layers.

## Current Stage

Day 11 turns the previous demos into one agent product:

- Short-term memory is stored as JSON with dialogs, topic branches, branch summaries, recent messages, and compact metrics.
- Working memory is an editable Markdown file for current task and project facts.
- Long-term memory is an editable Markdown file for stable user preferences and reusable rules.
- The assistant chooses the relevant topic branch automatically.
- The main prompt uses only the relevant branch summary, recent branch messages, working memory, and long-term memory.
- Clear memory updates are saved automatically; ambiguous updates trigger a concise confirmation question.

## Progress

- Day 1: first OpenAI-compatible LLM API request.
- Day 2: response format controls.
- Day 3: reasoning strategy comparison.
- Day 4: temperature comparison.
- Day 5: weak, medium, and strong model comparison.
- Day 6: first simple agent.
- Day 7: persistent conversation memory.
- Day 8: token and cost analysis for chat dialogs.
- Day 9: context compression with summaries.
- Day 10: context strategies and topic branching.
- Day 11: unified assistant with file-backed memory layers, automatic branch selection, compact metrics, and editable memory files.

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
