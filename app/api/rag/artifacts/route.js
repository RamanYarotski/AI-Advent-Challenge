import { NextResponse } from "next/server";
import { listRagArtifacts, readRagArtifact } from "../../../../lib/rag/artifacts.mjs";
import { DEFAULT_SOURCE_MANAGER_DATA_ROOT } from "../../../../lib/rag/source-manager.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    if (!key) {
      return NextResponse.json({
        artifacts: listRagArtifacts({ dataRoot: DEFAULT_SOURCE_MANAGER_DATA_ROOT }),
      });
    }

    const artifact = await readRagArtifact({
      key,
      dataRoot: DEFAULT_SOURCE_MANAGER_DATA_ROOT,
    });

    if (url.searchParams.get("download") === "1") {
      return new NextResponse(artifact.content, {
        headers: {
          "Content-Type": artifact.contentType,
          "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
        },
      });
    }

    return NextResponse.json(artifact);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Artifact read failed.";
    const status = message.startsWith("Unknown RAG artifact") ? 400 : 404;
    return NextResponse.json({ error: message }, { status });
  }
}
