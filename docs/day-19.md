# Day 19. Briefing MCP Tool Chain

Day 19 turns the Day 18 scheduler cache into a reusable briefing digest. The key point is that this is one MCP server with several tools, not several artificial MCP servers.

## Requirement Interpretation

- Day 19 is about MCP tool calls again.
- The useful demo is a chain of MCP tools.
- The chain should be visible and deterministic.
- A summary can be a structured report/digest; it does not have to be an LLM-generated summary.
- Day 18 remains the data collection layer. Day 19 reads the cached relevant messages and builds a saved digest.

## MCP Server

Server:

```text
mcp/day19-briefing-server.mjs
```

Tools:

- `extract_briefing_messages`
- `build_challenge_digest`
- `save_challenge_digest`

The UI button `Run chain` calls these tools sequentially through the MCP client:

```text
extract_briefing_messages -> build_challenge_digest -> save_challenge_digest
```

## Data Flow

1. Day 18 scheduler scans a local message export file.
2. Day 18 stores relevant normalized messages in:

```text
<dataRoot>/briefings/messages-cache.json
```

3. Day 19 extracts a focused message set from that cache.
4. Day 19 builds a deterministic challenge digest.
5. Day 19 saves the digest as JSON and Markdown.

## Stored Files

Default data root:

```text
.data/mcp-workflows
```

Day 19 files:

- `<dataRoot>/briefings/extractions/<id>.json`
- `<dataRoot>/briefings/latest-extraction.json`
- `<dataRoot>/briefings/latest-digest-draft.json`
- `<dataRoot>/briefings/digests/<id>.json`
- `<dataRoot>/briefings/digests/<id>.md`
- `<dataRoot>/briefings/digests/latest-challenge-digest.json`
- `<dataRoot>/briefings/digests/latest-challenge-digest.md`
- `<dataRoot>/briefings/digests/index.json`

## UI Flow

1. Open the unified assistant.
2. Check that the Day 18 Scheduler MCP has a cache or click `Run now` there.
3. In `Day 19 Briefing MCP`, click `Run chain`.
4. Confirm that the panel shows three successful tool calls.
5. Open the saved JSON or Markdown path if needed.

Manual buttons are also available:

- `Extract`
- `Build digest`
- `Save digest`

They use the latest intermediate file when the previous step was already run.

## Day 20 Preparation

The saved digest is intentionally stored in files. Day 20 can then orchestrate several MCP servers:

- Scheduler MCP for refreshing source data.
- Briefing MCP for digest generation.
- Filesystem MCP for reading saved artifacts.
- Git MCP for branch/workspace readiness.

## Acceptance Checks

- The Day 19 MCP server exposes all three tools.
- `Run chain` calls all three tools in order.
- The extraction reads Day 18 cache data.
- The digest includes priority author guidance, assignment/day markers, tool-chain signals, and open questions.
- The digest is saved as JSON and Markdown.
- The UI shows the MCP tool-call trace with timestamps and durations.
- `npm run lint` and `npm run build` pass.
