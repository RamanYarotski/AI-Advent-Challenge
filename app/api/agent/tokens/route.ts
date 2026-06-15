import { NextResponse } from "next/server";
import { callLlm, type ChatMessage } from "@/lib/llm";
import {
  createTokenDialog,
  deleteTokenDialog,
  makeMetricId,
  readTokenLabState,
  writeTokenLabState,
} from "@/lib/agent/token-dialog-store";
import {
  estimateMessageTokens,
  estimateTextTokens,
  getProviderResponseTokens,
  getProviderTotalTokens,
  type TokenLabState,
  type TokenMetricRow,
} from "@/lib/tokens";

export const runtime = "nodejs";

type TokenAction =
  | "create_dialog"
  | "delete_dialog"
  | "send_message"
  | "set_active_dialog"
  | "rename_dialog";

type TokenRequestBody = {
  action?: TokenAction;
  dialogId?: string;
  title?: string;
  prompt?: string;
  model?: string;
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

export async function GET() {
  try {
    const state = await readTokenLabState();
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load token dialogs.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TokenRequestBody;
    const action = body.action ?? "send_message";
    const state = await readTokenLabState();

    if (action === "create_dialog") {
      const nextState = createTokenDialog(state);
      await writeTokenLabState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "delete_dialog") {
      if (!body.dialogId) {
        return NextResponse.json(
          { error: "dialogId is required." },
          { status: 400 },
        );
      }
      const nextState = deleteTokenDialog(state, body.dialogId);
      await writeTokenLabState(nextState);
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
      await writeTokenLabState(nextState);
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
      const exists = state.dialogs.some((dialog) => dialog.id === body.dialogId);
      if (!exists) {
        return NextResponse.json(
          { error: "Dialog was not found." },
          { status: 404 },
        );
      }
      const nextState = {
        ...state,
        dialogs: state.dialogs.map((dialog) =>
          dialog.id === body.dialogId ? { ...dialog, title } : dialog,
        ),
      };
      await writeTokenLabState(nextState);
      return NextResponse.json(nextState);
    }

    const prompt = body.prompt?.trim();
    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt is required." },
        { status: 400 },
      );
    }

    const active = getActiveDialog(state);
    const userMessage: ChatMessage = { role: "user", content: prompt };
    const messagesForCall = [...active.messages, userMessage];
    const requestTokens = estimateTextTokens(prompt).estimatedTokens;
    const contextTokens = estimateMessageTokens(messagesForCall).estimatedTokens;

    const result = await callLlm({
      messages: messagesForCall,
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
      id: makeMetricId(),
      turn: active.metrics.length + 1,
      status: "sent",
      requestTokens,
      contextTokens,
      responseTokens,
      totalTokens,
      elapsedMs: result.elapsedMs,
      providerCost: result.usage.providerCost,
      note:
        result.usage.providerCost === null
          ? "This provider did not return cost data for this turn."
          : "Provider returned cost data for this turn.",
    };
    const nextState = withUpdatedActiveDialog(state, (dialog) => ({
      ...dialog,
      messages: [...messagesForCall, assistantMessage],
      metrics: [...dialog.metrics, metricRow],
    }));
    await writeTokenLabState(nextState);

    return NextResponse.json(nextState);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected token dialog error.",
      },
      { status: 500 },
    );
  }
}
