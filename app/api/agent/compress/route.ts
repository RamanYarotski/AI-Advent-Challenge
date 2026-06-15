import { NextResponse } from "next/server";
import {
  createCompressionDialog,
  deleteCompressionDialog,
  makeCompressionMetricId,
  readCompressionLabState,
  writeCompressionLabState,
} from "@/lib/agent/compression-dialog-store";
import { callLlm, type ChatMessage } from "@/lib/llm";
import {
  estimateMessageTokens,
  estimateTextTokens,
  getProviderResponseTokens,
  getProviderTotalTokens,
  type TokenLabState,
  type TokenMetricRow,
} from "@/lib/tokens";

export const runtime = "nodejs";

type CompressionAction =
  | "create_dialog"
  | "delete_dialog"
  | "send_message"
  | "set_active_dialog"
  | "rename_dialog";

type CompressionRequestBody = {
  action?: CompressionAction;
  dialogId?: string;
  title?: string;
  prompt?: string;
  model?: string;
  recentMessages?: number;
};

function getActiveDialog(state: TokenLabState) {
  return (
    state.dialogs.find((dialog) => dialog.id === state.activeDialogId) ??
    state.dialogs[0]
  );
}

function withUpdatedActiveDialog(
  state: TokenLabState,
  updater: (dialog: ReturnType<typeof getActiveDialog>) => ReturnType<typeof getActiveDialog>,
) {
  const active = getActiveDialog(state);
  return {
    ...state,
    activeDialogId: active.id,
    dialogs: state.dialogs.map((dialog) =>
      dialog.id === active.id ? updater(active) : dialog,
    ),
  };
}

function visibleMessages(messages: ChatMessage[]) {
  return messages.filter((message) => message.role !== "system");
}

async function summarizeHistory(input: {
  previousSummary: string;
  oldMessages: ChatMessage[];
  model?: string;
}) {
  if (!input.previousSummary && input.oldMessages.length === 0) {
    return "";
  }

  const summaryPrompt = `Update the compressed memory for an ongoing chat.
Keep stable facts, user preferences, decisions, unresolved tasks, and important constraints.
Do not invent details. Keep it compact.

Previous compressed memory:
${input.previousSummary || "None yet."}

Older messages to fold into memory:
${input.oldMessages.map((message) => `${message.role}: ${message.content}`).join("\n\n") || "None."}`;

  const result = await callLlm({
    messages: [
      {
        role: "system",
        content:
          "You update compact conversation memory for future LLM requests.",
      },
      { role: "user", content: summaryPrompt },
    ],
    model: input.model,
  });

  return result.answer;
}

export async function GET() {
  try {
    const state = await readCompressionLabState();
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load compression dialogs.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CompressionRequestBody;
    const action = body.action ?? "send_message";
    const state = await readCompressionLabState();

    if (action === "create_dialog") {
      const nextState = createCompressionDialog(state);
      await writeCompressionLabState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "delete_dialog") {
      if (!body.dialogId) {
        return NextResponse.json(
          { error: "dialogId is required." },
          { status: 400 },
        );
      }
      const nextState = deleteCompressionDialog(state, body.dialogId);
      await writeCompressionLabState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "set_active_dialog") {
      if (!body.dialogId) {
        return NextResponse.json(
          { error: "dialogId is required." },
          { status: 400 },
        );
      }
      const exists = state.dialogs.some((dialog) => dialog.id === body.dialogId);
      if (!exists) {
        return NextResponse.json(
          { error: "Dialog was not found." },
          { status: 404 },
        );
      }
      const nextState = { ...state, activeDialogId: body.dialogId };
      await writeCompressionLabState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "rename_dialog") {
      if (!body.dialogId) {
        return NextResponse.json(
          { error: "dialogId is required." },
          { status: 400 },
        );
      }
      const title = body.title?.trim();
      if (!title) {
        return NextResponse.json(
          { error: "Dialog title is required." },
          { status: 400 },
        );
      }
      const nextState = {
        ...state,
        dialogs: state.dialogs.map((dialog) =>
          dialog.id === body.dialogId ? { ...dialog, title } : dialog,
        ),
      };
      await writeCompressionLabState(nextState);
      return NextResponse.json(nextState);
    }

    const prompt = body.prompt?.trim();
    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt is required." },
        { status: 400 },
      );
    }

    const recentMessages =
      typeof body.recentMessages === "number" && Number.isFinite(body.recentMessages)
        ? Math.max(2, Math.round(body.recentMessages))
        : 4;
    const active = getActiveDialog(state);
    const systemMessage = active.messages.find((message) => message.role === "system");
    const visible = visibleMessages(active.messages);
    const oldMessages = visible.slice(0, -recentMessages);
    const recent = visible.slice(-recentMessages);
    const summary = await summarizeHistory({
      previousSummary: active.summary ?? "",
      oldMessages,
      model: body.model,
    });
    const userMessage: ChatMessage = { role: "user", content: prompt };
    const compressedMessages: ChatMessage[] = [
      systemMessage ?? {
        role: "system",
        content:
          "You are a context-compression assistant for AI Advent Challenge.",
      },
      ...(summary
        ? [
            {
              role: "system" as const,
              content: `Compressed older conversation memory:\n${summary}`,
            },
          ]
        : []),
      ...recent,
      userMessage,
    ];
    const requestTokens = estimateTextTokens(prompt).estimatedTokens;
    const contextTokens = estimateMessageTokens(compressedMessages).estimatedTokens;
    const result = await callLlm({
      messages: compressedMessages,
      model: body.model,
    });
    const responseTokens = getProviderResponseTokens(result.usage, result.answer);
    const totalTokens = getProviderTotalTokens(
      result.usage,
      contextTokens,
      responseTokens,
    );
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: result.answer,
    };
    const metricRow: TokenMetricRow = {
      id: makeCompressionMetricId(),
      turn: active.metrics.length + 1,
      status: "sent",
      requestTokens,
      contextTokens,
      responseTokens,
      totalTokens,
      elapsedMs: result.elapsedMs,
      providerCost: result.usage.providerCost,
      note: summary
        ? `Compressed ${oldMessages.length} older messages into memory.`
        : "No older messages needed compression yet.",
    };
    const nextState = withUpdatedActiveDialog(state, (dialog) => ({
      ...dialog,
      summary,
      messages: [
        systemMessage ?? {
          role: "system",
          content:
            "You are a context-compression assistant for AI Advent Challenge.",
        },
        ...recent,
        userMessage,
        assistantMessage,
      ],
      metrics: [...dialog.metrics, metricRow],
    }));
    await writeCompressionLabState(nextState);

    return NextResponse.json(nextState);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected compression dialog error.",
      },
      { status: 500 },
    );
  }
}
