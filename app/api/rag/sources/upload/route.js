import { NextResponse } from "next/server";
import {
  DEFAULT_SOURCE_MANAGER_DATA_ROOT,
  saveUploadedFiles,
} from "../../../../../lib/rag/source-manager.mjs";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const formData = await request.formData();
    const result = await saveUploadedFiles({
      formData,
      dataRoot: formData.get("dataRoot") || DEFAULT_SOURCE_MANAGER_DATA_ROOT,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Source upload failed." },
      { status: 400 },
    );
  }
}
