import { existsSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export type GitMcpToolArguments = {
  includeChangedFiles?: boolean;
  includeRecentCommits?: boolean;
};

export type GitMcpChangedFile = {
  status: string;
  path: string;
  raw: string;
};

export type GitMcpRecentCommit = {
  hash: string;
  subject: string;
};

export type GitMcpRepositoryStatus = {
  repositoryRoot: string;
  branch: string;
  isClean: boolean;
  changedFileCount: number;
  changedFiles: GitMcpChangedFile[];
  recentCommits: GitMcpRecentCommit[];
  checkedAt: string;
};

export type GitMcpDiscoveredTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type GitMcpToolCallResult = {
  connected: boolean;
  serverName: string;
  serverVersion: string | null;
  transport: "stdio";
  toolName: "get_repository_status";
  arguments: Required<GitMcpToolArguments>;
  tools: GitMcpDiscoveredTool[];
  structuredContent: GitMcpRepositoryStatus | null;
  contentText: string | null;
  error: string | null;
  stderr: string | null;
  checkedAt: string;
};

const SERVER_NAME = "ai-advent-day17-git";
const TOOL_NAME = "get_repository_status" as const;
const DEFAULT_ARGUMENTS: Required<GitMcpToolArguments> = {
  includeChangedFiles: true,
  includeRecentCommits: true,
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Git MCP tool error.";
}

function gitServerEntry() {
  return path.join(process.cwd(), "mcp", "day17-git-server.mjs");
}

function normalizeToolInputSchema(schema: unknown): Record<string, unknown> {
  return schema && typeof schema === "object"
    ? (schema as Record<string, unknown>)
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeChangedFiles(value: unknown): GitMcpChangedFile[] {
  return Array.isArray(value)
    ? value
        .map((item) => {
          if (!isRecord(item)) {
            return null;
          }

          return {
            status: typeof item.status === "string" ? item.status : "",
            path: typeof item.path === "string" ? item.path : "",
            raw: typeof item.raw === "string" ? item.raw : "",
          };
        })
        .filter(
          (item): item is GitMcpChangedFile =>
            item !== null && item.path.length > 0,
        )
    : [];
}

function normalizeRecentCommits(value: unknown): GitMcpRecentCommit[] {
  return Array.isArray(value)
    ? value
        .map((item) => {
          if (!isRecord(item)) {
            return null;
          }

          return {
            hash: typeof item.hash === "string" ? item.hash : "",
            subject: typeof item.subject === "string" ? item.subject : "",
          };
        })
        .filter(
          (item): item is GitMcpRecentCommit =>
            item !== null && item.hash.length > 0,
        )
    : [];
}

function normalizeRepositoryStatus(value: unknown): GitMcpRepositoryStatus | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    repositoryRoot:
      typeof value.repositoryRoot === "string" ? value.repositoryRoot : "",
    branch: typeof value.branch === "string" ? value.branch : "",
    isClean: value.isClean === true,
    changedFileCount:
      typeof value.changedFileCount === "number" &&
      Number.isFinite(value.changedFileCount)
        ? value.changedFileCount
        : normalizeChangedFiles(value.changedFiles).length,
    changedFiles: normalizeChangedFiles(value.changedFiles),
    recentCommits: normalizeRecentCommits(value.recentCommits),
    checkedAt: typeof value.checkedAt === "string" ? value.checkedAt : "",
  };
}

function parseStructuredContent(
  structuredContent: unknown,
  contentText: string | null,
) {
  const direct = normalizeRepositoryStatus(structuredContent);
  if (direct || !contentText) {
    return direct;
  }

  try {
    return normalizeRepositoryStatus(JSON.parse(contentText));
  } catch {
    return null;
  }
}

function extractTextContent(content: unknown) {
  if (!Array.isArray(content)) {
    return null;
  }

  const textParts = content
    .map((item) =>
      isRecord(item) && item.type === "text" && typeof item.text === "string"
        ? item.text
        : "",
    )
    .filter(Boolean);

  return textParts.length ? textParts.join("\n") : null;
}

function normalizeArguments(
  input: GitMcpToolArguments = {},
): Required<GitMcpToolArguments> {
  return {
    includeChangedFiles:
      input.includeChangedFiles ?? DEFAULT_ARGUMENTS.includeChangedFiles,
    includeRecentCommits:
      input.includeRecentCommits ?? DEFAULT_ARGUMENTS.includeRecentCommits,
  };
}

export async function callGitRepositoryStatusTool(
  input: GitMcpToolArguments = {},
): Promise<GitMcpToolCallResult> {
  const checkedAt = new Date().toISOString();
  const serverEntry = gitServerEntry();
  const toolArguments = normalizeArguments(input);

  if (!existsSync(serverEntry)) {
    return {
      connected: false,
      serverName: SERVER_NAME,
      serverVersion: null,
      transport: "stdio",
      toolName: TOOL_NAME,
      arguments: toolArguments,
      tools: [],
      structuredContent: null,
      contentText: null,
      error: "The Day 17 Git MCP server entry file is missing.",
      stderr: null,
      checkedAt,
    };
  }

  const client = new Client({
    name: "ai-advent-day-17-git-client",
    version: "1.0.0",
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry, process.cwd()],
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
    const toolResult = await client.callTool({
      name: TOOL_NAME,
      arguments: toolArguments,
    });
    const serverVersion = client.getServerVersion();
    const contentText = extractTextContent(toolResult.content);

    return {
      connected: true,
      serverName: serverVersion?.name || SERVER_NAME,
      serverVersion: serverVersion?.version ?? null,
      transport: "stdio",
      toolName: TOOL_NAME,
      arguments: toolArguments,
      tools: toolsResult.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        inputSchema: normalizeToolInputSchema(tool.inputSchema),
      })),
      structuredContent: parseStructuredContent(
        toolResult.structuredContent,
        contentText,
      ),
      contentText,
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
      toolName: TOOL_NAME,
      arguments: toolArguments,
      tools: [],
      structuredContent: null,
      contentText: null,
      error: errorMessage(error),
      stderr: stderrChunks.join("").trim() || null,
      checkedAt,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
