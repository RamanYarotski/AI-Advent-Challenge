import { NextResponse } from "next/server";
import { listMcpTools } from "@/lib/mcp/list-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await listMcpTools();

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
