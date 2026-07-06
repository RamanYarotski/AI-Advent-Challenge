# Day 22. First RAG Query

Day 22 adds the first question-answering instrument on top of the Day 21 indexes.
It exposes the Day 21 source and indexing controls too, so it can rebuild the index from a different corpus before answering.

## Implementation

- Loads the fixed or structural JSON index from `.data/rag-week/indexes`.
- Uses `pdf-parse` for uploaded, local-path, single URL, and site-crawl PDF sources so binary PDF streams do not become chunks.
- Embeds the question with the same local hash embedding space used by the default Day 21 index.
- Searches chunks with a hybrid score: local hash cosine similarity plus lexical overlap, Russian/English token normalization, and small safeguards against bibliography-heavy or wrong-subtopic chunks.
- Builds a context block from the top matches.
- Produces two answers for comparison:
  - plain mode: no retrieved context;
  - RAG mode: answer grounded in retrieved chunks.
- Saves a 10-question evaluation report.

## Manual Parameters

- `strategy`: `structural` by default, `fixed` optional.
- `topK`: `8` by default.
- `generationMode`: `local` by default, `llm` optional with local fallback.
- In `local` mode, `model`, `temperature`, and `maxTokens` are hidden because the extractive answer does not call an LLM.
- In `llm` mode, `model` is selected from non-secret presets exposed by `/api/rag/models`; `Custom` keeps manual provider/model IDs available.
- `temperature` and `maxTokens` are only used for live LLM generation.
- Day 21 upstream controls: enabled Source Manager records, source-specific crawl limits, `fixedTokens`, `overlapTokens`, `maxStructuralTokens`, `embeddingMode`, and optional `rebuildIndex`.
- `sourcesText` remains available only for low-level API/CLI compatibility.

## Readable Output

- `Retrieved chunks` shows score, source, section, `chunk_id`, and a readable excerpt.
- HTTP sources are clickable; uploaded and server-local sources are shown as code/path text.
- Local extractive answers choose a readable excerpt from the retrieved chunks instead of dumping the first raw chunk.
- Unreadable extracted text is rejected during indexing or hidden in answers as missing context.
- Existing indexes are not rewritten in place. After a PDF extraction fix or a source replacement, run **Build indexes** with rebuild enabled or **Reset RAG data**.

## Control Questions

The evaluation set contains 10 questions about the indexed project and RAG-week notes. Each entry records:

- expected answer;
- expected sources;
- plain answer;
- RAG answer;
- retrieved chunks and scores.

## Acceptance Checks

- `npm run rag:day22`
- `npm run lint`
- `npm run build`
