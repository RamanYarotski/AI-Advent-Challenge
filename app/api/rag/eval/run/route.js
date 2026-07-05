import { NextResponse } from "next/server";
import { runDay22Evaluation } from "../../../../../lib/rag/core.mjs";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await runDay22Evaluation(body);
    return NextResponse.json({
      reportPath: result.reportPath,
      evaluationPath: result.evaluationPath,
      questionCount: result.evaluation.results.length,
      strategy: result.evaluation.strategy,
      topK: result.evaluation.topK,
      generationMode: result.evaluation.generationMode,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "RAG evaluation failed." },
      { status: 500 },
    );
  }
}

