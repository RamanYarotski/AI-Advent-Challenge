# Day 21. Indexing Documents

Day 21 starts the RAG toolkit as an independent indexing instrument. It reads a practical multi-format corpus, chunks it with two strategies, generates embeddings, and saves local JSON indexes with metadata.

## Implementation

- Formats: Markdown, text, JSON, CSV, HTML, TypeScript/JavaScript/CSS code, and a basic PDF text fallback.
- Corpus: sources explicitly added in the UI. CLI/API calls without sources still fall back to project docs/code for repeatable demo checks.
- Sources: upload files, single URL/file, site crawl, GitHub repo/tree/blob URL, or local path available to the running app process.
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
- Source records: `upload`, `url`, `site`, `github`, `local_path`
- Source-specific limits: `siteMaxDepth`, `siteMaxPages`, `siteMaxBytesPerPage`, `githubMaxFiles`
- `sourcesText` remains available only for low-level API/CLI compatibility.

## Acceptance Checks

- `npm run rag:day21`
- `npm run lint`
- `npm run build`
