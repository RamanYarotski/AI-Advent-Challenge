import { NextResponse } from "next/server";
import { runRerankQuery } from "../../../../lib/rag/core.mjs";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await runRerankQuery(body));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Rerank query failed." },
      { status: 500 },
    );
  }
}

