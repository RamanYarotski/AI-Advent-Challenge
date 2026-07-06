import { NextResponse } from "next/server";
import {
  DEFAULT_SOURCE_MANAGER_DATA_ROOT,
  deleteRagSource,
  listRagSources,
  updateRagSource,
} from "../../../../../lib/rag/source-manager.mjs";

async function idFrom(context) {
  const params = await context?.params;
  return params?.id;
}

function dataRootFrom(request, body = {}) {
  return (
    body.dataRoot ||
    new URL(request.url).searchParams.get("dataRoot") ||
    DEFAULT_SOURCE_MANAGER_DATA_ROOT
  );
}

function notFound(id) {
  return NextResponse.json({ error: `Source not found: ${id}` }, { status: 404 });
}

export async function GET(request, context) {
  try {
    const id = await idFrom(context);
    const state = await listRagSources({ dataRoot: dataRootFrom(request) });
    const source = state.sources.find((item) => item.id === id);
    return source ? NextResponse.json({ source }) : notFound(id);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Source lookup failed." },
      { status: 500 },
    );
  }
}

export async function PATCH(request, context) {
  try {
    const id = await idFrom(context);
    const body = await request.json().catch(() => ({}));
    const result = await updateRagSource({
      id,
      patch: body.patch || body,
      dataRoot: dataRootFrom(request, body),
    });
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof Error && error.message.startsWith("Source not found") ? 404 : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Source update failed." },
      { status },
    );
  }
}

export async function PUT(request, context) {
  return PATCH(request, context);
}

export async function DELETE(request, context) {
  try {
    const id = await idFrom(context);
    const result = await deleteRagSource({ id, dataRoot: dataRootFrom(request) });
    return result.deleted ? NextResponse.json(result) : notFound(id);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Source deletion failed." },
      { status: 400 },
    );
  }
}
