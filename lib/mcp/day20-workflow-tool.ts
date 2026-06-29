import { existsSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  callDay18SchedulerTool,
  type Day18SchedulerToolCallResult,
} from "@/lib/mcp/day18-scheduler-tool";
import {
  callDay19BriefingTool,
  type Day19BriefingToolCallResult,
} from "@/lib/mcp/day19-briefing-tool";
import {
  callGitRepositoryStatusTool,
  type GitMcpRepositoryStatus,
  type GitMcpToolCallResult,
} from "@/lib/mcp/day17-git-tool";

export type Day20WorkflowAction =
  | "status"
  | "run_workflow"
  | "preview_branch"
  | "create_branch";

export type Day20WorkflowToolArguments = {
  action?: Day20WorkflowAction;
  dataRoot?: string;
  refreshSource?: boolean;
  nextDay?: number;
  branchName?: string;
  allowDirty?: boolean;
};

export type Day20WorkflowStep = {
  serverId: string;
  serverName: string;
  toolName: string;
  status: "success" | "failed" | "skipped";
  inputSummary: string;
  outputSummary: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  savedPaths: string[];
  error: string | null;
  substeps?: Array<{
    toolName: string;
    status: string;
    outputSummary: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
  }>;
};

export type Day20WorkflowStructuredContent = {
  action: Day20WorkflowAction;
  message: string;
  dataRoot: string | null;
  report: Record<string, unknown> | null;
  digest: Record<string, unknown> | null;
  digestMarkdownExcerpt: string;
  gitStatus: GitMcpRepositoryStatus | null;
  branchPlan: Record<string, unknown> | null;
  savedPaths: string[];
  steps: Day20WorkflowStep[];
  checkedAt: string;
};

export type Day20WorkflowToolCallResult = {
  connected: boolean;
  serverName: string;
  serverVersion: string | null;
  transport: "stdio";
  requestedAction: Day20WorkflowAction;
  arguments: Day20WorkflowToolArguments;
  servers: Array<{
    serverId: string;
    serverName: string;
    serverVersion: string | null;
    tools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }>;
  }>;
  steps: Day20WorkflowStep[];
  structuredContent: Day20WorkflowStructuredContent | null;
  contentText: string | null;
  error: string | null;
  stderr: string | null;
  checkedAt: string;
};

type RawMcpToolCall = {
  connected: boolean;
  serverName: string;
  serverVersion: string | null;
  toolName: string;
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
  structuredContent: Record<string, unknown> | null;
  contentText: string | null;
  error: string | null;
  stderr: string | null;
  checkedAt: string;
};

type MeasuredStepResult<T> = {
  result: T | null;
  step: Day20WorkflowStep;
};

const SERVER_NAME = "ai-advent-day20-workflow";
const FILESYSTEM_SERVER_NAME = "io.github.modelcontextprotocol/server-filesystem";

function day20ServerEntry() {
  return path.join(process.cwd(), "mcp", "day20-workflow-server.mjs");
}

