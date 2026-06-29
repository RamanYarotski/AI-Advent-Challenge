# Day 18. Generic MCP Scheduler

Day 18 adds a generic local scheduler for MCP-style work. The useful scenario is a file source that can be scanned periodically, filtered into a briefing cache, and surfaced to the assistant as structured context.

## Requirement Interpretation

- The assignment is about a scheduled or periodic MCP tool.
- The tool should persist data in JSON or SQLite.
- The scheduled work should return an aggregate, not only a raw event.
- A VPS is not required for this demo. The scheduler runs locally while the app process or worker process is alive.
- The MCP tool provides data. The assistant still interprets the aggregate and explains it to the user.

## What Changed

- Added `mcp/day18-scheduler-server.mjs`, a custom stdio MCP server.
- Added `mcp/day18-scheduler-core.mjs`, the reusable scheduler and file-scan core.
- Added `mcp/day18-scheduler-worker.mjs`, a local worker loop for due scheduled tasks.
- Added `lib/mcp/day18-scheduler-tool.ts`, a Next.js helper that calls the MCP server and starts/stops the local worker.
- Added `GET/POST /api/agent/mcp-day18`.
- Added a Scheduler MCP panel to the unified assistant UI.
- Added a Scheduler section in assistant settings.
- Added chat handling for Day 18 scheduler status/start/stop/run/reset questions.
- Added `npm run scheduler:worker` as a manual worker entry point.

## Scheduler Model

The scheduler stores tasks shaped like:

```json
{
  "serverId": "briefing",
  "toolName": "scan_message_file",
  "args": {
    "source": {
      "sourceType": "file",
      "parserPreset": "message_export_json",
      "path": "C:\\path\\to\\result.json"
    },
    "briefingProfile": {
      "targetDays": [18, 19, 20],
      "priorityAuthors": ["Алексей Гладков", "Mobile Developer Manager"],
      "keywords": ["mcp", "scheduler", "pipeline"],
      "replyDepth": 1,
      "instructions": "Prioritize assignment posts and answers from priority authors."
    }
  },
  "schedule": {
    "mode": "manual",
    "intervalSeconds": 60,
    "dailyTime": "09:00"
  }
}
```

The first supported scheduled tool is `briefing/scan_message_file`. It reads a local JSON message export, filters relevant messages, includes configured reply parents, updates a watermark, and writes a briefing aggregate.

## Persistence

Default data root:

```text
.data/mcp-workflows
```

Stored files:

- `.data/day-18/scheduler-index.json` stores the selected data root.
- `<dataRoot>/scheduler/tasks.json` stores scheduler settings and task definitions.
- `<dataRoot>/scheduler/runs.json` stores the activity trace.
- `<dataRoot>/briefings/messages-cache.json` stores relevant normalized messages and the watermark.
- `<dataRoot>/briefings/latest-aggregate.json` stores the latest aggregate.
- `<dataRoot>/briefings/digests` is reserved for Day 19 digest files.
- `<dataRoot>/reports` is reserved for Day 20 orchestration reports.

## Delta Behavior

Each scan reads the source file but only processes messages not present in the previous watermark. Irrelevant old messages are ignored. Relevant messages remain in the normalized cache so future tools can build digests without rereading noisy data.

If a later scan reports no new relevant messages, that means the source file did not add matching messages since the previous scan. The existing cached relevant messages are still available to the assistant and later digest tools.

## Time Display

Scheduler state stores timestamps as ISO strings for machine use. The UI renders last run, next run, aggregate update time, and activity trace times in the browser's local timezone. When the scheduler or task is off, the next run is shown as paused instead of leaving a stale timestamp on screen.

## UI Flow

1. Open the unified assistant.
2. Open Assistant settings.
3. Go to `Scheduler`.
4. Set the data root, source file path, target days, priority authors, keywords, reply depth, instructions, and frequency.
5. Click `Save settings`.
6. Click `Run now` for a manual MCP call, or `Start worker` to let due tasks run locally.
7. Watch the Scheduler MCP panel and `MCP Activity Trace` for local timestamps, status, run result, saved paths, and errors.

## Chat Flow

Scheduler-related questions bypass the old task lifecycle and call the Day 18 MCP tool directly. Implementation requests still use the normal orchestrated workflow.

Examples:

- `What is the Day 18 scheduler status?`
- `Run the Day 18 scheduler now.`
- `Start the Day 18 scheduler.`
- `Stop the Day 18 scheduler.`

## Acceptance Checks

- The custom MCP server exposes scheduler tools:
  - `get_scheduler_status`
  - `upsert_scheduled_task`
  - `toggle_scheduled_task`
  - `run_scheduled_task`
  - `reset_scheduler`
- Scheduler settings can be saved from the UI.
- A manual run reads a configured file source and writes cache plus aggregate JSON files.
- The activity trace shows server, tool, args summary, output summary, timestamps, duration, saved paths, and errors.
- The worker can run enabled due tasks locally.
- The assistant answers scheduler questions from the Day 18 MCP result.
- `npm run lint` and `npm run build` pass.
