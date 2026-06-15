import type { ChatMessage, LlmResult } from "@/lib/llm";

export type AgentTraceStep =
  | "received_user_input"
  | "built_messages"
  | "called_llm"
  | "returned_answer";

export type AgentTrace = {
  step: AgentTraceStep;
  label: string;
  detail: string;
};

export type AgentRequest = {
  prompt: string;
  model?: string;
  system?: string;
};

export type AgentResponse = LlmResult & {
  messages: ChatMessage[];
  trace: AgentTrace[];
};
