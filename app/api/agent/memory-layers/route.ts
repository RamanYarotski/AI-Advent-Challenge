import { NextResponse } from "next/server";
import {
  appendMemoryNote,
  createMemoryDialog,
  deleteMemoryDialog,
  getActiveMemoryBranch,
  getActiveMemoryDialog,
  makeMemoryLayerId,
  type MemoryBranch,
  type MemoryDialog,
  type MemoryFileSettings,
  type MemoryLayerEvent,
  type MemoryLayerKey,
  type MemoryLayerNote,
  readMemoryLayersState,
  updateMemoryFileSettings,
  withUpdatedActiveMemoryDialog,
  writeMemoryLayersState,
} from "@/lib/agent/memory-layers-store";
import { callLlm, type ChatMessage } from "@/lib/llm";
import {
  estimateMessageTokens,
  estimateTextTokens,
  getProviderResponseTokens,
  getProviderTotalTokens,
  type TokenMetricRow,
} from "@/lib/tokens";

export const runtime = "nodejs";

type MemoryLayerAction =
  | "create_dialog"
  | "delete_dialog"
  | "send_message"
  | "set_active_dialog"
  | "rename_dialog"
  | "set_file_settings";

type MemoryLayersRequestBody = {
  action?: MemoryLayerAction;
  dialogId?: string;
  title?: string;
  prompt?: string;
  model?: string;
  fileSettings?: Partial<MemoryFileSettings>;
};

type AssistantMemoryUpdate = {
  layer: "working" | "longTerm";
  text: string;
  confidence: number;
  reason: string;
};

type AssistantStructuredResult = {
  answer: string;
  branch: {
    action: "keep" | "rename" | "create";
    title: string | null;
    summary: string | null;
    reason: string | null;
  };
  memoryUpdates: AssistantMemoryUpdate[];
  confirmationQuestion: string | null;
};

const MAX_RECENT_BRANCH_MESSAGES = 8;
const SUMMARY_TRIGGER_MESSAGES = 12;
const AUTO_SAVE_CONFIDENCE = 0.72;
const CONFIRMATION_CONFIDENCE = 0.45;

function layerLabel(layer: MemoryLayerKey) {
  if (layer === "shortTerm") {
    return "short-term";
  }
  if (layer === "working") {
    return "working";
  }
  return "long-term";
}

function visibleMessages(messages: ChatMessage[]) {
  return messages.filter((message) => message.role !== "system");
}

function formatNotes(title: string, notes: MemoryLayerNote[]) {
  if (!notes.length) {
    return `${title}:\n- empty`;
  }

  return `${title}:\n${notes
    .slice(-16)
    .map((note) => `- ${note.text}`)
    .join("\n")}`;
}

function normalizeWords(text: string) {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, " ")
        .split(/\s+/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 4),
    ),
  );
}

function branchSearchText(branch: MemoryBranch) {
  return [
    branch.title,
    branch.summary,
    ...visibleMessages(branch.messages)
      .slice(-4)
      .map((message) => message.content),
  ].join(" ");
}

function scoreBranch(prompt: string, branch: MemoryBranch) {
  const promptWords = normalizeWords(prompt);
  if (!promptWords.length) {
    return 0;
  }

  const branchWords = new Set(normalizeWords(branchSearchText(branch)));
  return promptWords.filter((word) => branchWords.has(word)).length;
}

function selectRelevantBranch(dialog: MemoryDialog, prompt: string) {
  const active = getActiveMemoryBranch(dialog);
  const scored = dialog.branches
    .map((branch) => ({ branch, score: scoreBranch(prompt, branch) }))
    .sort((left, right) => right.score - left.score);
  const best = scored[0];

  if (!best || best.score === 0) {
    return {
      branch: active,
      reason: "No stronger existing topic match was found; current branch stayed active.",
    };
  }

  if (best.branch.id === active.id || best.score >= 2) {
    return {
      branch: best.branch,
      reason:
        best.branch.id === active.id
          ? "Current branch is still the best topic match."
          : `Matched existing topic by ${best.score} shared terms.`,
    };
  }

  return {
    branch: active,
    reason: "Existing topic match was weak, so the active branch stayed active.",
  };
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return "{}";
  }
  return candidate.slice(start, end + 1);
}

function normalizeConfidence(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0;
}

