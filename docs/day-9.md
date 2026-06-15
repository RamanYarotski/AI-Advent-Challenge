# Day 9. Context Compression

## Task

Continue the chat-style interface from Day 8, but use a separate Day 9 dialog store with context compression. Older messages are summarized by the LLM and stored as compressed memory, while the most recent messages stay in the live context.

## What to Show in the Video

- Select `Day 9 Compression`.
- Show that Day 9 has its own dialogs and does not reuse Day 8 history.
- Send several messages in a Day 9 dialog.
- Show the compressed memory summary after enough history exists.
- Adjust `Recent messages to keep`.
- Show that token metrics continue to grow from compressed context, not full raw history.

## Done When

- Day 9 has the same chat-style UI pattern as Day 8.
- Day 9 stores dialogs separately from Day 8.
- Old messages are folded into an LLM-generated summary.
- Recent messages stay visible and are sent as-is.
- The UI shows compressed memory, messages, context usage, metrics, and cost graphs when provider cost is available.
