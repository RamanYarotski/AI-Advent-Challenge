import { NextResponse } from "next/server";
import {
  DEFAULT_SOURCE_MANAGER_DATA_ROOT,
  resetRagData,
} from "../../../../lib/rag/source-manager.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    return NextResponse.json(
      await resetRagData({ dataRoot: DEFAULT_SOURCE_MANAGER_DATA_ROOT }),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "RAG reset failed." },
      { status: 500 },
    );
  }
}