function normalizeStructuredResult(value: unknown, fallbackAnswer: string): AssistantStructuredResult {
  if (!value || typeof value !== "object") {
    return {
      answer: fallbackAnswer,
      branch: {
        action: "keep",
        title: null,
        summary: null,
        reason: "The model did not return structured branch data.",
      },
      memoryUpdates: [],
      confirmationQuestion: null,
    };
  }

  const candidate = value as {
    answer?: unknown;
    branch?: unknown;
    memoryUpdates?: unknown;
    confirmationQuestion?: unknown;
  };
  const rawBranch =
    candidate.branch && typeof candidate.branch === "object"
      ? (candidate.branch as Record<string, unknown>)
      : {};
  const action =
    rawBranch.action === "rename" || rawBranch.action === "create"
      ? rawBranch.action
      : "keep";
  const memoryUpdates: AssistantMemoryUpdate[] = Array.isArray(candidate.memoryUpdates)
    ? candidate.memoryUpdates
        .map((item) => {
          const update = item as Partial<AssistantMemoryUpdate>;
          const layer =
            update.layer === "working" || update.layer === "longTerm"
              ? update.layer
              : null;
          if (!layer) {
            return null;
          }
          return {
            layer,
            text: typeof update.text === "string" ? update.text.trim() : "",
            confidence: normalizeConfidence(update.confidence),
            reason: typeof update.reason === "string" ? update.reason.trim() : "",
          };
        })
        .filter(
          (update): update is AssistantMemoryUpdate =>
            update !== null && update.text.length > 0,
        )
    : [];

  return {
    answer:
      typeof candidate.answer === "string" && candidate.answer.trim()
        ? candidate.answer.trim()
        : fallbackAnswer,
    branch: {
      action,
      title:
        typeof rawBranch.title === "string" && rawBranch.title.trim()
          ? rawBranch.title.trim().slice(0, 64)
          : null,
      summary:
        typeof rawBranch.summary === "string" && rawBranch.summary.trim()
          ? rawBranch.summary.trim()
          : null,
      reason:
        typeof rawBranch.reason === "string" && rawBranch.reason.trim()
          ? rawBranch.reason.trim()
          : null,
    },
    memoryUpdates,
    confirmationQuestion:
      typeof candidate.confirmationQuestion === "string" &&
      candidate.confirmationQuestion.trim()
        ? candidate.confirmationQuestion.trim()
        : null,
  };
}

function parseAssistantResult(answer: string) {
  try {
    return normalizeStructuredResult(JSON.parse(extractJsonObject(answer)), answer);
  } catch {
    return normalizeStructuredResult(null, answer);
  }
}

function noteExists(notes: MemoryLayerNote[], text: string) {
  return notes.some(
    (note) => note.text.trim().toLowerCase() === text.trim().toLowerCase(),
  );
}

function makeNote(text: string, source: string): MemoryLayerNote {
  return {
    id: makeMemoryLayerId("memory-note"),
    text,
    source,
    createdAt: new Date().toISOString(),
  };
}

function makeBranch(title: string, userMessage: ChatMessage, assistantMessage: ChatMessage): MemoryBranch {
  return {
    id: makeMemoryLayerId("memory-branch"),
    title,
    summary: "",
    messages: [userMessage, assistantMessage],
    updatedAt: new Date().toISOString(),
  };
}

function buildMessages(input: {
  prompt: string;
  selectedBranch: MemoryBranch;
  recentMessages: ChatMessage[];
  workingMemory: MemoryLayerNote[];
  longTermMemory: MemoryLayerNote[];
  filePathsText: string;
  needsSummary: boolean;
}) {
  return [
    {
      role: "system" as const,
      content: [
        "You are the unified AI Advent Challenge assistant.",
        "Use Day 9 compression, Day 10 topic branching, and Day 11 memory layers as one product.",
        "The user must not choose context strategies manually.",
        "Prefer automatic memory writes for clear facts. Ask a confirmation question only when the memory layer, durability, or wording is genuinely ambiguous.",
        "Return only valid JSON. Do not wrap the JSON in markdown.",
        "",
        "JSON schema:",
        '{"answer":"assistant reply","branch":{"action":"keep|rename|create","title":null,"summary":null,"reason":null},"memoryUpdates":[{"layer":"working|longTerm","text":"fact to save","confidence":0.0,"reason":"short reason"}],"confirmationQuestion":null}',
        "",
        "Memory rules:",
        "- working: current task, active project decisions, temporary constraints, open implementation goals.",
        "- longTerm: stable user preferences, reusable profile facts, durable global rules.",
        "- Ordinary questions and transient chat should not be added to memoryUpdates.",
        "- Use confidence >= 0.72 for clear automatic writes.",
        "- Use confidence 0.45-0.71 only when a confirmation question is necessary.",
        "- Keep confirmation questions rare and concise.",
        "- If the current topic has become a clearly separate topic, set branch.action to create and provide a short title.",
        "- If the current branch title can be improved, set branch.action to rename and provide a short title.",
        input.needsSummary
          ? "- The branch is long enough to compress. Return branch.summary with an updated compact summary of older important facts."
          : "- Return branch.summary only if the existing summary should be improved.",
      ].join("\n"),
    },
    {
      role: "system" as const,
      content: [
        input.filePathsText,
        `Selected branch: ${input.selectedBranch.title}`,
        `Selected branch summary:\n${input.selectedBranch.summary || "- empty"}`,
        formatNotes("Working memory", input.workingMemory),
        formatNotes("Long-term memory", input.longTermMemory),
      ].join("\n\n"),
    },
    ...input.recentMessages,
    {
      role: "user" as const,
      content: input.prompt,
    },
  ];
}

