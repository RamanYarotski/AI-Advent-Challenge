import { NextResponse } from "next/server";
import {
  callDay20WorkflowTool,
  type Day20WorkflowToolArguments,
} from "@/lib/mcp/day20-workflow-tool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseAction(value: unknown): Day20WorkflowToolArguments["action"] {
  return value === "status" ||
    value === "run_workflow" ||
    value === "preview_branch" ||
    value === "create_branch"
    ? value
    : "run_workflow";
}

function parseNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function response(result: Awaited<ReturnType<typeof callDay20WorkflowTool>>) {
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
      server: "ai-advent-day20-workflow",
      actions: ["status", "run_workflow", "preview_branch", "create_branch"],
      message: "Use POST to run Day 20 MCP orchestration.",
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
    Day20WorkflowToolArguments;
  const result = await callDay20WorkflowTool({
    action: parseAction(body.action),
    dataRoot: typeof body.dataRoot === "string" ? body.dataRoot : undefined,
    refreshSource:
      typeof body.refreshSource === "boolean" ? body.refreshSource : undefined,
    nextDay: parseNumber(body.nextDay),
    branchName:
      typeof body.branchName === "string" ? body.branchName : undefined,
    allowDirty: typeof body.allowDirty === "boolean" ? body.allowDirty : undefined,
  });

  return response(result);
}
