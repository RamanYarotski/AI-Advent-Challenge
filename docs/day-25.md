# Day 25. Mini Chat with RAG and Task Memory

Day 25 wraps the RAG pipeline into a mini chat instrument.

## Implementation

- Stores chat sessions in `.data/rag-week/chats`.
- Keeps full user/assistant history for each session.
- Runs RAG retrieval for every user message through the Day 24 cited-answer pipeline.
- Always returns a source array and citation array, even when the answer is `не знаю`.
- Maintains task state:
  - current goal;
  - constraints;
  - fixed terms;
  - clarifications.

## Manual Parameters

The chat uses the same retrieval controls as Day 24:

- `initialTopK`;
- `finalTopK`;
- `threshold`;
- `minScore`;
- `minLexicalOverlap`;
- `useRewrite`;
- `sessionId`.

## Scenario Checks

`npm run rag:day25` runs two 10-message scenarios:

- submission planning;
- practical toolkit usage.

The report verifies that the assistant keeps a task goal, records constraints/terms/clarifications, and returns source arrays for every assistant turn.

## Acceptance Checks

- `npm run rag:day25`
- `npm run rag:all`
- `npm run lint`
- `npm run build`