function summarizeMetrics(rows: TokenMetricRow[]) {
  if (!rows.length) {
    return "No requests yet.";
  }

  const last = rows[rows.length - 1];
  const totalCost = rows.reduce(
    (sum, row) => sum + (row.providerCost ?? 0),
    0,
  );
  const costText =
    rows.some((row) => row.providerCost !== null)
      ? `$${totalCost.toFixed(6)}`
      : "n/a";

  return `${rows.length} turns | last context ${last.contextTokens.toLocaleString("en-US")} tokens | last total ${
    last.totalTokens === null ? "n/a" : last.totalTokens.toLocaleString("en-US")
  } tokens | total provider cost ${costText}`;
}

function applyMemoryUpdates(input: {
  updates: AssistantMemoryUpdate[];
  workingMemory: MemoryLayerNote[];
  longTermMemory: MemoryLayerNote[];
  workingFilePath: string;
  longTermFilePath: string;
}) {
  const workingMemory = [...input.workingMemory];
  const longTermMemory = [...input.longTermMemory];
  const workingWrites: string[] = [];
  const longTermWrites: string[] = [];
  const events: MemoryLayerEvent[] = [];
  let confirmationQuestion: string | null = null;

  for (const update of input.updates) {
    const filePath =
      update.layer === "working" ? input.workingFilePath : input.longTermFilePath;

    if (update.confidence >= AUTO_SAVE_CONFIDENCE) {
      if (update.layer === "working") {
        if (noteExists(workingMemory, update.text)) {
          events.push({
            layer: "working",
            action: "skipped",
            detail: `Already stored: ${update.text}`,
            filePath,
          });
        } else {
          workingWrites.push(update.text);
          workingMemory.push(makeNote(update.text, `assistant: ${update.reason}`));
          events.push({
            layer: "working",
            action: "saved",
            detail: `${update.text}\nconfidence: ${update.confidence}\n${update.reason}`,
            filePath,
          });
        }
      }

      if (update.layer === "longTerm") {
        if (noteExists(longTermMemory, update.text)) {
          events.push({
            layer: "longTerm",
            action: "skipped",
            detail: `Already stored: ${update.text}`,
            filePath,
          });
        } else {
          longTermWrites.push(update.text);
          longTermMemory.push(makeNote(update.text, `assistant: ${update.reason}`));
          events.push({
            layer: "longTerm",
            action: "saved",
            detail: `${update.text}\nconfidence: ${update.confidence}\n${update.reason}`,
            filePath,
          });
        }
      }
    } else if (update.confidence >= CONFIRMATION_CONFIDENCE) {
      confirmationQuestion =
        confirmationQuestion ??
        `Should I save "${update.text}" to ${update.layer === "working" ? "working memory" : "long-term memory"}?`;
      events.push({
        layer: update.layer === "working" ? "working" : "longTerm",
        action: "needs_confirmation",
        detail: `${update.text}\nconfidence: ${update.confidence}\n${update.reason}`,
        filePath,
      });
    }
  }

  if (!events.some((event) => event.action === "saved")) {
    events.push({
      layer: "working",
      action: "skipped",
      detail: "No clear current-task fact was saved automatically.",
      filePath: input.workingFilePath,
    });
    events.push({
      layer: "longTerm",
      action: "skipped",
      detail: "No clear stable preference or reusable fact was saved automatically.",
      filePath: input.longTermFilePath,
    });
  }

  return {
    workingMemory: workingMemory.slice(-32),
    longTermMemory: longTermMemory.slice(-32),
    workingWrites,
    longTermWrites,
    events,
    confirmationQuestion,
  };
}

