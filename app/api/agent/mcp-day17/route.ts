import { NextResponse } from "next/server";
import {
  callGitRepositoryStatusTool,
  type GitMcpToolArguments,
} from "@/lib/mcp/day17-git-tool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseBoolean(value: string | null, fallback: boolean) {
  if (value === null) {
    return fallback;
  }

  return value !== "false" && value !== "0";
}

function response(result: Awaited<ReturnType<typeof callGitRepositoryStatusTool>>) {
  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await callGitRepositoryStatusTool({
    includeChangedFiles: parseBoolean(
      url.searchParams.get("includeChangedFiles"),
      true,
    ),
    includeRecentCommits: parseBoolean(
      url.searchParams.get("includeRecentCommits"),
      true,
    ),
  });

  return response(result);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as GitMcpToolArguments;
  const result = await callGitRepositoryStatusTool({
    includeChangedFiles:
      typeof body.includeChangedFiles === "boolean"
        ? body.includeChangedFiles
        : true,
    includeRecentCommits:
      typeof body.includeRecentCommits === "boolean"
        ? body.includeRecentCommits
        : true,
  });

  return response(result);
}
