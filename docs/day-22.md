# Day 22. First RAG Query

Day 22 adds the first question-answering instrument on top of the Day 21 indexes.

## Implementation

- Loads the fixed or structural JSON index from `.data/rag-week/indexes`.
- Embeds the question with the same local hash embedding space used by the default Day 21 index.
- Searches chunks by cosine similarity.
- Builds a context block from the top matches.
- Produces two answers for comparison:
  - plain mode: no retrieved context;
  - RAG mode: answer grounded in retrieved chunks.
- Saves a 10-question evaluation report.

## Manual Parameters

- `strategy`: `structural` by default, `fixed` optional.
- `topK`: `8` by default.
- `generationMode`: `local` by default, `llm` optional with local fallback.
- `model`, `temperature`, and `maxTokens` can be passed for live LLM generation.

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

