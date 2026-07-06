# RAG Day 21-25 Requirements Audit

Source: `C:\Users\Raman\Downloads\Telegram Desktop\ChatExport_2026-07-06\result.json`.
Scope: Day 21-25 requirements, Alexey Gladkov comments/reactions, current gaps, and acceptance checklist. The Telegram export itself is not committed.

## Official Requirements

| Day | Evidence | Requirement summary |
| --- | --- | --- |
| 21. Indexing documents | msg `3168`, `2026-06-29T14:00:58`, from `Mobile Developer Manager` | Ingest README/articles/code/PDF-to-text, about 20-30 pages or code equivalent; chunk documents; generate embeddings; save an index in FAISS/SQLite/JSON; keep metadata `source`, `title/file`, `section`, `chunk_id`; compare fixed-size and structure-aware chunking; deliver video + code. |
| 22. First RAG query | msg `3304`, `2026-06-30T14:01:25`, from `Mobile Developer Manager` | Implement `question -> relevant chunk search -> combine context with question -> LLM`; compare no-RAG and RAG answers; prepare 10 control questions with expected answers and expected sources; deliver an agent with two modes. |
| 23. Reranking and filtering | msg `3350`, `2026-07-01T14:00:48`, from `Mobile Developer Manager` | Add a second retrieval stage after initial search: reranker, similarity threshold, model, or heuristic; tune top-K before/after and threshold; add query rewrite; compare quality with and without filtering. |
| 24. Citations and anti-hallucination | msg `3400`, `2026-07-02T14:02:01`, from `Mobile Developer Manager` | Every answer returns answer text, sources, and quotes/fragments from chunks; test 10 questions for source presence, quote presence, and answer-quote consistency; below relevance threshold return `не знаю` and ask for clarification. |
| 25. Mini-chat with RAG and memory | msg `3442`, `2026-07-03T14:04:26`, from `Mobile Developer Manager` | Build CLI/web/desktop mini-chat with dialogue history; run RAG on every new question; answer from retrieved information; always show sources; keep task state: goal, clarifications, fixed constraints, terms; test two 10-15 message scenarios. |

## Alexey Gladkov Acceptance Hints

| Evidence | Hint | Acceptance impact |
| --- | --- | --- |
| msg `3270`/`3271`, `2026-06-29T22:44:13`, from `Алексей Гладков` | It is acceptable either to build around Day 21 indexed documents or integrate RAG into an existing project. | A standalone RAG toolkit is acceptable if every daily requirement is demonstrable. |
| msg `3379`, `2026-07-01T18:05:09`, from `Алексей Гладков`; reaction to msg `3380` | Embedding model choice is flexible; `mxbai-embed-large` was positively reacted to by context. | Do not over-optimize provider choice; show embeddings are generated and retrieval quality is evaluated. |
| msg `3417`/`3418`, `2026-07-02T17:35:35`, from `Алексей Гладков` | If all prepared questions are above threshold, that is good, provided the model can still say `не знаю`. | Include at least one negative/irrelevant test proving weak-context unknown mode. |
| msg `3445`, `2026-07-03T14:11:37`, from `Алексей Гладков` | Desktop app is acceptable for Day 25. | Web, CLI, or desktop wrapper is fine; behavior matters more than the surface. |
| msg `3483`, `2026-07-03T16:06:59`, from `Алексей Гладков` | RAG is for data absent from the model base knowledge and needing accurate reproduction; generic code alone is a weak fit. | Prefer real domain docs, KB, site, repo docs, or user-provided files; source ingestion must be easy and visible. |
| msg `3593`/`3595`, `2026-07-04T18:09:07`, from `Алексей Гладков` | Repeated `не знаю` is acceptable for pure RAG if the files lack the answer; it is strange if a general model fallback also answers. | Unknown answers must be gated by retrieval relevance and must not silently fall back to generic model knowledge. |
| msg `3600`, `2026-07-04T21:54:13`, from `Алексей Гладков` | A useful RAG agent indexed company KB/government data and answered from it. | Strong demo: upload/index nontrivial external data, then show answers with sources and citations. |

## Implementation Gaps Addressed By Source Manager

- Textarea-only ingestion made "feed files/links" unclear. The UI now needs browser uploads, explicit source types, and source status rows.
- `url` should mean one page/file; `site` should mean limited same-origin crawl.
- GitHub repo/tree/blob sources should be explicit and capped by default, with counts/warnings after indexing.
- Uploaded files and managed source records should persist under `.data/rag-week`, while advanced multiline sources remain backward-compatible.
- Day 22-25 must reuse the same managed sources and expose all earlier pipeline parameters so each day is an independent, fully controllable tool.
- Automated tests should cover source normalization, upload validation, local warnings, mocked site crawl, managed-source indexing, and UI source management.

## Acceptance Checklist

- Day 21: build index from upload/url/site/GitHub/local sources; compare fixed and structural chunking; save JSON indexes and manifest; show source counts and warnings.
- Day 22: run no-RAG vs RAG over the selected index; top-K is configurable with a sensible default; control questions include expected sources.
- Day 23: expose threshold, top-K before/after, query rewrite, and reranking/filtering results.
- Day 24: every answered response shows sources and quotes; weak context returns `не знаю`.
- Day 25: every chat turn runs retrieval, returns sources/citations, and preserves task state across long scenarios.
- Testing: run lint, unit, integration, build, E2E, and `rag:all`; keep URL/GitHub network tests mocked by default.
