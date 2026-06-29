import { existsSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export type McpDiscoveredTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpToolDiscoveryResult = {
  connected: boolean;
  serverName: string;
  serverVersion: string | null;
  transport: "stdio";
  allowedRoot: string;
  tools: McpDiscoveredTool[];
  error: string | null;
  stderr: string | null;
  checkedAt: string;
};

const SERVER_NAME = "filesystem";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown MCP connection error.";
}

function localFilesystemServerEntry() {
  return path.join(
    process.cwd(),
    "node_modules",
    "@modelcontextprotocol",
    "server-filesystem",
    "dist",
    "index.js",
  );
}

function normalizeToolInputSchema(schema: unknown): Record<string, unknown> {
  return schema && typeof schema === "object"
    ? (schema as Record<string, unknown>)
    : {};
}

export async function listMcpTools(): Promise<McpToolDiscoveryResult> {
  const checkedAt = new Date().toISOString();
  const allowedRoot = process.cwd();
  const serverEntry = localFilesystemServerEntry();

  if (!existsSync(serverEntry)) {
    return {
      connected: false,
      serverName: SERVER_NAME,
      serverVersion: null,
      transport: "stdio",
      allowedRoot,
      tools: [],
      error:
        "The local @modelcontextprotocol/server-filesystem package is not installed.",
      stderr: null,
      checkedAt,
    };
  }

  const client = new Client({
    name: "ai-advent-day-16-client",
    version: "1.0.0",
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry, allowedRoot],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const stderrChunks: string[] = [];
  transport.stderr?.on("data", (chunk: Buffer | string) => {
    stderrChunks.push(chunk.toString());
  });

  try {
    await client.connect(transport);
    const toolsResult = await client.listTools();
    const serverVersion = client.getServerVersion();

    return {
      connected: true,
      serverName: serverVersion?.name || SERVER_NAME,
      serverVersion: serverVersion?.version ?? null,
      transport: "stdio",
      allowedRoot,
      tools: toolsResult.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        inputSchema: normalizeToolInputSchema(tool.inputSchema),
      })),
      error: null,
      stderr: stderrChunks.join("").trim() || null,
      checkedAt,
    };
  } catch (error) {
    return {
      connected: false,
      serverName: SERVER_NAME,
      serverVersion: null,
      transport: "stdio",
      allowedRoot,
      tools: [],
      error: errorMessage(error),
      stderr: stderrChunks.join("").trim() || null,
      checkedAt,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
