import { NextResponse } from "next/server";
import {
  addRagSource,
  DEFAULT_SOURCE_MANAGER_DATA_ROOT,
  deleteRagSource,
  listRagSources,
  updateRagSource,
} from "../../../../lib/rag/source-manager.mjs";

function dataRootFrom(body = {}) {
  return body.dataRoot || DEFAULT_SOURCE_MANAGER_DATA_ROOT;
}

export async function GET() {
  try {
    return NextResponse.json(await listRagSources({ dataRoot: DEFAULT_SOURCE_MANAGER_DATA_ROOT }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Source list failed." },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await addRagSource({ ...body, dataRoot: dataRootFrom(body) });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Source create failed." },
      { status: 400 },
    );
  }
}

export async function PUT(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await updateRagSource({
      id: body.id,
      patch: body.patch || body,
      dataRoot: dataRootFrom(body),
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Source update failed." },
      { status: 400 },
    );
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await deleteRagSource({ id: body.id, dataRoot: dataRootFrom(body) });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Source delete failed." },
      { status: 400 },
    );
  }
}
