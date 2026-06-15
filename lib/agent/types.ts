import type { ChatMessage, LlmResult } from "@/lib/llm";

export type AgentTraceStep =
  | "received_user_input"
  | "loaded_persistent_history"
  | "built_messages"
  | "called_llm"
  | "saved_persistent_history"
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

export type MemoryAgentResponse = AgentResponse & {
  history: ChatMessage[];
};
