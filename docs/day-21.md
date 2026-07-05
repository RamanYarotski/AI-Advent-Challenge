# Day 21. Indexing Documents

Day 21 starts the RAG toolkit as an independent indexing instrument. It reads a practical multi-format corpus, chunks it with two strategies, generates embeddings, and saves local JSON indexes with metadata.

## Implementation

- Formats: Markdown, text, JSON, CSV, HTML, TypeScript/JavaScript/CSS code, and a basic PDF text fallback.
- Corpus: project docs/code plus `docs/rag-week-chat-notes.md`.
- Chunking strategies:
  - fixed: `900` estimated tokens with `120` token overlap by default;
  - structural: file/heading/section-aware chunks with `1200` estimated token limit by default.
- Embeddings:
  - default local hash embeddings for repeatable offline checks;
  - optional API embedding mode through the same OpenAI-compatible environment variables.
- Index storage:
  - `.data/rag-week/indexes/fixed.json`;
  - `.data/rag-week/indexes/structural.json`;
  - `.data/rag-week/manifest.json`.

## Manual Parameters

- `fixedTokens`
- `overlapTokens`
- `maxStructuralTokens`
- `embeddingMode`

## Acceptance Checks

- `npm run rag:day21`
- `npm run lint`
- `npm run build`