function updateBranch(input: {
  dialog: MemoryDialog;
  selectedBranch: MemoryBranch;
  structured: AssistantStructuredResult;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  needsSummary: boolean;
}) {
  const now = new Date().toISOString();
  let activeBranchId = input.selectedBranch.id;
  let branches = input.dialog.branches;
  const events: MemoryLayerEvent[] = [];

  if (input.structured.branch.action === "create") {
    const title = input.structured.branch.title || "New topic";
    const branch = makeBranch(title, input.userMessage, input.assistantMessage);
    activeBranchId = branch.id;
    branches = [...branches, branch];
    events.push({
      layer: "shortTerm",
      action: "created_branch",
      detail: input.structured.branch.reason || `Created topic branch: ${title}`,
      filePath: "",
    });
  } else {
    branches = branches.map((branch) => {
      if (branch.id !== input.selectedBranch.id) {
        return branch;
      }

      const nextMessages = [
        ...visibleMessages(branch.messages),
        input.userMessage,
        input.assistantMessage,
      ];
      const summary =
        input.structured.branch.summary ??
        branch.summary;
      const shouldPrune =
        input.needsSummary &&
        summary.trim().length > 0 &&
        nextMessages.length > MAX_RECENT_BRANCH_MESSAGES;

      if (input.structured.branch.action === "rename" && input.structured.branch.title) {
        events.push({
          layer: "shortTerm",
          action: "selected_branch",
          detail: `Renamed branch to ${input.structured.branch.title}.`,
          filePath: "",
        });
      }

      if (summary !== branch.summary) {
        events.push({
          layer: "shortTerm",
          action: "updated_summary",
          detail: "Updated branch summary.",
          filePath: "",
        });
      }

      return {
        ...branch,
        title:
          input.structured.branch.action === "rename" && input.structured.branch.title
            ? input.structured.branch.title
            : branch.title,
        summary,
        messages: shouldPrune
          ? nextMessages.slice(-MAX_RECENT_BRANCH_MESSAGES)
          : nextMessages,
        updatedAt: now,
      };
    });
  }

  const activeBranch =
    branches.find((branch) => branch.id === activeBranchId) ?? branches[0];

  return {
    activeBranchId,
    branches,
    messages: [
      input.dialog.messages.find((message) => message.role === "system") ?? {
        role: "system" as const,
        content:
          "You are a unified AI Advent Challenge assistant. Use memory and topic branches deliberately.",
      },
      ...visibleMessages(activeBranch.messages),
    ],
    events,
  };
}

