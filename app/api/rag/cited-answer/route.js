import { NextResponse } from "next/server";
import { runCitedAnswer } from "../../../../lib/rag/core.mjs";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await runCitedAnswer(body));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cited answer failed." },
      { status: 500 },
    );
  }
}

