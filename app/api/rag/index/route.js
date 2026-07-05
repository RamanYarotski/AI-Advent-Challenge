import { NextResponse } from "next/server";
import { runDay21Indexing } from "../../../../lib/rag/core.mjs";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await runDay21Indexing(body);
    return NextResponse.json({
      comparison: result.comparison,
      fixed: result.fixed.stats,
      structural: result.structural.stats,
      reportPath: result.reportPath,
      manifestPath: result.manifestPath,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Indexing failed." },
      { status: 500 },
    );
  }
}

