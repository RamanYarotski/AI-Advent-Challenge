import { NextResponse } from "next/server";
import {
  callDay19BriefingTool,
  type Day19BriefingToolArguments,
} from "@/lib/mcp/day19-briefing-tool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseAction(value: unknown): Day19BriefingToolArguments["action"] {
  return value === "extract" ||
    value === "build" ||
    value === "save" ||
    value === "run_chain"
    ? value
    : "run_chain";
}

function parseNumberArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number")
    : undefined;
}

function parseStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}

function parseNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function response(result: Awaited<ReturnType<typeof callDay19BriefingTool>>) {
  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET() {
  return NextResponse.json(
    {
      connected: true,
      server: "ai-advent-day19-briefing",
      actions: ["extract", "build", "save", "run_chain"],
      message: "Use POST to run Day 19 briefing MCP tools.",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as
    Day19BriefingToolArguments;
  const result = await callDay19BriefingTool({
    action: parseAction(body.action),
    dataRoot: typeof body.dataRoot === "string" ? body.dataRoot : undefined,
    targetDays: parseNumberArray(body.targetDays),
    priorityAuthors: parseStringArray(body.priorityAuthors),
    keywords: parseStringArray(body.keywords),
    maxMessages: parseNumber(body.maxMessages),
    selectionMode:
      body.selectionMode === "cached_relevant" ||
      body.selectionMode === "focused"
        ? body.selectionMode
        : undefined,
    messageLimit: parseNumber(body.messageLimit),
    extractionPath:
      typeof body.extractionPath === "string" ? body.extractionPath : undefined,
    digestPath: typeof body.digestPath === "string" ? body.digestPath : undefined,
  });

  return response(result);
}
