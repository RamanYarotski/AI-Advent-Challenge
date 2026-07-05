# RAG Week Chat Notes

## Priority Guidance From Алексей Гладков

- A separate document-focused RAG project and integrating RAG into an existing assistant are both acceptable; the cheaper path depends on the concrete project.
- Desktop, CLI, or web UI are acceptable delivery shapes when they demonstrate the assignment.
- If a pure RAG assistant has no relevant context and answers "не знаю", that is acceptable. Adding a general LLM answer that bypasses the RAG base is strange for this task.
- The practical value of this week is the usable RAG core: indexing, search, filtering, citations, and memory must be visible and testable.

## Day 21 Assignment Summary

Build a document indexing pipeline over at least 20-30 pages or equivalent code:
chunking, embeddings, index storage, metadata, and comparison of fixed-size and structural chunking.

## Day 22 Assignment Summary

Implement question -> relevant chunks -> prompt with context -> LLM answer. Compare answers without RAG and with RAG, then run 10 control questions.

## Day 23 Assignment Summary

Add a second retrieval stage: reranker or relevance filter, threshold tuning, top-K before and after filtering, query rewrite, and quality comparison.

## Day 24 Assignment Summary

Return answer, sources, citations, and an anti-hallucination rule: below relevance threshold, say "не знаю" and ask for clarification.

## Day 25 Assignment Summary

Build a mini chat with RAG, conversation history, sources, and task state memory: goal, constraints, fixed terms, and prior clarifications.

