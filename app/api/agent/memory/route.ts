import { NextResponse } from "next/server";
import { MemoryAgent } from "@/lib/agent/memory-agent";
import { readMemory } from "@/lib/agent/json-memory";

export const runtime = "nodejs";

type MemoryRequestBody = {
  prompt?: string;
  model?: string;
  system?: string;
};

export async function GET() {
  try {
    const history = await readMemory();
    return NextResponse.json({ history });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load persistent history.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as MemoryRequestBody;

    if (!body.prompt?.trim()) {
      return NextResponse.json(
        { error: "Prompt is required." },
        { status: 400 },
      );
    }

    const agent = new MemoryAgent();
    const result = await agent.run({
      prompt: body.prompt,
      model: body.model,
      system: body.system,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected memory agent error.",
      },
      { status: 500 },
    );
  }
}
