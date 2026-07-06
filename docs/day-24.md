# Day 24. Citations, Sources, and Anti-Hallucination

Day 24 turns the improved retrieval pipeline into a stricter answer instrument.
It keeps the full upstream controls from Day 21 and Day 23, then adds citation and anti-hallucination gates.

## Implementation

- Runs the Day 23 rewrite, filtering, and reranking pipeline.
- Returns a structured answer object:
  - `answer`;
  - `sources`;
  - `citations`;
  - `status`;
  - relevance scores.
- Each citation includes `source`, `section`, `chunk_id`, `score`, and a quote from the matched chunk.
- If the best chunk is below `minScore`, the instrument returns `не знаю` and no general LLM fallback.
- Local hash embeddings can produce false positives, so the answer gate also checks lexical overlap with the cited chunks.

## Manual Parameters

- `minScore`: `0.24` by default for local hash embeddings.
- `initialTopK`: `15` by default.
- `finalTopK`: `5` by default.
- `threshold`: defaults to `minScore`.
- `minLexicalOverlap`: `0.08` by default.
- `useRewrite`: enabled by default.
- Day 21 upstream controls: enabled Source Manager records, source-specific crawl limits, `fixedTokens`, `overlapTokens`, `maxStructuralTokens`, `embeddingMode`, and optional `rebuildIndex`.
- `sourcesText` remains available only for low-level API/CLI compatibility.

## Acceptance Checks

- `npm run rag:day24`
- answered cases contain sources and citations;
- negative case returns `не знаю`;
- `npm run lint`;
- `npm run build`.
