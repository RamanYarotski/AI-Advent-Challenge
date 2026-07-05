import { NextResponse } from "next/server";
import { runRagQuery } from "../../../../lib/rag/core.mjs";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await runRagQuery(body));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "RAG query failed." },
      { status: 500 },
    );
  }
}

