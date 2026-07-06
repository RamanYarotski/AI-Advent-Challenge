import { NextResponse } from "next/server";
import {
  DEFAULT_SOURCE_MANAGER_DATA_ROOT,
  getSourceCatalogStatus,
} from "../../../../../lib/rag/source-manager.mjs";

export async function GET() {
  try {
    return NextResponse.json(
      await getSourceCatalogStatus({ dataRoot: DEFAULT_SOURCE_MANAGER_DATA_ROOT }),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Source status failed." },
      { status: 500 },
    );
  }
}
