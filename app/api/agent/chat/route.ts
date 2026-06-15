import { NextResponse } from "next/server";
import { SimpleAgent } from "@/lib/agent/simple-agent";

type AgentChatRequest = {
  prompt?: string;
  model?: string;
  system?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AgentChatRequest;
    const prompt = body.prompt?.trim();

    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt is required." },
        { status: 400 },
      );
    }

    const agent = new SimpleAgent();
    const result = await agent.run({
      prompt,
      model: body.model?.trim() || undefined,
      system: body.system?.trim() || undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected agent request error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
