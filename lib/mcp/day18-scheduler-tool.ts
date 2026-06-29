import { existsSync } from "node:fs";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export type Day18SchedulerAction =
  | "status"
  | "save_settings"
  | "start"
  | "stop"
  | "tick"
  | "reset";

export type Day18ScheduleMode = "manual" | "interval" | "daily";

export type Day18SchedulerToolArguments = {
  action?: Day18SchedulerAction;
  dataRoot?: string;
  sourcePath?: string;
  targetDays?: number[];
  priorityAuthors?: string[];
  keywords?: string[];
  replyDepth?: number;
  instructions?: string;
  schedulerEnabled?: boolean;
  taskEnabled?: boolean;
  scheduleMode?: Day18ScheduleMode;
  intervalSeconds?: number;
  dailyTime?: string;
  note?: string;
};

export type Day18BriefingProfile = {
  targetDays: number[];
  priorityAuthors: string[];
  keywords: string[];
  replyDepth: number;
  instructions: string;
};

export type Day18FileSource = {
  sourceType: "file";
  parserPreset: "message_export_json" | string;
  path: string;
};

export type Day18ScheduledTask = {
  id: string;
  title: string;
  enabled: boolean;
  serverId: string;
  toolName: string;
  args: {
    source: Day18FileSource;
    briefingProfile: Day18BriefingProfile;
  };
  schedule: {
    mode: Day18ScheduleMode;
    intervalSeconds: number;
    dailyTime: string;
  };
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  lastResult: Day18BriefingAggregate | null;
  lastError: string | null;
  updatedAt: string;
};

export type Day18BriefingMessage = {
  id: string;
  date: string;
  author: string;
  replyToMessageId: string | null;
  text: string;
  excerpt: string;
};

export type Day18BriefingAggregate = {
  sourceType: string;
  sourcePath: string;
  parserPreset: string;
  targetDays: number[];
  priorityAuthors: string[];
  instructions: string;
  totalRelevantMessages: number;
  newRelevantMessages: number;
  assignmentMessages: number;
  priorityAuthorMessages: number;
  latestMessageId: number | null;
  latestMessageDate: string | null;
  sourceFingerprint: {
    size: number;
    mtimeMs: number;
  };
  summary: string;
  recentMessages: Day18BriefingMessage[];
  updatedAt: string;
};

export type Day18SchedulerRun = {
  id: string;
  taskId: string;
  title: string;
  serverId: string;
  toolName: string;
  status: "running" | "success" | "failed" | "skipped";
  inputSummary: string;
  outputSummary: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  savedPaths: string[];
  error: string | null;
  note: string;
};

export type Day18SchedulerStructuredContent = {
  schedulerEnabled: boolean;
  dataRoot: string;
  source: Day18FileSource;
  briefingProfile: Day18BriefingProfile;
  task: Day18ScheduledTask;
  tasks: Day18ScheduledTask[];
  runs: Day18SchedulerRun[];
  latestAggregate: Day18BriefingAggregate | null;
  storagePaths: {
    index: string;
    tasks: string;
    runs: string;
    messagesCache: string;
    latestAggregate: string;
    digests: string;
    reports: string;
  };
  message: string;
  checkedAt: string;
};

export type Day18SchedulerDiscoveredTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type Day18SchedulerToolCallResult = {
  connected: boolean;
  serverName: string;
  serverVersion: string | null;
  transport: "stdio";
  toolName:
    | "get_scheduler_status"
    | "upsert_scheduled_task"
    | "toggle_scheduled_task"
    | "run_scheduled_task"
    | "reset_scheduler";
  requestedAction: Day18SchedulerAction;
  arguments: Day18SchedulerToolArguments;
  tools: Day18SchedulerDiscoveredTool[];
  structuredContent: Day18SchedulerStructuredContent | null;
  contentText: string | null;
  runtime: {
    workerActive: boolean;
    workerPid: number | null;
    startedAt: string | null;
    lastWorkerError: string | null;
  };
  error: string | null;
  stderr: string | null;
  checkedAt: string;
};

const SERVER_NAME = "ai-advent-day18-scheduler";

type SchedulerRuntime = {
  worker: ChildProcess | null;
  startedAt: string | null;
  lastWorkerError: string | null;
};

const globalWithScheduler = globalThis as typeof globalThis & {
  __aiAdventDay18WorkerRuntime?: SchedulerRuntime;
};

function runtimeState() {
  globalWithScheduler.__aiAdventDay18WorkerRuntime ??= {
    worker: null,
    startedAt: null,
    lastWorkerError: null,
  };

  return globalWithScheduler.__aiAdventDay18WorkerRuntime;
}

