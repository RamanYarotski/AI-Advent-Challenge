import { NextResponse } from "next/server";
import {
  addGlobalMetricRow,
  addPendingProfileUpdates,
  appendMemoryNote,
  applyAllPendingProfileUpdates,
  applyPendingProfileUpdate,
  createMemoryDialog,
  createUserProfile,
  deleteMemoryDialog,
  deleteUserProfile,
  dismissAllPendingProfileUpdates,
  dismissPendingProfileUpdate,
  getActiveMemoryBranch,
  getActiveMemoryDialog,
  getActiveUserProfile,
  makeMemoryLayerId,
  moveMemoryFolder,
  type MemoryBranch,
  type MemoryDialog,
  type MemoryFileSettings,
  type MemoryLayerEvent,
  type MemoryLayerKey,
  type MemoryLayerNote,
  type RequestContextDebug,
  type UserProfile,
  type UserProfileField,
  readMemoryLayersState,
  renameUserProfile,
  setActiveUserProfile,
  updateMemoryFileSettings,
  updateUserProfile,
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
  | "set_file_settings"
  | "move_memory_folder"
  | "create_profile"
  | "rename_profile"
  | "delete_profile"
  | "set_active_profile"
  | "update_profile"
  | "apply_profile_update"
  | "dismiss_profile_update"
  | "apply_all_profile_updates"
  | "dismiss_all_profile_updates";

type MemoryLayersRequestBody = {
  action?: MemoryLayerAction;
  dialogId?: string;
  title?: string;
  prompt?: string;
  model?: string;
  memoryFolder?: string;
  fileSettings?: Partial<MemoryFileSettings>;
  profileId?: string;
  profileUpdateId?: string;
  profile?: Partial<UserProfile>;
};

type AssistantMemoryUpdate = {
  layer: "working" | "longTerm";
  text: string;
  confidence: number;
  reason: string;
};

type AssistantProfileUpdate = {
  field: UserProfileField;
  value: string;
  reason: string;
  sourceText: string;
  confidence: number;
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
const PROFILE_SUGGESTION_CONFIDENCE = 0.55;

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

function profileScopedMessages(messages: ChatMessage[], profileId: string) {
  return visibleMessages(messages).filter(
    (message) => message.profileId === profileId,
  );
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

function branchSummaryForProfile(branch: MemoryBranch, profileId: string) {
  return branch.profileSummaries?.[profileId] ?? "";
}

function branchSearchText(branch: MemoryBranch, profileId: string) {
  return [
    branch.title,
    branchSummaryForProfile(branch, profileId),
    ...profileScopedMessages(branch.messages, profileId)
      .slice(-4)
      .map((message) => message.content),
  ].join(" ");
}

function scoreBranch(prompt: string, branch: MemoryBranch, profileId: string) {
  const promptWords = normalizeWords(prompt);
  if (!promptWords.length) {
    return 0;
  }

  const branchWords = new Set(normalizeWords(branchSearchText(branch, profileId)));
  return promptWords.filter((word) => branchWords.has(word)).length;
}

function selectRelevantBranch(dialog: MemoryDialog, prompt: string, profileId: string) {
  const active = getActiveMemoryBranch(dialog);
  const scored = dialog.branches
    .map((branch) => ({ branch, score: scoreBranch(prompt, branch, profileId) }))
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

function extractJsonValue(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? trimmed;
  const objectStart = candidate.indexOf("{");
  const arrayStart = candidate.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;

  if (start === -1) {
    return "{}";
  }

  const opener = candidate[start];
  const closer = opener === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(closer);

  if (end === -1 || end <= start) {
    return "{}";
  }

  return candidate.slice(start, end + 1);
}

function normalizeConfidence(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0;
}

function normalizeProfileField(value: unknown): UserProfileField | null {
  if (value === "role" || value === "context" || value === "role_context") {
    return "roleContext";
  }
  return value === "roleContext" ||
    value === "style" ||
    value === "format" ||
    value === "constraints"
    ? value
    : null;
}

function isProfileLikeMemoryText(text: string) {
  return /\b(prefer|prefers|preference|style|format|tone|verbosity|communication|answer|answers|bullet|bullets|list|lists|concise|detailed|positive|avoid|forbidden|disliked|do not|don't|plain language|step-by-step)\b/i.test(
    text,
  );
}

function filterProfileLikeMemoryNotes(notes: MemoryLayerNote[]) {
  const filtered = notes.filter((note) => !isProfileLikeMemoryText(note.text));

  return {
    notes: filtered,
    removedCount: notes.length - filtered.length,
  };
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

function normalizeProfileUpdates(value: unknown): AssistantProfileUpdate[] {
  const candidate = value as { profileUpdates?: unknown };
  const updates = Array.isArray(value)
    ? value
    : Array.isArray(candidate?.profileUpdates)
      ? candidate.profileUpdates
      : [];

  return updates.length > 0
    ? updates
        .map((item) => {
          const update = item as Partial<AssistantProfileUpdate>;
          const field = normalizeProfileField(update.field);
          if (!field) {
            return null;
          }
          return {
            field,
            value: typeof update.value === "string" ? update.value.trim() : "",
            reason: typeof update.reason === "string" ? update.reason.trim() : "",
            sourceText:
              typeof update.sourceText === "string"
                ? update.sourceText.trim()
                : "",
            confidence: normalizeConfidence(update.confidence),
          };
        })
        .filter(
          (update): update is AssistantProfileUpdate =>
            update !== null &&
            update.value.length > 0 &&
            update.confidence >= PROFILE_SUGGESTION_CONFIDENCE,
        )
    : [];
}

function parseProfileExtractorResult(answer: string) {
  try {
    return normalizeProfileUpdates(JSON.parse(extractJsonValue(answer)));
  } catch {
    return [];
  }
}

function buildProfileExtractorMessages(input: {
  prompt: string;
  activeProfile: UserProfile;
}) {
  return [
    {
      role: "system" as const,
      content: [
        "You are a language-agnostic profile preference extractor.",
        "Detect explicit user preferences in any language.",
        "Return only valid JSON. Do not wrap JSON in markdown.",
        "Return canonical English profile values.",
        "Keep sourceText exactly as written by the user.",
        "Do not infer preferences from vague behavior, assistant messages, prior messages, or guesses.",
        "Only use the current user message as evidence.",
        "If there are no explicit profile preferences, return an empty profileUpdates array.",
        "If a message explicitly states how the assistant should communicate or what tools/approaches to use or avoid, return a suggestion even when the message is not in English.",
        "",
        "Allowed fields:",
        "- roleContext: explicit user role, background, work context, or durable personal context.",
        "- style: preferred tone, verbosity, communication style, or answer personality.",
        "- format: preferred response structure, bullets, tables, code-first, step-by-step, etc.",
        "- constraints: explicit do/don't rules, disliked tools, forbidden approaches, durable limits.",
        "",
        "Examples:",
        'User: "предпочитаю лаконичный стиль общения и ответы списками"',
        '{"profileUpdates":[{"field":"style","value":"Concise communication style","reason":"The user explicitly prefers concise communication.","sourceText":"предпочитаю лаконичный стиль общения и ответы списками","confidence":0.92},{"field":"format","value":"Answer with bullet points","reason":"The user explicitly prefers answers as lists.","sourceText":"предпочитаю лаконичный стиль общения и ответы списками","confidence":0.92}]}',
        'User: "я против использования RXJava"',
        '{"profileUpdates":[{"field":"constraints","value":"Avoid using or recommending RXJava","reason":"The user explicitly rejects RXJava.","sourceText":"я против использования RXJava","confidence":0.94}]}',
        "",
        "JSON schema:",
        '{"profileUpdates":[{"field":"roleContext|style|format|constraints","value":"canonical English preference","reason":"short English reason","sourceText":"exact user text","confidence":0.0}]}',
      ].join("\n"),
    },
    {
      role: "system" as const,
      content: [
        "Active profile:",
        `Name: ${input.activeProfile.name}`,
        `Role/context: ${input.activeProfile.roleContext || "- empty"}`,
        `Style: ${input.activeProfile.style || "- empty"}`,
        `Format: ${input.activeProfile.format || "- empty"}`,
        `Constraints: ${input.activeProfile.constraints || "- empty"}`,
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: input.prompt,
    },
  ];
}

async function extractProfileUpdates(input: {
  prompt: string;
  activeProfile: UserProfile;
  model?: string;
}) {
  const result = await callLlm({
    messages: buildProfileExtractorMessages({
      prompt: input.prompt,
      activeProfile: input.activeProfile,
    }),
    model: input.model,
    temperature: 0,
  });

  return parseProfileExtractorResult(result.answer);
}

function filterProfilePreferenceMemoryUpdates(
  updates: AssistantMemoryUpdate[],
  suggestions: Array<{ field: UserProfileField; value: string; reason: string }>,
) {
  if (!suggestions.length) {
    return {
      keptUpdates: updates,
      suppressedCount: 0,
    };
  }

  const suggestionWords = new Set(
    normalizeWords(
      suggestions
        .map((suggestion) =>
          [suggestion.field, suggestion.value, suggestion.reason].join(" "),
        )
        .join(" "),
    ),
  );
  const keptUpdates = updates.filter((update) => {
    const updateWords = normalizeWords(`${update.text} ${update.reason}`);
    const sharedWords = updateWords.filter((word) => suggestionWords.has(word));

    return sharedWords.length < 2;
  });

  return {
    keptUpdates,
    suppressedCount: updates.length - keptUpdates.length,
  };
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
    profileSummaries: {},
    messages: [userMessage, assistantMessage],
    updatedAt: new Date().toISOString(),
  };
}

function buildMessages(input: {
  prompt: string;
  selectedBranch: MemoryBranch;
  selectedBranchSummary: string;
  recentMessages: ChatMessage[];
  workingMemory: MemoryLayerNote[];
  longTermMemory: MemoryLayerNote[];
  activeProfile: UserProfile;
  filePathsText: string;
  needsSummary: boolean;
  currentProfileSuggestionCount: number;
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
        "- longTerm: reusable facts and durable global rules that are not profile preferences.",
        "- active user profile: personalization preferences that should influence every answer without changing the assistant role.",
        "- Do not save explicit user preferences about role/context, style, answer format, or constraints to memoryUpdates. A separate profile extractor handles those as confirmed profile suggestions.",
        "- If the user asks what style, format, constraints, role, or profile preferences are active, answer only from the Active user profile block. If that field is empty, say no preference is set for the current profile.",
        "- Do not infer the current profile's preferences from recent messages, working memory, or long-term memory. Those sources can contain another profile's history.",
        input.currentProfileSuggestionCount > 0
          ? `- The current user message already produced ${input.currentProfileSuggestionCount} pending profile suggestion(s). Do not duplicate those unconfirmed preferences in working or long-term memory.`
          : "- If the current message contains only profile preferences, return an empty memoryUpdates array.",
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
        [
          "Active user profile:",
          `Name: ${input.activeProfile.name}`,
          `Role/context: ${input.activeProfile.roleContext || "- empty"}`,
          `Style: ${input.activeProfile.style || "- empty"}`,
          `Format: ${input.activeProfile.format || "- empty"}`,
          `Constraints: ${input.activeProfile.constraints || "- empty"}`,
        ].join("\n"),
        `Selected branch: ${input.selectedBranch.title}`,
        `Selected branch summary:\n${input.selectedBranchSummary || "- empty"}`,
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

function buildRequestContextDebug(input: {
  activeProfile: UserProfile;
  selectedBranch: MemoryBranch;
  selectedBranchSummary: string;
  recentMessages: ChatMessage[];
  workingMemory: MemoryLayerNote[];
  longTermMemory: MemoryLayerNote[];
  assembledMessages: ChatMessage[];
}): RequestContextDebug {
  return {
    createdAt: new Date().toISOString(),
    profile: input.activeProfile,
    selectedBranchTitle: input.selectedBranch.title,
    selectedBranchSummary: input.selectedBranchSummary,
    recentMessages: input.recentMessages,
    workingMemory: input.workingMemory,
    longTermMemory: input.longTermMemory,
    assembledMessages: input.assembledMessages,
  };
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
      detail: "No clear reusable fact or durable global rule was saved automatically.",
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
  activeProfileId: string;
}) {
  const now = new Date().toISOString();
  let activeBranchId = input.selectedBranch.id;
  let branches = input.dialog.branches;
  const events: MemoryLayerEvent[] = [];

  if (input.structured.branch.action === "create") {
    const title = input.structured.branch.title || "New topic";
    const summary = input.structured.branch.summary ?? "";
    const branch = {
      ...makeBranch(title, input.userMessage, input.assistantMessage),
      summary,
      profileSummaries: summary
        ? {
            [input.activeProfileId]: summary,
          }
        : {},
    };
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
      const profileSummaries = branch.profileSummaries ?? {};
      const currentProfileSummary =
        profileSummaries[input.activeProfileId] ?? "";
      const summary =
        input.structured.branch.summary ??
        currentProfileSummary;
      if (input.structured.branch.action === "rename" && input.structured.branch.title) {
        events.push({
          layer: "shortTerm",
          action: "selected_branch",
          detail: `Renamed branch to ${input.structured.branch.title}.`,
          filePath: "",
        });
      }

      if (summary !== currentProfileSummary) {
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
        profileSummaries: summary
          ? {
              ...profileSummaries,
              [input.activeProfileId]: summary,
            }
          : profileSummaries,
        messages: nextMessages,
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

    if (action === "move_memory_folder") {
      if (!body.memoryFolder?.trim()) {
        return NextResponse.json(
          { error: "memoryFolder is required." },
          { status: 400 },
        );
      }
      const nextState = await moveMemoryFolder(state, body.memoryFolder);
      await writeMemoryLayersState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "create_profile") {
      if (!body.title?.trim()) {
        return NextResponse.json(
          { error: "Profile name is required." },
          { status: 400 },
        );
      }
      const nextState = createUserProfile(state, body.title);
      await writeMemoryLayersState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "rename_profile") {
      if (!body.profileId || !body.title?.trim()) {
        return NextResponse.json(
          { error: "profileId and title are required." },
          { status: 400 },
        );
      }
      const nextState = renameUserProfile(state, body.profileId, body.title);
      await writeMemoryLayersState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "delete_profile") {
      if (!body.profileId) {
        return NextResponse.json({ error: "profileId is required." }, { status: 400 });
      }
      const nextState = deleteUserProfile(state, body.profileId);
      await writeMemoryLayersState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "set_active_profile") {
      if (!body.profileId) {
        return NextResponse.json({ error: "profileId is required." }, { status: 400 });
      }
      const nextState = setActiveUserProfile(state, body.profileId);
      await writeMemoryLayersState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "update_profile") {
      if (!body.profile?.id) {
        return NextResponse.json({ error: "profile is required." }, { status: 400 });
      }
      const nextState = updateUserProfile(
        state,
        body.profile as Partial<UserProfile> & { id: string },
      );
      await writeMemoryLayersState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "apply_profile_update") {
      if (!body.profileUpdateId) {
        return NextResponse.json(
          { error: "profileUpdateId is required." },
          { status: 400 },
        );
      }
      const nextState = applyPendingProfileUpdate(state, body.profileUpdateId);
      await writeMemoryLayersState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "dismiss_profile_update") {
      if (!body.profileUpdateId) {
        return NextResponse.json(
          { error: "profileUpdateId is required." },
          { status: 400 },
        );
      }
      const nextState = dismissPendingProfileUpdate(state, body.profileUpdateId);
      await writeMemoryLayersState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "apply_all_profile_updates") {
      const nextState = applyAllPendingProfileUpdates(state, body.profileId);
      await writeMemoryLayersState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "dismiss_all_profile_updates") {
      const nextState = dismissAllPendingProfileUpdates(state, body.profileId);
      await writeMemoryLayersState(nextState);
      return NextResponse.json(nextState);
    }

    const prompt = body.prompt?.trim();
    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
    }

    const active = getActiveMemoryDialog(state);
    const activeProfile = getActiveUserProfile(state);
    const selected = selectRelevantBranch(active, prompt, activeProfile.id);
    const selectedVisible = profileScopedMessages(
      selected.branch.messages,
      activeProfile.id,
    );
    const selectedBranchSummary = branchSummaryForProfile(
      selected.branch,
      activeProfile.id,
    );
    const promptWorkingMemory = filterProfileLikeMemoryNotes(state.workingMemory);
    const promptLongTermMemory = filterProfileLikeMemoryNotes(state.longTermMemory);
    const needsSummary = selectedVisible.length >= SUMMARY_TRIGGER_MESSAGES;
    const recentMessages = selectedVisible.slice(-MAX_RECENT_BRANCH_MESSAGES);
    let extractorError: string | null = null;
    let extractedProfileUpdates: AssistantProfileUpdate[] = [];
    try {
      extractedProfileUpdates = await extractProfileUpdates({
        prompt,
        activeProfile,
        model: body.model,
      });
    } catch (error) {
      extractorError =
        error instanceof Error
          ? error.message
          : "Profile extractor request failed.";
    }
    const pendingProfileUpdates = extractedProfileUpdates.map((update) => ({
      profileId: activeProfile.id,
      field: update.field,
      value: update.value,
      reason: update.reason,
      sourceText: update.sourceText || prompt,
      confidence: update.confidence,
    }));
    const filePathsText = [
      "Memory files:",
      `- Short-term branch JSON: ${state.filePaths.shortTerm}`,
      `- Working memory Markdown: ${state.filePaths.working}`,
      `- Long-term memory Markdown: ${state.filePaths.longTerm}`,
    ].join("\n");
    const messagesForCall = buildMessages({
      prompt,
      selectedBranch: selected.branch,
      selectedBranchSummary,
      recentMessages,
      workingMemory: promptWorkingMemory.notes,
      longTermMemory: promptLongTermMemory.notes,
      activeProfile,
      filePathsText,
      needsSummary,
      currentProfileSuggestionCount: pendingProfileUpdates.length,
    });
    const requestContext = buildRequestContextDebug({
      activeProfile,
      selectedBranch: selected.branch,
      selectedBranchSummary,
      recentMessages,
      workingMemory: promptWorkingMemory.notes,
      longTermMemory: promptLongTermMemory.notes,
      assembledMessages: messagesForCall,
    });
    const result = await callLlm({
      messages: messagesForCall,
      model: body.model,
      temperature: 0.2,
    });
    const structured = parseAssistantResult(result.answer);
    const filteredMemoryUpdates = filterProfilePreferenceMemoryUpdates(
      structured.memoryUpdates,
      pendingProfileUpdates,
    );
    const memoryUpdate = applyMemoryUpdates({
      updates: filteredMemoryUpdates.keptUpdates,
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
    const userMessage: ChatMessage = {
      role: "user",
      content: prompt,
      profileId: activeProfile.id,
    };
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: assistantAnswer,
      profileId: activeProfile.id,
    };
    const branchUpdate = updateBranch({
      dialog: active,
      selectedBranch: selected.branch,
      structured,
      userMessage,
      assistantMessage,
      needsSummary,
      activeProfileId: activeProfile.id,
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
        detail: [
          `Profile: ${activeProfile.name}`,
          `Memory layers: selected branch summary (${selectedBranchSummary ? "present" : "empty"}), ${recentMessages.length} profile-scoped recent messages, ${promptWorkingMemory.notes.length} working memory items, ${promptLongTermMemory.notes.length} long-term memory items.`,
          `Profile-like memory filtered from prompt: ${promptWorkingMemory.removedCount + promptLongTermMemory.removedCount}.`,
          "Injected profile fields: role/context, style, format, constraints.",
        ].join("\n"),
        filePath: state.filePaths.shortTerm,
      },
      {
        layer: "longTerm",
        action: pendingProfileUpdates.length > 0 ? "needs_confirmation" : "skipped",
        detail: extractorError
          ? `Profile extractor failed: ${extractorError}`
          : pendingProfileUpdates.length > 0
            ? `${pendingProfileUpdates.length} language-agnostic profile suggestion${
                pendingProfileUpdates.length === 1 ? "" : "s"
              } captured for review in Settings > Profile. Values are canonical English; source text stays original.`
            : "Profile extractor found no explicit profile preference in the current user message.",
        filePath: state.filePaths.userProfiles,
      },
      ...(filteredMemoryUpdates.suppressedCount > 0
        ? [
            {
              layer: "longTerm" as const,
              action: "skipped" as const,
              detail: `${filteredMemoryUpdates.suppressedCount} memory update${
                filteredMemoryUpdates.suppressedCount === 1 ? "" : "s"
              } suppressed because it duplicated pending profile suggestions.`,
              filePath: state.filePaths.longTerm,
            },
          ]
        : []),
      ...branchUpdate.events.map((event) => ({
        ...event,
        filePath: event.filePath || state.filePaths.shortTerm,
      })),
    ];
    const nextState = withUpdatedActiveMemoryDialog(
      addGlobalMetricRow({
        ...state,
        workingMemory: memoryUpdate.workingMemory,
        longTermMemory: memoryUpdate.longTermMemory,
        lastRequestContext: requestContext,
        pendingProfileUpdates: addPendingProfileUpdates(
          state,
          pendingProfileUpdates,
        ).pendingProfileUpdates,
      }, metricRow),
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
