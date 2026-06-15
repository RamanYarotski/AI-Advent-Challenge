import { callLlm, type ChatMessage } from "@/lib/llm";
import type { AgentRequest, AgentResponse, AgentTrace } from "./types";

const DEFAULT_AGENT_SYSTEM_PROMPT =
  "You are a focused learning agent for AI Advent Challenge. Answer clearly, keep the user's task in scope, and avoid unrelated details.";

export class SimpleAgent {
  async run(input: AgentRequest): Promise<AgentResponse> {
    const prompt = input.prompt.trim();
    const system = input.system?.trim() || DEFAULT_AGENT_SYSTEM_PROMPT;
    const trace: AgentTrace[] = [
      {
        step: "received_user_input",
        label: "Received user input",
        detail: prompt,
      },
    ];

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ];

    trace.push({
      step: "built_messages",
      label: "Built chat messages",
      detail: messages
        .map((message) => `${message.role}: ${message.content}`)
        .join("\n\n"),
    });

    trace.push({
      step: "called_llm",
      label: "Called LLM",
      detail: input.model || "DEFAULT_MODEL",
    });

    const result = await callLlm({
      messages,
      model: input.model,
    });

    trace.push({
      step: "returned_answer",
      label: "Returned answer",
      detail: `${result.answer.length} characters`,
    });

    return {
      ...result,
      messages,
      trace,
    };
  }
}
