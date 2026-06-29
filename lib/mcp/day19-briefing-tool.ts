import { existsSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export type Day19BriefingAction = "extract" | "build" | "save" | "run_chain";

export type Day19BriefingToolArguments = {
  action?: Day19BriefingAction;
  dataRoot?: string;
  targetDays?: number[];
  priorityAuthors?: string[];
  keywords?: string[];
  maxMessages?: number;
  selectionMode?: "cached_relevant" | "focused";
  messageLimit?: number;
  extractionPath?: string;
  digestPath?: string;
};

export type Day19DiscoveredTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type Day19BriefingStep = {
  toolName:
    | "extract_briefing_messages"
    | "build_challenge_digest"
    | "save_challenge_digest";
  status: "success" | "failed";
  arguments: Record<string, unknown>;
  contentText: string | null;
  structuredContent: Record<string, unknown> | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  error: string | null;
};

export type Day19BriefingStructuredContent = {
  action: Day19BriefingAction;
  message: string;
  dataRoot: string | null;
  extraction: Record<string, unknown> | null;
  digest: Record<string, unknown> | null;
  savedPaths: string[];
  steps: Array<{
    toolName: Day19BriefingStep["toolName"];
    status: Day19BriefingStep["status"];
    outputSummary: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
  }>;
  checkedAt: string;
};

export type Day19BriefingToolCallResult = {
  connected: boolean;
  serverName: string;
  serverVersion: string | null;
  transport: "stdio";
  requestedAction: Day19BriefingAction;
  arguments: Day19BriefingToolArguments;
  tools: Day19DiscoveredTool[];
  steps: Day19BriefingStep[];
  structuredContent: Day19BriefingStructuredContent | null;
  contentText: string | null;
  error: string | null;
  stderr: string | null;
  checkedAt: string;
};

const SERVER_NAME = "ai-advent-day19-briefing";

function briefingServerEntry() {
  return path.join(process.cwd(), "mcp", "day19-briefing-server.mjs");
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Unknown Day 19 briefing MCP error.";
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

function baseToolArguments(input: Day19BriefingToolArguments) {
  return {
    dataRoot: input.dataRoot,
    targetDays: input.targetDays,
    priorityAuthors: input.priorityAuthors,
    keywords: input.keywords,
    maxMessages: input.maxMessages,
    selectionMode: input.selectionMode,
  };
}

function outputSummary(step: Day19BriefingStep) {
  const message = step.structuredContent?.message;
  if (typeof message === "string" && message.trim()) {
    return message;
  }
  return step.error ?? "No tool output summary.";
}

function buildStructuredResult({
  action,
  checkedAt,
  digest,
  extraction,
  savedPaths,
  steps,
}: {
  action: Day19BriefingAction;
  checkedAt: string;
  digest: Record<string, unknown> | null;
  extraction: Record<string, unknown> | null;
  savedPaths: string[];
  steps: Day19BriefingStep[];
}): Day19BriefingStructuredContent {
  const dataRoot =
    (typeof digest?.dataRoot === "string" && digest.dataRoot) ||
    (typeof extraction?.dataRoot === "string" && extraction.dataRoot) ||
    null;
  const finalStep = steps[steps.length - 1];

  return {
    action,
    message: finalStep ? outputSummary(finalStep) : "No Day 19 MCP tool ran.",
    dataRoot,
    extraction,
    digest,
    savedPaths,
    steps: steps.map((step) => ({
      toolName: step.toolName,
      status: step.status,
      outputSummary: outputSummary(step),
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
      durationMs: step.durationMs,
    })),
    checkedAt,
  };
}

export async function callDay19BriefingTool(
  input: Day19BriefingToolArguments = {},
): Promise<Day19BriefingToolCallResult> {
  const checkedAt = new Date().toISOString();
  const requestedAction = input.action ?? "run_chain";
  const serverEntry = briefingServerEntry();

  if (!existsSync(serverEntry)) {
    return {
      connected: false,
      serverName: SERVER_NAME,
      serverVersion: null,
      transport: "stdio",
      requestedAction,
      arguments: input,
      tools: [],
      steps: [],
      structuredContent: null,
      contentText: null,
      error: "The Day 19 briefing MCP server entry file is missing.",
      stderr: null,
      checkedAt,
    };
  }

  const client = new Client({
    name: "ai-advent-day-19-briefing-client",
    version: "1.0.0",
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const stderrChunks: string[] = [];
  const steps: Day19BriefingStep[] = [];

  transport.stderr?.on("data", (chunk: Buffer | string) => {
    stderrChunks.push(chunk.toString());
  });

  async function callStep(
    toolName: Day19BriefingStep["toolName"],
    args: Record<string, unknown>,
  ) {
    const startedAtDate = new Date();
    const startedAt = startedAtDate.toISOString();
    try {
      const toolResult = await client.callTool({
        name: toolName,
        arguments: args,
      });
      const finishedAtDate = new Date();
      const contentText = extractTextContent(toolResult.content);
      const structuredContent = parseStructuredContent(
        toolResult.structuredContent,
        contentText,
      );
      const step: Day19BriefingStep = {
        toolName,
        status: "success",
        arguments: args,
        contentText,
        structuredContent,
        startedAt,
        finishedAt: finishedAtDate.toISOString(),
        durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
        error: null,
      };
      steps.push(step);
      return step;
    } catch (error) {
      const finishedAtDate = new Date();
      const step: Day19BriefingStep = {
        toolName,
        status: "failed",
        arguments: args,
        contentText: null,
        structuredContent: null,
        startedAt,
        finishedAt: finishedAtDate.toISOString(),
        durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
        error: errorMessage(error),
      };
      steps.push(step);
      throw error;
    }
  }

  try {
    await client.connect(transport);
    const toolsResult = await client.listTools();
    const tools = toolsResult.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: normalizeToolInputSchema(tool.inputSchema),
    }));
    const serverVersion = client.getServerVersion();
    const baseArgs = baseToolArguments(input);
    let extraction: Record<string, unknown> | null = null;
    let digest: Record<string, unknown> | null = null;
    let savedPaths: string[] = [];
    let contentText: string | null = null;

    if (requestedAction === "extract" || requestedAction === "run_chain") {
      const extractStep = await callStep("extract_briefing_messages", baseArgs);
      extraction = normalizeStructuredContent(
        extractStep.structuredContent?.extraction,
      );
      contentText = extractStep.contentText;
    }

    if (requestedAction === "build" || requestedAction === "run_chain") {
      const buildStep = await callStep("build_challenge_digest", {
        ...baseArgs,
        extraction: extraction ?? undefined,
        extractionPath: input.extractionPath,
        messageLimit: input.messageLimit,
      });
      digest = normalizeStructuredContent(buildStep.structuredContent?.digest);
      extraction =
        extraction ??
        normalizeStructuredContent(buildStep.structuredContent?.extraction);
      contentText = buildStep.contentText;
    }

    if (requestedAction === "save" || requestedAction === "run_chain") {
      const saveStep = await callStep("save_challenge_digest", {
        dataRoot: input.dataRoot,
        digest: digest ?? undefined,
        digestPath: input.digestPath,
      });
      digest = normalizeStructuredContent(saveStep.structuredContent?.digest);
      const rawSavedPaths = saveStep.structuredContent?.savedPaths;
      savedPaths = Array.isArray(rawSavedPaths)
        ? rawSavedPaths.map(String)
        : [];
      contentText = saveStep.contentText;
    }

    const structuredContent = buildStructuredResult({
      action: requestedAction,
      checkedAt,
      digest,
      extraction,
      savedPaths,
      steps,
    });

    return {
      connected: true,
      serverName: serverVersion?.name || SERVER_NAME,
      serverVersion: serverVersion?.version ?? null,
      transport: "stdio",
      requestedAction,
      arguments: input,
      tools,
      steps,
      structuredContent,
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
      requestedAction,
      arguments: input,
      tools: [],
      steps,
      structuredContent: steps.length
        ? buildStructuredResult({
            action: requestedAction,
            checkedAt,
            digest: null,
            extraction: null,
            savedPaths: [],
            steps,
          })
        : null,
      contentText: null,
      error: errorMessage(error),
      stderr: stderrChunks.join("").trim() || null,
      checkedAt,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
