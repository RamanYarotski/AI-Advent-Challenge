# Day 11. Unified Assistant Memory

## Task

Starting with Day 11, the project is one evolving assistant instead of separate task demos. Day 9 compression, Day 10 branching, and Day 11 memory layers now work together in the main assistant.

## Product Direction

- The latest assistant is the main interface.
- Earlier day tabs and archive demos are not exposed in the main UI.
- Users do not choose context strategies manually.
- The assistant selects the active topic branch, compresses old context, and updates memory automatically.

## File-Backed Document Store

The chat discussion had two useful constraints:

- "For now we do everything on files."
- A NoSQL-style model is a good fit for memory.

This implementation combines both: memory is a file-backed document store. Short-term memory is JSON, while working and long-term memory are editable Markdown documents.

- Short-term JSON stores dialogs, topic branches, branch summaries, recent messages, compact metrics, and pending confirmations.
- Working memory Markdown stores current task facts, active project decisions, and implementation constraints.
- Long-term memory Markdown stores stable user preferences, profile facts, and reusable rules.

The user chooses:

- Memory folder.
- Short-term JSON file name.
- Working memory Markdown file name.
- Long-term memory Markdown file name.

Default folder:

```text
C:\Users\Raman\Documents\AI-Advent-Challenge\memory
```

## Agent Flow

- The server selects the most relevant topic branch before prompt assembly.
- The main LLM request receives only the selected branch summary, recent selected-branch messages, working memory, and long-term memory.
- Other branch messages are not sent directly to the model.
- The main LLM response is structured JSON with the assistant answer, optional branch action, optional branch summary, optional memory updates, and optional confirmation question.
- A separate memory-router LLM request is not used on every turn.
- Old branch messages are compressed into the branch summary when the branch becomes long enough.
- Metrics are shown as one compact summary line, not as a per-request table.

## Memory Behavior

- Clear current-task or project facts are saved to working memory automatically.
- Clear stable user preferences and reusable rules are saved to long-term memory automatically.
- Ordinary chat and one-off questions stay only in short-term memory.
- The assistant should not ask too often before saving memory.
- It asks only when the target layer, durability, or wording is genuinely ambiguous.
- Ambiguous memory updates are not written to Markdown until the user confirms.

## Test Scenarios

- Open the app and confirm the main assistant is shown.
- Confirm archive, day dropdown, strategy selector, manual branch selector, and recent-message input are absent.
- Confirm metrics are shown as one compact summary line.
- Change memory folder and file names, then send a message.
- Send a normal message and confirm only short-term JSON changes.
- Send a current-task decision and confirm working memory Markdown updates.
- Send a stable user preference and confirm long-term memory Markdown updates.
- Send an ambiguous memory request and confirm the assistant asks a concise clarification question.
- Switch topics and confirm a separate branch is selected or created.
- Build a long dialog and confirm older branch context is summarized while the prompt uses summary plus recent messages.
- Create many dialogs and confirm the dialog list scrolls.
