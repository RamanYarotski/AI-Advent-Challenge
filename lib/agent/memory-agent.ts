import { callLlm, type ChatMessage } from "@/lib/llm";
import { readMemory, writeMemory } from "./json-memory";
import type {
  AgentRequest,
  AgentTrace,
  MemoryAgentResponse,
} from "./types";

const DEFAULT_MEMORY_SYSTEM_PROMPT =
  "You are a persistent learning agent for AI Advent Challenge. Use the saved conversation history when it helps, answer clearly, and keep the current user request in focus.";

function describeMessages(messages: ChatMessage[]) {
  return messages
    .map((message, index) => {
      const preview =
        message.content.length > 600
          ? `${message.content.slice(0, 600)}...`
          : message.content;
      return `${index + 1}. ${message.role}: ${preview}`;
    })
    .join("\n\n");
}

export class MemoryAgent {
  async run(input: AgentRequest): Promise<MemoryAgentResponse> {
    const prompt = input.prompt.trim();
    const system = input.system?.trim() || DEFAULT_MEMORY_SYSTEM_PROMPT;
    const savedMessages = await readMemory();
    const hasSystemMessage = savedMessages.some(
      (message) => message.role === "system",
    );
    const history: ChatMessage[] = hasSystemMessage
      ? [...savedMessages]
      : [{ role: "system", content: system }, ...savedMessages];

    const trace: AgentTrace[] = [
      {
        step: "received_user_input",
        label: "Received user input",
        detail: prompt,
      },
      {
        step: "loaded_persistent_history",
        label: "Loaded persistent history",
        detail: `${savedMessages.length} saved messages loaded from JSON storage`,
      },
    ];

    const messages: ChatMessage[] = [
      ...history,
      { role: "user", content: prompt },
    ];

    trace.push({
      step: "built_messages",
      label: "Built chat messages",
      detail: describeMessages(messages),
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

    const nextHistory: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: result.answer },
    ];
    await writeMemory(nextHistory);

    trace.push({
      step: "saved_persistent_history",
      label: "Saved persistent history",
      detail: `${nextHistory.length} messages saved to JSON storage`,
    });

    trace.push({
      step: "returned_answer",
      label: "Returned answer",
      detail: `${result.answer.length} characters`,
    });

    return {
      ...result,
      messages,
      history: nextHistory,
      trace,
    };
  }
}

