# Day 8. Token and Cost Growth

## Task

Show how token usage and provider cost change as a dialog grows. Each Day 8 dialog has its own messages and turn-by-turn metrics.

## What to Show in the Video

- Select `Day 8 Tokens`.
- Create dialogs with the `+` tab button.
- Switch between dialog tabs.
- Delete a dialog with `x` and confirm the browser prompt.
- Send several messages in one dialog and show the metrics table growing.
- Show the three cost graphs when provider cost is available.
- If cost is not available, show the provider cost warning.
- Set a low demo context budget and show a `blocked` row.

## Done When

- Day 8 uses its own JSON storage, separate from Day 7.
- Each dialog keeps separate messages and metrics.
- The table shows request tokens, dialog tokens, response tokens, total tokens, time, cost, and status.
- The UI shows exactly three cost graphs: cost vs request size, cost vs dialog size, and cost vs response size.
- If provider cost is missing, the UI shows a clear message instead of cost graphs.
