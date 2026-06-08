import { NextResponse } from "next/server";
import { callLlm, type ChatMessage } from "@/lib/llm";

type ChatRequest = {
  prompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stop?: string;
  system?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest;
    const prompt = body.prompt?.trim();

    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt is required." },
        { status: 400 },
      );
    }

    const messages: ChatMessage[] = [];
    if (body.system?.trim()) {
      messages.push({ role: "system", content: body.system.trim() });
    }
    messages.push({ role: "user", content: prompt });

    const result = await callLlm({
      messages,
      model: body.model?.trim(),
      temperature: body.temperature,
      maxTokens: body.maxTokens,
      stop: body.stop?.trim() || undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected LLM request error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
