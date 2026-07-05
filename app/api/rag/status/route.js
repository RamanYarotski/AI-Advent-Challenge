import { NextResponse } from "next/server";
import { getRagStatus } from "../../../../lib/rag/core.mjs";

export async function GET() {
  try {
    return NextResponse.json(await getRagStatus());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Status check failed." },
      { status: 500 },
    );
  }
}

