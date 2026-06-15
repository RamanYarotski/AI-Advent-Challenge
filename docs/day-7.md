# Day 7. Persistent Context

## Task

Store the agent conversation history outside the browser, load it again after a page refresh, and continue the next LLM request with the saved context.

## What to Show in the Video

- Select `Day 7 Memory`.
- Send a fact or preference to the agent.
- Refresh the browser page manually.
- Select `Day 7 Memory` again if needed and show that the saved history is still visible.
- Ask a follow-up question that depends on the saved fact.
- Show that the API route calls `MemoryAgent`, and `MemoryAgent` reads/writes JSON history.

## Done When

- The conversation history is stored in server-side JSON storage.
- The history survives a normal browser refresh.
- The next request includes the saved system, user, and assistant messages.
- The UI shows the saved conversation history and the agent trace.
