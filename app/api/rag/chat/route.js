import { NextResponse } from "next/server";
import { runRagChatTurn } from "../../../../lib/rag/core.mjs";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await runRagChatTurn(body));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "RAG chat failed." },
      { status: 500 },
    );
  }
}

