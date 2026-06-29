# Day 17. Custom Git MCP Tool

Day 17 adds the first custom MCP server. It wraps the local Git API so the unified assistant can read real project state before answering project-status questions.

## What Changed

- Added `mcp/day17-git-server.mjs`, a custom stdio MCP server built with the official MCP SDK.
- Registered a read-only `get_repository_status` tool with input parameters for changed files and recent commits.
- Added a server-side helper that starts the custom MCP server, lists tools, calls `get_repository_status`, and normalizes the result.
- Added `GET /api/agent/mcp-day17` and `POST /api/agent/mcp-day17` for direct tool checks.
- Added a Day 17 Git MCP panel in the unified assistant UI.
- When a user asks about Day 17, MCP, Git, repository status, branch, commits, or project state, the unified assistant injects the Git MCP result into lifecycle stage-agent context.

## Why This MCP Tool Is Useful

The MCP tool gives the agent current repository facts instead of asking the model to infer them from memory:

- current branch
- clean or dirty working tree
- changed files
- latest commits

The tool only provides data. The LLM still performs the analysis, summary, and next-step recommendation.

## Video Demo

1. Open the unified assistant UI.
2. Show the existing Day 16 `MCP tools` panel to establish MCP discovery.
3. Click `Run Git MCP tool` in the Day 17 Git MCP panel.
4. Show that the panel returns the branch, working-tree state, changed files, and recent commits.
5. Open `/api/agent/mcp-day17` and show `connected: true`, `toolName: "get_repository_status"`, and `structuredContent`.
6. Ask the assistant: `Check the project status for Day 17 and tell me what to do next.`
7. Show the memory event saying the Day 17 Git MCP result was injected.
8. Show that the assistant answer uses the real branch/status/commit data.

## Acceptance Checks

- The custom MCP server registers `get_repository_status`.
- The MCP client can list tools and call `get_repository_status`.
- The API route returns `connected: true` and a structured Git result.
- The UI displays the Git MCP result.
- The unified assistant uses the Git MCP result when project-state context is relevant.
- `npm run lint` and `npm run build` pass.
