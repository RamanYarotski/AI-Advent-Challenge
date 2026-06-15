import type { ChatMessage, LlmResult } from "@/lib/llm";

export type TokenBreakdown = {
  characters: number;
  words: number;
  estimatedTokens: number;
};

export type TokenMetricRow = {
  id: string;
  turn: number;
  status: "sent";
  requestTokens: number;
  contextTokens: number;
  responseTokens: number | null;
  totalTokens: number | null;
  elapsedMs: number | null;
  providerCost: number | null;
  note: string;
};

export type TokenDialog = {
  id: string;
  title: string;
  messages: ChatMessage[];
  metrics: TokenMetricRow[];
};

export type TokenLabState = {
  activeDialogId: string;
  dialogs: TokenDialog[];
};

const MESSAGE_OVERHEAD_TOKENS = 4;

export function estimateTextTokens(text: string): TokenBreakdown {
  const compact = text.trim();
  const words = compact ? compact.split(/\s+/).length : 0;
  const byCharacters = Math.ceil(compact.length / 4);
  const byWords = Math.ceil(words * 1.35);
  const estimatedTokens = Math.max(byCharacters, byWords, compact ? 1 : 0);

  return {
    characters: compact.length,
    words,
    estimatedTokens,
  };
}

export function estimateMessageTokens(messages: ChatMessage[]): TokenBreakdown {
  const text = messages
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
  const base = estimateTextTokens(text);

  return {
    ...base,
    estimatedTokens:
      base.estimatedTokens + messages.length * MESSAGE_OVERHEAD_TOKENS,
  };
}

export function getProviderResponseTokens(
  usage: LlmResult["usage"],
  answer: string,
) {
  return usage.completionTokens ?? estimateTextTokens(answer).estimatedTokens;
}

export function getProviderTotalTokens(
  usage: LlmResult["usage"],
  requestTokens: number,
  responseTokens: number,
) {
  return usage.totalTokens ?? requestTokens + responseTokens;
}
