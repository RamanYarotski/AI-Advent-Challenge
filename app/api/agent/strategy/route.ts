import { NextResponse } from "next/server";
import {
  createStrategyDialog,
  deleteStrategyDialog,
  makeStrategyMetricId,
  readStrategyLabState,
  writeStrategyLabState,
} from "@/lib/agent/strategy-dialog-store";
import { callLlm, type ChatMessage } from "@/lib/llm";
import {
  estimateMessageTokens,
  estimateTextTokens,
  getProviderResponseTokens,
  getProviderTotalTokens,
  type TokenDialog,
  type TokenLabState,
  type TokenMetricRow,
} from "@/lib/tokens";

export const runtime = "nodejs";

type StrategyAction =
  | "create_dialog"
  | "delete_dialog"
  | "send_message"
  | "set_active_dialog"
  | "rename_dialog"
  | "set_strategy"
  | "set_branch";

type StrategyName = "sliding_window" | "sticky_facts" | "branching";

type StrategyRequestBody = {
  action?: StrategyAction;
  dialogId?: string;
  title?: string;
  prompt?: string;
  model?: string;
  strategy?: StrategyName;
  branch?: string;
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

function systemMessage(dialog: TokenDialog): ChatMessage {
  return (
    dialog.messages.find((message) => message.role === "system") ?? {
      role: "system",
      content:
        "You are a context-strategy assistant for AI Advent Challenge.",
    }
  );
}

function visibleMessages(dialog: TokenDialog) {
  return dialog.messages.filter((message) => message.role !== "system");
}

function extractStickyFacts(prompt: string, existingFacts: string[]) {
  const nextFacts = [...existingFacts];
  const patterns = [
    /remember that\s+(.+)/i,
    /important:\s*(.+)/i,
    /fact:\s*(.+)/i,
    /preference:\s*(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match?.[1]) {
      const fact = match[1].trim();
      if (fact && !nextFacts.includes(fact)) {
        nextFacts.push(fact);
      }
    }
  }

  return nextFacts.slice(-12);
}

function buildStrategyMessages(input: {
  dialog: TokenDialog;
  prompt: string;
  recentMessages: number;
  strategy: StrategyName;
  branch: string;
}) {
  const baseSystem = systemMessage(input.dialog);
  const visible = visibleMessages(input.dialog);
  const userMessage: ChatMessage = { role: "user", content: input.prompt };

  if (input.strategy === "sticky_facts") {
    const facts = input.dialog.facts ?? [];
    return [
      baseSystem,
      {
        role: "system" as const,
        content: `Sticky facts memory:\n${facts.length ? facts.map((fact) => `- ${fact}`).join("\n") : "No sticky facts yet."}`,
      },
      ...visible.slice(-input.recentMessages),
      userMessage,
    ];
  }

  if (input.strategy === "branching") {
    const branchMessages = visible.filter((message) => {
      return (
        message.content.includes(`[branch:${input.branch}]`) ||
        !message.content.includes("[branch:")
      );
    });
    return [
      baseSystem,
      {
        role: "system" as const,
        content: `Current branch: ${input.branch}. Use only this branch context and general untagged context.`,
      },
      ...branchMessages.slice(-input.recentMessages),
      {
        role: "user" as const,
        content: `[branch:${input.branch}] ${input.prompt}`,
      },
    ];
  }

  return [baseSystem, ...visible.slice(-input.recentMessages), userMessage];
}

export async function GET() {
  try {
    const state = await readStrategyLabState();
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load strategy dialogs.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as StrategyRequestBody;
    const action = body.action ?? "send_message";
    const state = await readStrategyLabState();

    if (action === "create_dialog") {
      const nextState = createStrategyDialog(state);
      await writeStrategyLabState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "delete_dialog") {
      if (!body.dialogId) {
        return NextResponse.json({ error: "dialogId is required." }, { status: 400 });
      }
      const nextState = deleteStrategyDialog(state, body.dialogId);
      await writeStrategyLabState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "set_active_dialog") {
      if (!body.dialogId) {
        return NextResponse.json({ error: "dialogId is required." }, { status: 400 });
      }
      const nextState = { ...state, activeDialogId: body.dialogId };
      await writeStrategyLabState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "rename_dialog") {
      if (!body.dialogId || !body.title?.trim()) {
        return NextResponse.json(
          { error: "dialogId and title are required." },
          { status: 400 },
        );
      }
      const title = body.title.trim();
      const nextState = {
        ...state,
        dialogs: state.dialogs.map((dialog) =>
          dialog.id === body.dialogId ? { ...dialog, title } : dialog,
        ),
      };
      await writeStrategyLabState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "set_strategy") {
      const strategy = body.strategy ?? "sliding_window";
      const nextState = withUpdatedActiveDialog(state, (dialog) => ({
        ...dialog,
        strategy,
      }));
      await writeStrategyLabState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "set_branch") {
      const branch = body.branch?.trim() || "main";
      const nextState = withUpdatedActiveDialog(state, (dialog) => ({
        ...dialog,
        branch,
        branches: Array.from(new Set([...(dialog.branches ?? []), branch])),
      }));
      await writeStrategyLabState(nextState);
      return NextResponse.json(nextState);
    }

    const prompt = body.prompt?.trim();
    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
    }

    const recentMessages =
      typeof body.recentMessages === "number" && Number.isFinite(body.recentMessages)
        ? Math.max(2, Math.round(body.recentMessages))
        : 6;
    const active = getActiveDialog(state);
    const strategy = body.strategy ?? active.strategy ?? "sliding_window";
    const branch = body.branch ?? active.branch ?? "main";
    const facts =
      strategy === "sticky_facts"
        ? extractStickyFacts(prompt, active.facts ?? [])
        : active.facts ?? [];
    const strategyDialog = { ...active, facts, strategy, branch };
    const messagesForCall = buildStrategyMessages({
      dialog: strategyDialog,
      prompt,
      recentMessages,
      strategy,
      branch,
    });
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
    const userMessage: ChatMessage =
      strategy === "branching"
        ? { role: "user", content: `[branch:${branch}] ${prompt}` }
        : { role: "user", content: prompt };
    const assistantMessage: ChatMessage =
      strategy === "branching"
        ? { role: "assistant", content: `[branch:${branch}] ${result.answer}` }
        : { role: "assistant", content: result.answer };
    const metricRow: TokenMetricRow = {
      id: makeStrategyMetricId(),
      turn: active.metrics.length + 1,
      status: "sent",
      requestTokens,
      contextTokens,
      responseTokens,
      totalTokens,
      elapsedMs: result.elapsedMs,
      providerCost: result.usage.providerCost,
      note:
        strategy === "sliding_window"
          ? `Sliding window kept last ${recentMessages} messages.`
          : strategy === "sticky_facts"
            ? `Sticky facts available: ${facts.length}.`
            : `Branching used branch: ${branch}.`,
    };
    const nextState = withUpdatedActiveDialog(state, (dialog) => ({
      ...dialog,
      facts,
      branch,
      strategy,
      branches: Array.from(new Set([...(dialog.branches ?? []), branch])),
      messages: [...dialog.messages, userMessage, assistantMessage],
      metrics: [...dialog.metrics, metricRow],
    }));
    await writeStrategyLabState(nextState);

    return NextResponse.json(nextState);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected strategy dialog error.",
      },
      { status: 500 },
    );
  }
}
