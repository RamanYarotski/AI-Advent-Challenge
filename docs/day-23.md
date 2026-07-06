# Day 23. Reranking and Filtering

Day 23 adds the second retrieval stage after the first vector search.
It is still a standalone instrument: it can accept Day 21 indexing controls and rebuild the index before running the Day 23 retrieval pipeline.

## Implementation

- Query rewrite expands Russian questions with English index terms when useful.
- Initial retrieval uses a larger candidate pool.
- Similarity threshold filters weak chunks.
- MMR reranking keeps the final context relevant but less repetitive.
- Evaluation compares:
  - baseline top-K before filtering;
  - chunks after threshold;
  - final reranked chunks.

## Manual Parameters

- `strategy`: `structural` by default.
- `initialTopK`: `15` by default.
- `finalTopK`: `5` by default.
- `threshold`: `0.24` by default for local hash embeddings.
- `useRewrite`: enabled by default.
- `generationMode`: `local` by default, `llm` optional with fallback.
- Day 21 upstream controls: enabled Source Manager records, source-specific crawl limits, `fixedTokens`, `overlapTokens`, `maxStructuralTokens`, `embeddingMode`, and optional `rebuildIndex`.
- `sourcesText` remains available only for low-level API/CLI compatibility.

## Acceptance Checks

- `npm run rag:day23`
- `npm run lint`
- `npm run build`