export async function GET() {
  try {
    const state = await readMemoryLayersState();
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load memory layers.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as MemoryLayersRequestBody;
    const action = body.action ?? "send_message";
    const state = await readMemoryLayersState();

    if (action === "create_dialog") {
      const nextState = createMemoryDialog(state);
      await writeMemoryLayersState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "delete_dialog") {
      if (!body.dialogId) {
        return NextResponse.json({ error: "dialogId is required." }, { status: 400 });
      }
      const nextState = deleteMemoryDialog(state, body.dialogId);
      await writeMemoryLayersState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "set_active_dialog") {
      if (!body.dialogId) {
        return NextResponse.json({ error: "dialogId is required." }, { status: 400 });
      }
      const nextState = { ...state, activeDialogId: body.dialogId };
      await writeMemoryLayersState(nextState);
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
      await writeMemoryLayersState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "set_file_settings") {
      if (!body.fileSettings) {
        return NextResponse.json(
          { error: "fileSettings is required." },
          { status: 400 },
        );
      }
      const nextState = updateMemoryFileSettings(state, body.fileSettings);
      await writeMemoryLayersState(nextState);
      return NextResponse.json(nextState);
    }

    const prompt = body.prompt?.trim();
    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
    }

    const active = getActiveMemoryDialog(state);
    const selected = selectRelevantBranch(active, prompt);
    const selectedVisible = visibleMessages(selected.branch.messages);
    const needsSummary = selectedVisible.length >= SUMMARY_TRIGGER_MESSAGES;
    const recentMessages = selectedVisible.slice(-MAX_RECENT_BRANCH_MESSAGES);
    const filePathsText = [
      "Memory files:",
      `- Short-term branch JSON: ${state.filePaths.shortTerm}`,
      `- Working memory Markdown: ${state.filePaths.working}`,
      `- Long-term memory Markdown: ${state.filePaths.longTerm}`,
    ].join("\n");
    const messagesForCall = buildMessages({
      prompt,
      selectedBranch: selected.branch,
      recentMessages,
      workingMemory: state.workingMemory,
      longTermMemory: state.longTermMemory,
      filePathsText,
      needsSummary,
    });
    const result = await callLlm({
      messages: messagesForCall,
      model: body.model,
      temperature: 0.2,
    });
    const structured = parseAssistantResult(result.answer);
    const memoryUpdate = applyMemoryUpdates({
      updates: structured.memoryUpdates,
      workingMemory: state.workingMemory,
      longTermMemory: state.longTermMemory,
      workingFilePath: state.filePaths.working,
      longTermFilePath: state.filePaths.longTerm,
    });

    for (const text of memoryUpdate.workingWrites) {
      await appendMemoryNote(state.filePaths.working, text, "assistant");
    }
    for (const text of memoryUpdate.longTermWrites) {
      await appendMemoryNote(state.filePaths.longTerm, text, "assistant");
    }

    const confirmationQuestion =
      structured.confirmationQuestion ?? memoryUpdate.confirmationQuestion;
    const assistantAnswer =
      confirmationQuestion && !structured.answer.includes(confirmationQuestion)
        ? `${structured.answer}\n\n${confirmationQuestion}`
        : structured.answer;
    const userMessage: ChatMessage = { role: "user", content: prompt };
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: assistantAnswer,
    };
    const branchUpdate = updateBranch({
      dialog: active,
      selectedBranch: selected.branch,
      structured,
      userMessage,
      assistantMessage,
      needsSummary,
    });
    const contextTokens = estimateMessageTokens(messagesForCall).estimatedTokens;
    const requestTokens = estimateTextTokens(prompt).estimatedTokens;
    const responseTokens = getProviderResponseTokens(result.usage, assistantAnswer);
    const totalTokens = getProviderTotalTokens(
      result.usage,
      contextTokens,
      responseTokens,
    );
    const metricRow: TokenMetricRow = {
      id: makeMemoryLayerId("memory-metric"),
      turn: active.metrics.length + 1,
      status: "sent",
      requestTokens,
      contextTokens,
      responseTokens,
      totalTokens,
      elapsedMs: result.elapsedMs,
      providerCost: result.usage.providerCost,
      note: `Branch "${selected.branch.title}" used ${recentMessages.length} recent messages${
        needsSummary ? " with summary compression" : ""
      }.`,
    };
    const nextMetrics = [...active.metrics, metricRow];
    const shortTermEvents: MemoryLayerEvent[] = [
      {
        layer: "shortTerm",
        action: "saved",
        detail: "User message and assistant answer were stored in the selected topic branch.",
        filePath: state.filePaths.shortTerm,
      },
      {
        layer: "shortTerm",
        action: "selected_branch",
        detail: `${selected.branch.title}: ${selected.reason}`,
        filePath: state.filePaths.shortTerm,
      },
      {
        layer: "shortTerm",
        action: "prompt_context",
        detail: `Prompt assembly used branch summary (${selected.branch.summary ? "present" : "empty"}), ${recentMessages.length} recent branch messages, working memory, and long-term memory.`,
        filePath: state.filePaths.shortTerm,
      },
      ...branchUpdate.events.map((event) => ({
        ...event,
        filePath: event.filePath || state.filePaths.shortTerm,
      })),
    ];
    const nextState = withUpdatedActiveMemoryDialog(
      {
        ...state,
        workingMemory: memoryUpdate.workingMemory,
        longTermMemory: memoryUpdate.longTermMemory,
      },
      (dialog) => ({
        ...dialog,
        activeBranchId: branchUpdate.activeBranchId,
        branches: branchUpdate.branches,
        messages: branchUpdate.messages,
        metrics: nextMetrics,
        compactMetricsSummary: summarizeMetrics(nextMetrics),
        pendingConfirmation: confirmationQuestion,
      }),
    );
    await writeMemoryLayersState(nextState);

    return NextResponse.json({
      ...nextState,
      events: [...shortTermEvents, ...memoryUpdate.events],
      recentMessageCount: recentMessages.length,
      result: {
        ...result,
        answer: assistantAnswer,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected memory layers error.",
      },
      { status: 500 },
    );
  }
}
