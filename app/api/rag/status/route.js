import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const dataRoot = path.join(".data", "rag-week");
const paths = {
  dataRoot,
  indexesDir: path.join(dataRoot, "indexes"),
  reportsDir: path.join(dataRoot, "reports"),
  manifest: path.join(dataRoot, "manifest.json"),
  day21Report: path.join(dataRoot, "reports", "day-21-indexing.md"),
  day22Report: path.join(dataRoot, "reports", "day-22-rag-query.md"),
  day23Report: path.join(dataRoot, "reports", "day-23-rerank-filter.md"),
  day24Report: path.join(dataRoot, "reports", "day-24-citations.md"),
  day25Report: path.join(dataRoot, "reports", "day-25-rag-chat.md"),
  fixedIndex: path.join(dataRoot, "indexes", "fixed.json"),
  structuralIndex: path.join(dataRoot, "indexes", "structural.json"),
};

async function readManifest() {
  try {
    return JSON.parse(await readFile(paths.manifest, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function GET() {
  try {
    return NextResponse.json({
      dataRoot,
      paths,
      manifest: await readManifest(),
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Status check failed." },
      { status: 500 },
    );
  }
}
