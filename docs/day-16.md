# Day 16. MCP Tool Discovery

Day 16 adds the smallest useful MCP integration to the existing unified assistant. The assignment is to connect to MCP and receive the list of available tools, so this implementation uses a ready-made MCP server instead of writing a custom one.

## What Changed

- The app installs the official MCP TypeScript SDK, Zod, and the existing `@modelcontextprotocol/server-filesystem` server.
- A server-side helper starts the filesystem MCP server over stdio with access limited to the repository root.
- The helper creates an MCP client, connects to the server, calls `listTools()`, and closes the connection.
- `GET /api/agent/mcp-tools` returns the connection status, server name, transport, repository root, and discovered tool metadata.
- The unified assistant UI includes an `MCP tools` panel with a `Refresh` button and the returned tool list.

## Video Demo

1. Show this document or the README progress line for Day 16.
2. State that Day 16 uses an existing MCP server; a custom MCP server is intentionally left for later tasks.
3. Open the unified assistant and show that the MCP block is part of the current product, not a separate day tab.
4. Click `Refresh` in `MCP tools`.
5. Show `Connected`, the `filesystem` server, and the listed tools.
6. Open `/api/agent/mcp-tools` and show the JSON response with `connected: true` and the `tools` array.
7. Show the code locations: dependency entries, `lib/mcp/list-tools.ts`, `app/api/agent/mcp-tools/route.ts`, and the UI panel.
8. Show `npm run lint` and `npm run build` passing.

Do not show `.env.local`, API keys, `.data`, `.next`, `node_modules`, or logs. Do not call the tools during the Day 16 demo; listing them is the required result.

## Acceptance Checks

- MCP connection succeeds.
- The API returns a non-empty `tools` array.
- The UI displays the same tool names and descriptions.
- No custom MCP server or VPS deployment is required.
