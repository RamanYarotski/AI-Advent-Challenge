# Day 20. Cross-MCP Workflow Orchestration

Day 20 connects the previous days into one visible workflow. Day 18 collects and caches relevant messages. Day 19 builds and saves a digest. Day 20 orchestrates those MCP servers, reads the saved digest through filesystem MCP, checks Git readiness, and persists a workflow report.

## Requirement Interpretation

- The useful Day 20 demo is a multi-server MCP workflow.
- The workflow should not hide intermediate steps. Every MCP server/tool call is shown in the UI trace.
- File export remains the source layer. The workflow does not depend on Telegram API.
- Git is useful as a readiness check and as an explicit next-day branch preparation step.
- Branch creation must be a separate user action. The main workflow previews the branch plan but does not switch branches.

## MCP Servers Used

- Day 18 Scheduler MCP:
  - `get_scheduler_status`
  - `run_scheduled_task`
- Day 19 Briefing MCP:
  - `extract_briefing_messages`
  - `build_challenge_digest`
  - `save_challenge_digest`
- Filesystem MCP:
  - `list_allowed_directories`
  - `read_file`
- Day 17 Git MCP:
  - `get_repository_status`
- Day 20 Workflow MCP:
  - `get_latest_orchestration_report`
  - `save_orchestration_report`
  - `prepare_next_day_branch`

## Workflow

The `Run workflow` button executes:

```text
Day 18 refresh/status
-> Day 19 briefing chain
-> filesystem MCP reads latest Markdown digest
-> Git MCP checks branch/worktree state
-> Day 20 previews the next-day branch
-> Day 20 saves JSON and Markdown workflow reports
```

The `Preview branch` button checks what the next branch should be, usually `Day_21` when the current branch is `Day_20`.

The `Create branch` button explicitly asks for confirmation and then calls `prepare_next_day_branch` with creation enabled. If the working tree has uncommitted changes, creation is blocked unless `allowDirty` is explicitly passed by a caller.

## Stored Files

Default data root:

```text
.data/mcp-workflows
```

Day 20 files:

- `<dataRoot>/reports/<id>.json`
- `<dataRoot>/reports/<id>.md`
- `<dataRoot>/reports/latest-day20-orchestration.json`
- `<dataRoot>/reports/latest-day20-orchestration.md`
- `<dataRoot>/reports/index.json`

## UI Flow

1. Run Day 18 once or let its scheduler refresh the file cache.
2. Run Day 19 or let Day 20 run the Day 19 chain as part of the workflow.
3. In `Day 20 Workflow MCP`, click `Run workflow`.
4. Check the orchestration trace for scheduler, briefing, filesystem, Git, and report steps.
5. Use `Preview branch` before moving to the next challenge day.
6. Use `Create branch` only after the current day is committed and the working tree is clean.

## Acceptance Checks

- The Day 20 MCP server exposes all three workflow tools.
- `Run workflow` calls multiple MCP servers and shows timestamps, durations, outputs, and failures.
- The saved Day 19 digest is read through filesystem MCP, not only passed in memory.
- The workflow report is saved as JSON and Markdown.
- Git MCP status is included in the report.
- Next-day branch creation is explicit and blocked on dirty working trees by default.
- `npm run lint` and `npm run build` pass.