function runtimeSnapshot() {
  const runtime = runtimeState();
  return {
    workerActive: runtime.worker !== null && runtime.worker.exitCode === null,
    workerPid:
      runtime.worker !== null && runtime.worker.exitCode === null
        ? runtime.worker.pid ?? null
        : null,
    startedAt: runtime.startedAt,
    lastWorkerError: runtime.lastWorkerError,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Unknown Day 18 scheduler MCP error.";
}

function schedulerServerEntry() {
  return path.join(process.cwd(), "mcp", "day18-scheduler-server.mjs");
}

function schedulerWorkerEntry() {
  return path.join(process.cwd(), "mcp", "day18-scheduler-worker.mjs");
}

function normalizeToolInputSchema(schema: unknown): Record<string, unknown> {
  return schema && typeof schema === "object"
    ? (schema as Record<string, unknown>)
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function normalizeStructuredContent(
  value: unknown,
): Day18SchedulerStructuredContent | null {
  if (!isRecord(value)) {
    return null;
  }

  return value as Day18SchedulerStructuredContent;
}

function parseStructuredContent(
  structuredContent: unknown,
  contentText: string | null,
) {
  const direct = normalizeStructuredContent(structuredContent);
  if (direct || !contentText) {
    return direct;
  }

  try {
    return normalizeStructuredContent(JSON.parse(contentText));
  } catch {
    return null;
  }
}

function rawToolForAction(action: Day18SchedulerAction) {
  if (action === "save_settings") {
    return "upsert_scheduled_task" as const;
  }
  if (action === "start" || action === "stop") {
    return "toggle_scheduled_task" as const;
  }
  if (action === "tick") {
    return "run_scheduled_task" as const;
  }
  if (action === "reset") {
    return "reset_scheduler" as const;
  }
  return "get_scheduler_status" as const;
}

function rawArgumentsFor(input: Day18SchedulerToolArguments) {
  const action = input.action ?? "status";
  if (action === "start") {
    return {
      ...input,
      schedulerEnabled: true,
      taskEnabled: true,
    };
  }
  if (action === "stop") {
    return {
      dataRoot: input.dataRoot,
      schedulerEnabled: false,
    };
  }
  if (action === "tick") {
    return {
      ...input,
      force: true,
      note: input.note || "manual run now",
    };
  }
  return input;
}

function stopWorker() {
  const runtime = runtimeState();
  if (runtime.worker && runtime.worker.exitCode === null) {
    runtime.worker.kill();
  }
  runtime.worker = null;
  runtime.startedAt = null;
}

function startWorker(dataRoot?: string) {
  const runtime = runtimeState();
  if (runtime.worker && runtime.worker.exitCode === null) {
    return;
  }
  const workerEntry = schedulerWorkerEntry();
  if (!existsSync(workerEntry)) {
    runtime.lastWorkerError = "The Day 18 scheduler worker entry file is missing.";
    return;
  }

  const args = [workerEntry];
  if (dataRoot) {
    args.push(dataRoot);
  }
  const worker = spawn(process.execPath, args, {
    cwd: process.cwd(),
    detached: false,
    stdio: "ignore",
    windowsHide: true,
  });
  runtime.worker = worker;
  runtime.startedAt = new Date().toISOString();
  runtime.lastWorkerError = null;
  worker.on("error", (error) => {
    runtime.lastWorkerError = error.message;
  });
  worker.on("exit", () => {
    runtime.worker = null;
    runtime.startedAt = null;
  });
}

async function callRawSchedulerTool(
  input: Day18SchedulerToolArguments = {},
): Promise<Day18SchedulerToolCallResult> {
  const checkedAt = new Date().toISOString();
  const requestedAction = input.action ?? "status";
  const serverEntry = schedulerServerEntry();
  const toolName = rawToolForAction(requestedAction);
  const rawArguments = rawArgumentsFor(input);

  if (!existsSync(serverEntry)) {
    return {
      connected: false,
      serverName: SERVER_NAME,
      serverVersion: null,
      transport: "stdio",
      toolName,
      requestedAction,
      arguments: input,
      tools: [],
      structuredContent: null,
      contentText: null,
      runtime: runtimeSnapshot(),
      error: "The Day 18 scheduler MCP server entry file is missing.",
      stderr: null,
      checkedAt,
    };
  }

  const client = new Client({
    name: "ai-advent-day-18-scheduler-client",
    version: "1.0.0",
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
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
      name: toolName,
      arguments: rawArguments,
    });
    const serverVersion = client.getServerVersion();
    const contentText = extractTextContent(toolResult.content);
    const structuredContent = parseStructuredContent(
      toolResult.structuredContent,
      contentText,
    );

    return {
      connected: true,
      serverName: serverVersion?.name || SERVER_NAME,
      serverVersion: serverVersion?.version ?? null,
      transport: "stdio",
      toolName,
      requestedAction,
      arguments: input,
      tools: toolsResult.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        inputSchema: normalizeToolInputSchema(tool.inputSchema),
      })),
      structuredContent,
      contentText,
      runtime: runtimeSnapshot(),
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
      toolName,
      requestedAction,
      arguments: input,
      tools: [],
      structuredContent: null,
      contentText: null,
      runtime: runtimeSnapshot(),
      error: errorMessage(error),
      stderr: stderrChunks.join("").trim() || null,
      checkedAt,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function callDay18SchedulerTool(
  input: Day18SchedulerToolArguments = {},
): Promise<Day18SchedulerToolCallResult> {
  const result = await callRawSchedulerTool(input);
  const schedulerEnabled = result.structuredContent?.schedulerEnabled === true;
  const dataRoot = result.structuredContent?.dataRoot ?? input.dataRoot;

  if (input.action === "start" || schedulerEnabled) {
    startWorker(dataRoot);
  }
  if (input.action === "stop" || input.action === "reset" || !schedulerEnabled) {
    stopWorker();
  }

  return {
    ...result,
    runtime: runtimeSnapshot(),
  };
}
