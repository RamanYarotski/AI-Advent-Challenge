import { NextResponse } from "next/server";
import {
  callDay18SchedulerTool,
  type Day18SchedulerToolArguments,
} from "@/lib/mcp/day18-scheduler-tool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseNumber(value: string | null) {
  if (value === null) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseAction(value: unknown): Day18SchedulerToolArguments["action"] {
  return value === "save_settings" ||
    value === "start" ||
    value === "stop" ||
    value === "tick" ||
    value === "reset" ||
    value === "status"
    ? value
    : "status";
}

function response(result: Awaited<ReturnType<typeof callDay18SchedulerTool>>) {
  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await callDay18SchedulerTool({
    action: parseAction(url.searchParams.get("action")),
    dataRoot: url.searchParams.get("dataRoot") ?? undefined,
    intervalSeconds: parseNumber(url.searchParams.get("intervalSeconds")),
  });

  return response(result);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as
    Day18SchedulerToolArguments;
  const result = await callDay18SchedulerTool({
    action: parseAction(body.action),
    dataRoot: typeof body.dataRoot === "string" ? body.dataRoot : undefined,
    sourcePath:
      typeof body.sourcePath === "string" ? body.sourcePath : undefined,
    targetDays: Array.isArray(body.targetDays) ? body.targetDays : undefined,
    priorityAuthors: Array.isArray(body.priorityAuthors)
      ? body.priorityAuthors
      : undefined,
    keywords: Array.isArray(body.keywords) ? body.keywords : undefined,
    replyDepth:
      typeof body.replyDepth === "number" ? body.replyDepth : undefined,
    instructions:
      typeof body.instructions === "string" ? body.instructions : undefined,
    schedulerEnabled:
      typeof body.schedulerEnabled === "boolean"
        ? body.schedulerEnabled
        : undefined,
    taskEnabled:
      typeof body.taskEnabled === "boolean" ? body.taskEnabled : undefined,
    scheduleMode:
      body.scheduleMode === "manual" ||
      body.scheduleMode === "interval" ||
      body.scheduleMode === "daily"
        ? body.scheduleMode
        : undefined,
    intervalSeconds:
      typeof body.intervalSeconds === "number"
        ? body.intervalSeconds
        : undefined,
    dailyTime: typeof body.dailyTime === "string" ? body.dailyTime : undefined,
    note: typeof body.note === "string" ? body.note : undefined,
  });

  return response(result);
}
