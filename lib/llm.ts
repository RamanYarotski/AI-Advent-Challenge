export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type CallLlmInput = {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stop?: string;
};

type ProviderUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
};

type ProviderResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
    text?: string;
  }>;
  usage?: ProviderUsage;
  error?: {
    message?: string;
  };
};

export type LlmResult = {
  answer: string;
  model: string;
  elapsedMs: number;
  usage: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    providerCost: number | null;
  };
};

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function callLlm(input: CallLlmInput): Promise<LlmResult> {
  const apiKey = process.env.OPENAI_COMPATIBLE_API_KEY;
  const baseUrl =
    process.env.OPENAI_COMPATIBLE_BASE_URL?.replace(/\/$/, "") ||
    DEFAULT_BASE_URL;
  const model = input.model || process.env.DEFAULT_MODEL;

  if (!apiKey) {
    throw new Error(
      "OPENAI_COMPATIBLE_API_KEY is missing. Create .env.local from .env.example.",
    );
  }

  if (!model) {
    throw new Error("Model is missing. Set DEFAULT_MODEL or pass model in UI.");
  }

  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "AI Advent Challenge",
    },
    body: JSON.stringify({
      model,
      messages: input.messages,
      temperature: input.temperature,
      max_tokens: input.maxTokens,
      stop: input.stop,
    }),
  });

  const elapsedMs = Math.round(performance.now() - startedAt);
  const payload = (await response.json().catch(() => ({}))) as ProviderResponse;

  if (!response.ok) {
    throw new Error(
      payload.error?.message ||
        `LLM provider returned ${response.status} ${response.statusText}.`,
    );
  }

  const answer =
    payload.choices?.[0]?.message?.content || payload.choices?.[0]?.text || "";

  return {
    answer,
    model,
    elapsedMs,
    usage: {
      promptTokens: numberOrNull(payload.usage?.prompt_tokens),
      completionTokens: numberOrNull(payload.usage?.completion_tokens),
      totalTokens: numberOrNull(payload.usage?.total_tokens),
      providerCost: numberOrNull(payload.usage?.cost),
    },
  };
}