function filesystemServerEntry() {
  return path.join(
    process.cwd(),
    "node_modules",
    "@modelcontextprotocol",
    "server-filesystem",
    "dist",
    "index.js",
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Unknown Day 20 workflow MCP error.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeToolInputSchema(schema: unknown): Record<string, unknown> {
  return schema && typeof schema === "object"
    ? (schema as Record<string, unknown>)
    : {};
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

function normalizeStructuredContent(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
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

function stringFromRecord(
  value: Record<string, unknown> | null | undefined,
  key: string,
) {
  const item = value?.[key];
  return typeof item === "string" ? item : null;
}

function arrayFromRecord(
  value: Record<string, unknown> | null | undefined,
  key: string,
) {
  const item = value?.[key];
  return Array.isArray(item) ? item.map(String) : [];
}

function recordFromRecord(
  value: Record<string, unknown> | null | undefined,
  key: string,
) {
  const item = value?.[key];
  return isRecord(item) ? item : null;
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function latestMarkdownPathFromBriefing(result: Day19BriefingToolCallResult | null) {
  const structured = result?.structuredContent;
  const savedPaths = structured?.savedPaths ?? [];
  const digest = structured?.digest;
  const digestSavedPaths = recordFromRecord(digest, "savedPaths");
  const latestMarkdown = stringFromRecord(digestSavedPaths, "latestMarkdown");
  const markdown = stringFromRecord(digestSavedPaths, "markdown");

  return (
    latestMarkdown ??
    savedPaths.find((item) => item.endsWith("latest-challenge-digest.md")) ??
    markdown ??
    savedPaths.find((item) => item.endsWith(".md")) ??
    null
  );
}

function digestSavedPaths(result: Day19BriefingToolCallResult | null) {
  const structured = result?.structuredContent;
  const digest = structured?.digest;
  const digestPaths = recordFromRecord(digest, "savedPaths");
  return dedupeStrings([
    ...(structured?.savedPaths ?? []),
    ...arrayFromRecord(result?.structuredContent, "savedPaths"),
    ...Object.values(digestPaths ?? {}).map(String),
  ]);
}

function rawSavedPaths(value: RawMcpToolCall | null) {
  return arrayFromRecord(value?.structuredContent, "savedPaths");
}

function stepSummaryFromRaw(value: RawMcpToolCall | null, fallback: string) {
  if (!value) {
    return fallback;
  }
  return (
    stringFromRecord(value.structuredContent, "message") ??
    value.error ??
    value.contentText?.slice(0, 240) ??
    fallback
  );
}

async function callRawMcpTool({
  args,
  command,
  cwd = process.cwd(),
  serverName,
  toolArguments,
  toolName,
}: {
  args: string[];
  command: string;
  cwd?: string;
  serverName: string;
  toolArguments: Record<string, unknown>;
  toolName: string;
}): Promise<RawMcpToolCall> {
  const checkedAt = new Date().toISOString();
  const client = new Client({
    name: "ai-advent-day-20-workflow-client",
    version: "1.0.0",
  });
  const transport = new StdioClientTransport({
    command,
    args,
    cwd,
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
      arguments: toolArguments,
    });
    const serverVersion = client.getServerVersion();
    const contentText = extractTextContent(toolResult.content);

    return {
      connected: true,
      serverName: serverVersion?.name || serverName,
      serverVersion: serverVersion?.version ?? null,
      toolName,
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
      serverName,
      serverVersion: null,
      toolName,
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

async function callDay20ServerTool(
  toolName:
    | "get_latest_orchestration_report"
    | "save_orchestration_report"
    | "prepare_next_day_branch",
  toolArguments: Record<string, unknown>,
) {
  const serverEntry = day20ServerEntry();
  if (!existsSync(serverEntry)) {
    return {
      connected: false,
      serverName: SERVER_NAME,
      serverVersion: null,
      toolName,
      tools: [],
      structuredContent: null,
      contentText: null,
      error: "The Day 20 workflow MCP server entry file is missing.",
      stderr: null,
      checkedAt: new Date().toISOString(),
    } satisfies RawMcpToolCall;
  }

  return callRawMcpTool({
    command: process.execPath,
    args: [serverEntry],
    serverName: SERVER_NAME,
    toolName,
    toolArguments,
  });
}

async function callFilesystemTool({
  dataRoot,
  toolArguments,
  toolName,
}: {
  dataRoot: string;
  toolArguments: Record<string, unknown>;
  toolName: "list_allowed_directories" | "read_file";
}) {
  const serverEntry = filesystemServerEntry();
  if (!existsSync(serverEntry)) {
    return {
      connected: false,
      serverName: FILESYSTEM_SERVER_NAME,
      serverVersion: null,
      toolName,
      tools: [],
      structuredContent: null,
      contentText: null,
      error: "The filesystem MCP server entry file is missing.",
      stderr: null,
      checkedAt: new Date().toISOString(),
    } satisfies RawMcpToolCall;
  }

  return callRawMcpTool({
    command: process.execPath,
    args: [serverEntry, dataRoot],
    serverName: FILESYSTEM_SERVER_NAME,
    toolName,
    toolArguments,
  });
}

async function measureStep<T>({
  fn,
  inputSummary,
  outputSummary,
  savedPaths,
  serverId,
  serverName,
  substeps,
  toolName,
}: {
  fn: () => Promise<T>;
  inputSummary: string;
  outputSummary: (result: T | null) => string;
  savedPaths?: (result: T | null) => string[];
  serverId: string;
  serverName: string;
  substeps?: (result: T | null) => Day20WorkflowStep["substeps"];
  toolName: string;
}): Promise<MeasuredStepResult<T>> {
  const startedAtDate = new Date();
  const startedAt = startedAtDate.toISOString();
  try {
    const result = await fn();
    const finishedAtDate = new Date();
    const resultError =
      isRecord(result) && typeof result.error === "string" ? result.error : null;
    const connected =
      !isRecord(result) ||
      typeof result.connected !== "boolean" ||
      result.connected;
    const status = resultError || !connected ? "failed" : "success";

    return {
      result,
      step: {
        serverId,
        serverName,
        toolName,
        status,
        inputSummary,
        outputSummary: outputSummary(result),
        startedAt,
        finishedAt: finishedAtDate.toISOString(),
        durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
        savedPaths: savedPaths?.(result) ?? [],
        error: resultError,
        substeps: substeps?.(result),
      },
    };
  } catch (error) {
    const finishedAtDate = new Date();
    return {
      result: null,
      step: {
        serverId,
        serverName,
        toolName,
        status: "failed",
        inputSummary,
        outputSummary: "Step failed.",
        startedAt,
        finishedAt: finishedAtDate.toISOString(),
        durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
        savedPaths: [],
        error: errorMessage(error),
      },
    };
  }
}

function schedulerSummary(result: Day18SchedulerToolCallResult | null) {
  return (
    result?.structuredContent?.message ??
    result?.error ??
    "Scheduler MCP did not return a summary."
  );
}

function briefingSummary(result: Day19BriefingToolCallResult | null) {
  return (
    result?.structuredContent?.message ??
    result?.error ??
    "Briefing MCP did not return a summary."
  );
}

function gitSummary(result: GitMcpToolCallResult | null) {
  const status = result?.structuredContent;
  if (!status) {
    return result?.error ?? "Git MCP did not return repository status.";
  }
  return `${status.branch || "unknown branch"}; ${status.isClean ? "clean" : `${status.changedFileCount} changed file(s)`}.`;
}

function collectServers(
  rawValues: Array<{
    serverId: string;
    serverName: string;
    serverVersion: string | null;
    tools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }>;
  }>,
) {
  const byId = new Map<string, (typeof rawValues)[number]>();
  for (const item of rawValues) {
    if (!byId.has(item.serverId)) {
      byId.set(item.serverId, item);
    }
  }
  return Array.from(byId.values());
}

function serverRecordFromScheduler(result: Day18SchedulerToolCallResult | null) {
  return {
    serverId: "day18-scheduler",
    serverName: result?.serverName ?? "ai-advent-day18-scheduler",
    serverVersion: result?.serverVersion ?? null,
    tools: result?.tools ?? [],
  };
}

function serverRecordFromBriefing(result: Day19BriefingToolCallResult | null) {
  return {
    serverId: "day19-briefing",
    serverName: result?.serverName ?? "ai-advent-day19-briefing",
    serverVersion: result?.serverVersion ?? null,
    tools: result?.tools ?? [],
  };
}

function serverRecordFromGit(result: GitMcpToolCallResult | null) {
  return {
    serverId: "day17-git",
    serverName: result?.serverName ?? "ai-advent-day17-git",
    serverVersion: result?.serverVersion ?? null,
    tools: result?.tools ?? [],
  };
}

function serverRecordFromRaw(serverId: string, result: RawMcpToolCall | null) {
  return {
    serverId,
    serverName: result?.serverName ?? serverId,
    serverVersion: result?.serverVersion ?? null,
    tools: result?.tools ?? [],
  };
}

function branchPlanFromRaw(result: RawMcpToolCall | null) {
  return recordFromRecord(result?.structuredContent, "branchPlan");
}

function reportFromRaw(result: RawMcpToolCall | null) {
  return recordFromRecord(result?.structuredContent, "report");
}

function buildResult({
  action,
  branchPlan,
  checkedAt,
  contentText,
  dataRoot,
  digest,
  digestMarkdown,
  error,
  gitStatus,
  report,
  savedPaths,
  servers,
  steps,
}: {
  action: Day20WorkflowAction;
  branchPlan: Record<string, unknown> | null;
  checkedAt: string;
  contentText: string | null;
  dataRoot: string | null;
  digest: Record<string, unknown> | null;
  digestMarkdown: string;
  error: string | null;
  gitStatus: GitMcpRepositoryStatus | null;
  report: Record<string, unknown> | null;
  savedPaths: string[];
  servers: Day20WorkflowToolCallResult["servers"];
  steps: Day20WorkflowStep[];
}): Day20WorkflowToolCallResult {
  const failedStep = steps.find((step) => step.status === "failed");
  const finalMessage =
    stringFromRecord(report, "title") ??
    (failedStep
      ? `Day 20 workflow completed with a failed step: ${failedStep.serverId}/${failedStep.toolName}.`
      : action === "status"
        ? "Day 20 workflow status read."
        : action === "create_branch"
          ? "Day 20 branch preparation finished."
          : "Day 20 workflow finished.");
  const structuredContent = {
    action,
    message: finalMessage,
    dataRoot,
    report,
    digest,
    digestMarkdownExcerpt: digestMarkdown.slice(0, 1200),
    gitStatus,
    branchPlan,
    savedPaths,
    steps,
    checkedAt,
  };

  return {
    connected: !error,
    serverName: SERVER_NAME,
    serverVersion:
      servers.find((server) => server.serverId === "day20-workflow")
        ?.serverVersion ?? null,
    transport: "stdio",
    requestedAction: action,
    arguments: {
      action,
      dataRoot: dataRoot ?? undefined,
    },
    servers,
    steps,
    structuredContent,
    contentText: contentText ?? JSON.stringify(structuredContent, null, 2),
    error,
    stderr: null,
    checkedAt,
  };
}

export async function callDay20WorkflowTool(
  input: Day20WorkflowToolArguments = {},
): Promise<Day20WorkflowToolCallResult> {
  const checkedAt = new Date().toISOString();
  const action = input.action ?? "run_workflow";
  const steps: Day20WorkflowStep[] = [];
  const serverRecords: Day20WorkflowToolCallResult["servers"] = [];
  let dataRoot = input.dataRoot ?? null;
  let digest: Record<string, unknown> | null = null;
  let digestMarkdown = "";
  let gitStatus: GitMcpRepositoryStatus | null = null;
  let branchPlan: Record<string, unknown> | null = null;
  let report: Record<string, unknown> | null = null;
  let contentText: string | null = null;
  let savedPaths: string[] = [];

  const schedulerAction =
    action === "run_workflow" && input.refreshSource !== false ? "tick" : "status";
  const schedulerStep = await measureStep({
    serverId: "day18-scheduler",
    serverName: "ai-advent-day18-scheduler",
    toolName:
      schedulerAction === "tick" ? "run_scheduled_task" : "get_scheduler_status",
    inputSummary:
      schedulerAction === "tick"
        ? "refresh source cache before orchestration"
        : "read scheduler status",
    fn: () =>
      callDay18SchedulerTool({
        action: schedulerAction,
        dataRoot: dataRoot ?? undefined,
        note:
          schedulerAction === "tick"
            ? "day20 workflow refresh"
            : "day20 workflow status",
      }),
    outputSummary: schedulerSummary,
    savedPaths: (result) => {
      const latestRun = result?.structuredContent?.runs.at(-1);
      return latestRun?.savedPaths ?? [];
    },
  });
  steps.push(schedulerStep.step);
  serverRecords.push(serverRecordFromScheduler(schedulerStep.result));
  dataRoot = schedulerStep.result?.structuredContent?.dataRoot ?? dataRoot;

  if (action === "run_workflow") {
    const briefingStep = await measureStep({
      serverId: "day19-briefing",
      serverName: "ai-advent-day19-briefing",
      toolName: "run_chain",
      inputSummary: "extract briefing messages, build digest, save digest",
      fn: () =>
        callDay19BriefingTool({
          action: "run_chain",
          dataRoot: dataRoot ?? undefined,
        }),
      outputSummary: briefingSummary,
      savedPaths: digestSavedPaths,
      substeps: (result) => result?.structuredContent?.steps,
    });
    steps.push(briefingStep.step);
    serverRecords.push(serverRecordFromBriefing(briefingStep.result));
    digest = briefingStep.result?.structuredContent?.digest ?? null;
    dataRoot = briefingStep.result?.structuredContent?.dataRoot ?? dataRoot;
    savedPaths = dedupeStrings([...savedPaths, ...digestSavedPaths(briefingStep.result)]);

    const markdownPath = latestMarkdownPathFromBriefing(briefingStep.result);
    if (dataRoot) {
      const fsAllowedStep = await measureStep({
        serverId: "filesystem",
        serverName: FILESYSTEM_SERVER_NAME,
        toolName: "list_allowed_directories",
        inputSummary: `allowed root=${dataRoot}`,
        fn: () =>
          callFilesystemTool({
            dataRoot: dataRoot ?? "",
            toolName: "list_allowed_directories",
            toolArguments: {},
          }),
        outputSummary: (result) =>
          stepSummaryFromRaw(result, "Filesystem allowed directories listed."),
      });
      steps.push(fsAllowedStep.step);
      serverRecords.push(serverRecordFromRaw("filesystem", fsAllowedStep.result));
    }

    if (dataRoot && markdownPath) {
      const fsReadStep = await measureStep({
        serverId: "filesystem",
        serverName: FILESYSTEM_SERVER_NAME,
        toolName: "read_file",
        inputSummary: markdownPath,
        fn: () =>
          callFilesystemTool({
            dataRoot: dataRoot ?? "",
            toolName: "read_file",
            toolArguments: {
              path: markdownPath,
            },
          }),
        outputSummary: (result) =>
          result?.error ??
          `Digest Markdown read through filesystem MCP (${result?.contentText?.length ?? 0} chars).`,
      });
      steps.push(fsReadStep.step);
      serverRecords.push(serverRecordFromRaw("filesystem", fsReadStep.result));
      digestMarkdown = fsReadStep.result?.contentText ?? "";
    } else {
      steps.push({
        serverId: "filesystem",
        serverName: FILESYSTEM_SERVER_NAME,
        toolName: "read_file",
        status: "skipped",
        inputSummary: "latest challenge digest markdown",
        outputSummary: "Skipped because no saved Markdown digest path is available.",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        savedPaths: [],
        error: null,
      });
    }
  }

  const gitStep = await measureStep({
    serverId: "day17-git",
    serverName: "ai-advent-day17-git",
    toolName: "get_repository_status",
    inputSummary: "read branch, cleanliness, and recent commits",
    fn: () => callGitRepositoryStatusTool(),
    outputSummary: gitSummary,
  });
  steps.push(gitStep.step);
  serverRecords.push(serverRecordFromGit(gitStep.result));
  gitStatus = gitStep.result?.structuredContent ?? null;

  const shouldPrepareBranch =
    action === "run_workflow" ||
    action === "preview_branch" ||
    action === "create_branch";
  if (shouldPrepareBranch) {
    const prepareStep = await measureStep({
      serverId: "day20-workflow",
      serverName: SERVER_NAME,
      toolName: "prepare_next_day_branch",
      inputSummary:
        action === "create_branch"
          ? "create next-day branch if the workspace is clean"
          : "preview next-day branch",
      fn: () =>
        callDay20ServerTool("prepare_next_day_branch", {
          nextDay: input.nextDay,
          branchName: input.branchName,
          createBranch: action === "create_branch",
          allowDirty: input.allowDirty,
        }),
      outputSummary: (result) =>
        stepSummaryFromRaw(result, "Next-day branch plan prepared."),
    });
    steps.push(prepareStep.step);
    serverRecords.push(serverRecordFromRaw("day20-workflow", prepareStep.result));
    branchPlan = branchPlanFromRaw(prepareStep.result);
  }

  if (action === "status") {
    const latestReportStep = await measureStep({
      serverId: "day20-workflow",
      serverName: SERVER_NAME,
      toolName: "get_latest_orchestration_report",
      inputSummary: "read latest saved Day 20 report",
      fn: () =>
        callDay20ServerTool("get_latest_orchestration_report", {
          dataRoot: dataRoot ?? undefined,
        }),
      outputSummary: (result) =>
        stepSummaryFromRaw(result, "Latest report status loaded."),
      savedPaths: rawSavedPaths,
    });
    steps.push(latestReportStep.step);
    serverRecords.push(serverRecordFromRaw("day20-workflow", latestReportStep.result));
    report = reportFromRaw(latestReportStep.result);
    savedPaths = dedupeStrings([
      ...savedPaths,
      ...rawSavedPaths(latestReportStep.result),
    ]);
  } else {
    const reportStep = await measureStep({
      serverId: "day20-workflow",
      serverName: SERVER_NAME,
      toolName: "save_orchestration_report",
      inputSummary: "persist Day 20 workflow result",
      fn: () =>
        callDay20ServerTool("save_orchestration_report", {
          dataRoot: dataRoot ?? undefined,
          action,
          workflow: {
            action,
            summary:
              action === "run_workflow"
                ? "Scheduler, briefing, filesystem, Git, and Day 20 report MCP tools were orchestrated in sequence."
                : "Next-day branch preparation was checked through Git and Day 20 MCP tools.",
            refreshSource: input.refreshSource !== false,
          },
          digest,
          digestMarkdown,
          gitStatus,
          branchPlan,
          steps,
          sourceArtifacts: savedPaths,
        }),
      outputSummary: (result) =>
        stepSummaryFromRaw(result, "Day 20 report saved."),
      savedPaths: rawSavedPaths,
    });
    steps.push(reportStep.step);
    serverRecords.push(serverRecordFromRaw("day20-workflow", reportStep.result));
    report = reportFromRaw(reportStep.result);
    savedPaths = dedupeStrings([
      ...savedPaths,
      ...rawSavedPaths(reportStep.result),
    ]);
    contentText = reportStep.result?.contentText ?? null;
  }

  const fatalError =
    steps.some(
      (step) =>
        step.status === "failed" &&
        step.serverId === "day20-workflow" &&
        step.toolName === "save_orchestration_report",
    )
      ? "Day 20 workflow could not save its orchestration report."
      : null;

  return buildResult({
    action,
    branchPlan,
    checkedAt,
    contentText,
    dataRoot,
    digest,
    digestMarkdown,
    error: fatalError,
    gitStatus,
    report,
    savedPaths,
    servers: collectServers(serverRecords),
    steps,
  });
}
