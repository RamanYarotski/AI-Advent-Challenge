import { NextResponse } from "next/server";
import {
  addGlobalMetricRow,
  addPendingProfileUpdates,
  appendMemoryNote,
  applyAllPendingProfileUpdates,
  applyPendingProfileUpdate,
  createMemoryDialog,
  createTaskInvariant,
  createUserProfile,
  deleteMemoryDialog,
  deleteTaskInvariant,
  deleteUserProfile,
  dismissAllPendingProfileUpdates,
  dismissPendingProfileUpdate,
  getActiveMemoryBranch,
  getActiveMemoryDialog,
  getActiveUserProfile,
  makeMemoryLayerId,
  moveMemoryFolder,
  type AgentRun,
  type MemoryBranch,
  type MemoryDialog,
  type MemoryFileSettings,
  type MemoryLayerEvent,
  type MemoryLayerKey,
  type MemoryLayerNote,
  type RequestContextDebug,
  type RequirementsContract,
  type StageArtifact,
  type StagePayload,
  type SwarmRun,
  type TaskContext,
  type TaskInvariant,
  type TaskRun,
  type TaskState,
  type TransitionDecision,
  type UserProfile,
  type UserProfileField,
  type ValidationResult,
  readMemoryLayersState,
  renameUserProfile,
  setActiveUserProfile,
  updateTaskInvariant,
  updateMemoryFileSettings,
  updateUserProfile,
  withUpdatedActiveMemoryDialog,
  writeMemoryLayersState,
} from "@/lib/agent/memory-layers-store";
import { callLlm, type ChatMessage, type LlmResult } from "@/lib/llm";
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
  | "dismiss_all_profile_updates"
  | "create_invariant"
  | "update_invariant"
  | "delete_invariant";

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
  invariantId?: string;
  invariant?: Partial<TaskInvariant>;
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

type PlanningAgentResult = {
  plan: string[];
  findings: string[];
  requirementsContract: RequirementsContract;
  taskInvariants: Array<Pick<TaskInvariant, "title" | "description" | "severity">>;
  needsUserInput: boolean;
  question: string | null;
  confidence: number;
};

type ExecutionAgentResult = {
  answerDraft: string;
  completed: string[];
  current: string;
  needsUserInput: boolean;
  question: string | null;
  confidence: number;
};

type ValidationAgentResult = {
  passed: boolean;
  reason: string;
  failedInvariants: string[];
  retryInstruction: string | null;
  confidence: number;
};

type TaskOrchestrationResult = {
  structured: AssistantStructuredResult;
  taskRun: TaskRun;
  newInvariants: TaskInvariant[];
  events: MemoryLayerEvent[];
  agentRuns: AgentRun[];
  swarmRuns: SwarmRun[];
  stagePayloads: StagePayload[];
  transitions: TransitionDecision[];
  validationResult: ValidationResult | null;
};

const MAX_RECENT_BRANCH_MESSAGES = 8;
const SUMMARY_TRIGGER_MESSAGES = 12;
const AUTO_SAVE_CONFIDENCE = 0.72;
const CONFIRMATION_CONFIDENCE = 0.45;
const PROFILE_SUGGESTION_CONFIDENCE = 0.55;
const TASK_LIFECYCLE_STATES: TaskState[] = [
  "planning",
  "execution",
  "validation",
  "done",
];
const TASK_STAGE_ORDER: Record<TaskState, number> = {
  planning: 1,
  execution: 2,
  validation: 3,
  done: 4,
};
const ALLOWED_TASK_TRANSITIONS = new Set([
  "planning->planning",
  "planning->execution",
  "execution->planning",
  "execution->validation",
  "validation->execution",
  "validation->done",
]);

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
  taskRun: TaskRun;
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
        "",
        "Lifecycle task context already created:",
        `Task: ${input.taskRun.context.task}`,
        `State: ${input.taskRun.context.state}`,
        `Step: ${input.taskRun.context.step}/${input.taskRun.context.total}`,
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
  taskRun: TaskRun;
  model?: string;
}) {
  const result = await callLlm({
    messages: buildProfileExtractorMessages({
      prompt: input.prompt,
      activeProfile: input.activeProfile,
      taskRun: input.taskRun,
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

function uniqueStrings(values: string[], limit = 12) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function taskStateLabel(state: TaskState) {
  return state
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function makeEmptyRequirementsContract(): RequirementsContract {
  return {
    goal: "",
    targetLocation: null,
    requirements: [],
    constraints: [],
    assumptions: [],
    acceptanceCriteria: [],
    openQuestions: [],
    readyForApproval: false,
    updatedAt: new Date().toISOString(),
  };
}

function isUnknownContractValue(value: string) {
  return /^(unknown|not specified|unspecified|not provided|n\/a|none|null|tbd|to be determined|-+)$/i.test(
    value.trim(),
  );
}

function cleanContractItems(values: unknown, limit = 12) {
  return uniqueStrings(
    Array.isArray(values)
      ? values.filter((item): item is string => typeof item === "string")
      : [],
    limit,
  ).filter((item) => !isUnknownContractValue(item));
}

function normalizeRequirementsContractValue(value: unknown): RequirementsContract {
  if (!value || typeof value !== "object") {
    return makeEmptyRequirementsContract();
  }

  const candidate = value as Partial<RequirementsContract>;
  return {
    goal:
      typeof candidate.goal === "string" &&
      !isUnknownContractValue(candidate.goal)
        ? candidate.goal.trim()
        : "",
    targetLocation:
      typeof candidate.targetLocation === "string" &&
      candidate.targetLocation.trim() &&
      !isUnknownContractValue(candidate.targetLocation)
        ? candidate.targetLocation.trim()
        : null,
    requirements: cleanContractItems(candidate.requirements),
    constraints: cleanContractItems(candidate.constraints),
    assumptions: cleanContractItems(candidate.assumptions),
    acceptanceCriteria: cleanContractItems(candidate.acceptanceCriteria),
    openQuestions: cleanContractItems(candidate.openQuestions, 8),
    readyForApproval: candidate.readyForApproval === true,
    updatedAt:
      typeof candidate.updatedAt === "string" && candidate.updatedAt
        ? candidate.updatedAt
        : new Date().toISOString(),
  };
}

function structuralContractQuestions(contract: RequirementsContract) {
  const questions: string[] = [];
  if (!contract.goal) {
    questions.push("What exact outcome should this task achieve?");
  }
  if (!contract.targetLocation) {
    questions.push("Where should the result be delivered or implemented?");
  }
  if (!contract.requirements.length) {
    questions.push("What concrete requirements must the result satisfy?");
  }
  if (!contract.acceptanceCriteria.length) {
    questions.push("How should we know the task is complete?");
  }
  return questions;
}

function finalizeRequirementsContract(
  contract: RequirementsContract,
): RequirementsContract {
  const openQuestions = uniqueStrings(
    [...contract.openQuestions, ...structuralContractQuestions(contract)],
    8,
  );
  return {
    ...contract,
    openQuestions,
    readyForApproval:
      contract.readyForApproval &&
      openQuestions.length === 0 &&
      Boolean(contract.goal) &&
      Boolean(contract.targetLocation) &&
      contract.requirements.length > 0 &&
      contract.acceptanceCriteria.length > 0,
    updatedAt: new Date().toISOString(),
  };
}

function mergeRequirementsContracts(
  contracts: RequirementsContract[],
): RequirementsContract {
  const merged = contracts.reduce<RequirementsContract>((acc, contract) => {
    return {
      goal: acc.goal || contract.goal,
      targetLocation: acc.targetLocation || contract.targetLocation,
      requirements: uniqueStrings(
        [...acc.requirements, ...contract.requirements],
        12,
      ),
      constraints: uniqueStrings([...acc.constraints, ...contract.constraints], 12),
      assumptions: uniqueStrings([...acc.assumptions, ...contract.assumptions], 12),
      acceptanceCriteria: uniqueStrings(
        [...acc.acceptanceCriteria, ...contract.acceptanceCriteria],
        12,
      ),
      openQuestions: uniqueStrings(
        [...acc.openQuestions, ...contract.openQuestions],
        8,
      ),
      readyForApproval: acc.readyForApproval || contract.readyForApproval,
      updatedAt: new Date().toISOString(),
    };
  }, makeEmptyRequirementsContract());

  return finalizeRequirementsContract(merged);
}

function formatRequirementsContract(contract: RequirementsContract) {
  return [
    "Requirements contract:",
    `Goal: ${contract.goal || "- empty"}`,
    `Target/location: ${contract.targetLocation || "- empty"}`,
    `Requirements: ${
      contract.requirements.length ? contract.requirements.join("; ") : "- empty"
    }`,
    `Constraints: ${
      contract.constraints.length ? contract.constraints.join("; ") : "- empty"
    }`,
    `Assumptions: ${
      contract.assumptions.length ? contract.assumptions.join("; ") : "- empty"
    }`,
    `Acceptance criteria: ${
      contract.acceptanceCriteria.length
        ? contract.acceptanceCriteria.join("; ")
        : "- empty"
    }`,
    `Open questions: ${
      contract.openQuestions.length ? contract.openQuestions.join("; ") : "- empty"
    }`,
    `Ready for approval: ${contract.readyForApproval ? "yes" : "no"}`,
  ].join("\n");
}

function formatInvariantsForPrompt(invariants: TaskInvariant[]) {
  const active = invariants.filter((invariant) => invariant.enabled);
  if (!active.length) {
    return "Active invariants:\n- empty";
  }

  return [
    "Active invariants:",
    "Built-in invariants protect this host assistant and lifecycle. Do not apply host-product rules to arbitrary user-requested artifacts unless the task explicitly edits this app. The user may write requests in any language.",
    ...active.map(
      (invariant) =>
        `- [${invariant.severity}] ${invariant.title}: ${invariant.description} (source: ${invariant.source}; scope: ${invariant.scope}; stages: ${invariant.appliesTo.join(", ")})`,
    ),
  ].join("\n");
}

function formatTaskContextForPrompt(taskRun: TaskRun | null) {
  if (!taskRun) {
    return "Task context:\n- no active task run";
  }

  const { context } = taskRun;
  return [
    "Task context:",
    `Task: ${context.task}`,
    `State: ${context.state}`,
    `Step: ${context.step}/${context.total}`,
    `Current: ${context.current || "- empty"}`,
    `Plan: ${context.plan.length ? context.plan.map((item) => `- ${item}`).join("\n") : "- empty"}`,
    `Done: ${context.done.length ? context.done.map((item) => `- ${item}`).join("\n") : "- empty"}`,
    `Paused reason: ${context.pausedReason || "- none"}`,
    `Awaiting plan approval: ${context.awaitingPlanApproval ? "yes" : "no"}`,
    formatRequirementsContract(context.requirementsContract),
  ].join("\n");
}

function allowedTransitionsForStage(stage: TaskState) {
  return TASK_LIFECYCLE_STATES.filter((target) =>
    ALLOWED_TASK_TRANSITIONS.has(`${stage}->${target}`),
  );
}

function latestStageArtifact(taskRun: TaskRun, stage: TaskState) {
  return [...taskRun.artifacts]
    .reverse()
    .find((artifact) => artifact.stage === stage);
}

function formatStageList(title: string, values: string[]) {
  return `${title}: ${
    values.length ? values.map((value) => `\n- ${value}`).join("") : "- empty"
  }`;
}

function buildStageLocalContext(input: {
  stage: TaskState;
  taskRun: TaskRun;
  executionDraft?: string;
  validationResult?: ValidationResult;
}) {
  const { context } = input.taskRun;
  const allowedTransitions = allowedTransitionsForStage(input.stage);
  const base = [
    "Stage-local task context:",
    `Original user request for reference only; it may be written in any language: ${context.task}`,
    `Current stage: ${input.stage}`,
    `Lifecycle step: ${TASK_STAGE_ORDER[input.stage]}/${TASK_LIFECYCLE_STATES.length}`,
    `Awaiting plan approval: ${context.awaitingPlanApproval ? "yes" : "no"}`,
    `Allowed neighboring transitions: ${
      allowedTransitions.length
        ? allowedTransitions.map((target) => `${input.stage} -> ${target}`).join(", ")
        : "none"
    }`,
    "State ownership: do not change lifecycle state or claim completion. Return only your JSON schema; the orchestrator owns transitions.",
  ];

  if (input.stage === "planning") {
    return [
      ...base,
      `Planning current: ${context.current || "- empty"}`,
      formatStageList("Planning draft", context.plan),
      formatRequirementsContract(context.requirementsContract),
      `Paused reason: ${context.pausedReason || "- none"}`,
    ].join("\n");
  }

  if (input.stage === "execution") {
    const planningArtifact = latestStageArtifact(input.taskRun, "planning");
    return [
      ...base,
      formatRequirementsContract(context.requirementsContract),
      formatStageList("Approved plan", context.plan),
      `Planning summary: ${planningArtifact?.content || context.current || "- empty"}`,
      "Validation and Done internals are not available to this stage.",
    ].join("\n");
  }

  if (input.stage === "validation") {
    return [
      ...base,
      formatRequirementsContract(context.requirementsContract),
      formatStageList("Approved plan", context.plan),
      `Execution draft:\n${input.executionDraft || "- empty"}`,
      "Done internals are not available to this stage.",
    ].join("\n");
  }

  return [
    ...base,
    formatRequirementsContract(context.requirementsContract),
    `Passed validation: ${input.validationResult?.reason || "- empty"}`,
    `Final draft:\n${input.executionDraft || "- empty"}`,
    "Planning, Execution, and Validation internals are summarized only through the passed validation result and final draft.",
  ].join("\n");
}

function activeInvariantsForStage(
  globalInvariants: TaskInvariant[],
  taskInvariants: TaskInvariant[],
  stage: TaskState,
  prompt = "",
) {
  return [...globalInvariants, ...taskInvariants].filter(
    (invariant) =>
      invariant.enabled &&
      isInvariantRelevantToPrompt(invariant, prompt) &&
      (invariant.appliesTo.includes(stage) || invariant.appliesTo.length === 0),
  );
}

function isHostAssistantTask(prompt: string) {
  return /(ai advent|this app|current app|assistant ui|settings|profile|memory|request context|task run|current project|repo|repository|эт[оа] приложение|текущ(?:ее|ий) прилож|ассистент|настройк|профил|памят|репозитор|проект)/iu.test(
    prompt,
  );
}

function isInvariantRelevantToPrompt(invariant: TaskInvariant, prompt: string) {
  if (invariant.id !== "builtin-ui-english") {
    return true;
  }

  return isHostAssistantTask(prompt);
}

function taskInvariantsForRun(
  invariants: TaskInvariant[],
  taskRun: TaskRun,
) {
  const refs = new Set(taskRun.invariantRefs);
  return invariants.filter((invariant) => refs.has(invariant.id));
}

function buildTaskInvariant(input: {
  title: string;
  description: string;
  severity?: "blocker" | "warning";
}): TaskInvariant {
  const now = new Date().toISOString();
  return {
    id: makeMemoryLayerId("task-invariant"),
    title: input.title.trim().slice(0, 80) || "Task invariant",
    description: input.description.trim() || input.title.trim(),
    scope: "task",
    appliesTo: TASK_LIFECYCLE_STATES,
    severity: input.severity === "warning" ? "warning" : "blocker",
    enabled: true,
    source: "task",
    createdAt: now,
    updatedAt: now,
  };
}

function isExplicitPlanApproval(prompt: string) {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return /^(approve|approved|confirm|confirmed|proceed|go ahead|start execution|execute|looks good|ok|okay|yes|ship it|принимаю|подтверждаю|согласен|согласна|утверждаю|одобряю|можно|начинай|приступай|выполняй|запускай|да|ок|хорошо)([\s.!?,;:]+.*)?$/iu.test(
    normalized,
  );
}

function buildPlanApprovalQuestion(
  plan: string[],
  requirementsContract: RequirementsContract,
) {
  return [
    "Planning is complete, but I need your explicit approval before Execution.",
    "",
    formatRequirementsContract(requirementsContract),
    "",
    "Proposed plan:",
    plan.length ? plan.map((item, index) => `${index + 1}. ${item}`).join("\n") : "- empty",
    "",
    "Reply with an explicit approval, for example: `approve`, `proceed`, `начинай`, or `подтверждаю`, to start Execution. Add changes instead if the plan is not ready.",
  ].join("\n");
}

function createInitialTaskRun(prompt: string): TaskRun {
  const now = new Date().toISOString();
  return {
    context: {
      id: makeMemoryLayerId("task-run"),
      task: prompt,
      state: "planning",
      step: 1,
      total: TASK_LIFECYCLE_STATES.length,
      plan: [],
      done: [],
      current: "Build a plan and identify constraints before execution.",
      pausedReason: null,
      awaitingPlanApproval: false,
      requirementsContract: makeEmptyRequirementsContract(),
      startedAt: now,
      updatedAt: now,
    },
    invariantRefs: [],
    artifacts: [],
    agentRuns: [],
    swarmRuns: [],
    transitions: [],
    validationResult: null,
    updatedAt: now,
  };
}

function makeTransitionDecision(
  from: TaskState,
  to: TaskState,
  reason: string,
  allowed = ALLOWED_TASK_TRANSITIONS.has(`${from}->${to}`),
): TransitionDecision {
  return {
    id: makeMemoryLayerId("task-transition"),
    from,
    to,
    allowed,
    reason,
    createdAt: new Date().toISOString(),
  };
}

function makeStagePayload(input: {
  stage: TaskState;
  agentId: string;
  role: string;
  messages: ChatMessage[];
}): StagePayload {
  return {
    id: makeMemoryLayerId("stage-payload"),
    stage: input.stage,
    agentId: input.agentId,
    role: input.role,
    messages: input.messages,
    createdAt: new Date().toISOString(),
  };
}

function makeStageArtifact(
  stage: TaskState,
  title: string,
  content: string,
): StageArtifact {
  return {
    id: makeMemoryLayerId("task-artifact"),
    stage,
    title,
    content,
    summary: content.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 180) || title,
    createdAt: new Date().toISOString(),
  };
}

function makeAgentRun(input: {
  agentId: string;
  stage: TaskState;
  role: string;
  inputSummary: string;
  output: string;
  findings: string[];
  confidence: number;
}): AgentRun {
  return {
    id: makeMemoryLayerId("agent-run"),
    agentId: input.agentId,
    stage: input.stage,
    role: input.role,
    inputSummary: input.inputSummary,
    output: input.output,
    findings: uniqueStrings(input.findings, 8),
    confidence: input.confidence,
    createdAt: new Date().toISOString(),
  };
}

function normalizePlanningAgentResult(value: unknown): PlanningAgentResult {
  const candidate = value as Partial<PlanningAgentResult>;
  const taskInvariants = Array.isArray(candidate?.taskInvariants)
    ? candidate.taskInvariants
        .map((item) => {
          const invariant = item as Partial<TaskInvariant>;
          if (
            typeof invariant.title !== "string" ||
            typeof invariant.description !== "string"
          ) {
            return null;
          }
          return {
            title: invariant.title.trim(),
            description: invariant.description.trim(),
            severity: invariant.severity === "warning" ? "warning" : "blocker",
          };
        })
        .filter(
          (
            item,
          ): item is Pick<TaskInvariant, "title" | "description" | "severity"> =>
            item !== null && item.title.length > 0 && item.description.length > 0,
        )
    : [];

  return {
    plan: uniqueStrings(
      Array.isArray(candidate?.plan)
        ? candidate.plan.filter((item): item is string => typeof item === "string")
        : [],
      6,
    ),
    findings: uniqueStrings(
      Array.isArray(candidate?.findings)
        ? candidate.findings.filter((item): item is string => typeof item === "string")
        : [],
      8,
    ),
    requirementsContract: normalizeRequirementsContractValue(
      candidate?.requirementsContract,
    ),
    taskInvariants,
    needsUserInput: candidate?.needsUserInput === true,
    question:
      typeof candidate?.question === "string" && candidate.question.trim()
        ? candidate.question.trim()
        : null,
    confidence: normalizeConfidence(candidate?.confidence),
  };
}

function parsePlanningAgentResult(answer: string) {
  try {
    return normalizePlanningAgentResult(JSON.parse(extractJsonObject(answer)));
  } catch {
    return normalizePlanningAgentResult(null);
  }
}

function normalizeExecutionAgentResult(value: unknown): ExecutionAgentResult {
  const candidate = value as Partial<ExecutionAgentResult>;
  return {
    answerDraft:
      typeof candidate?.answerDraft === "string" && candidate.answerDraft.trim()
        ? candidate.answerDraft.trim()
        : "",
    completed: uniqueStrings(
      Array.isArray(candidate?.completed)
        ? candidate.completed.filter((item): item is string => typeof item === "string")
        : [],
      8,
    ),
    current:
      typeof candidate?.current === "string" && candidate.current.trim()
        ? candidate.current.trim()
        : "Prepare output for validation.",
    needsUserInput: candidate?.needsUserInput === true,
    question:
      typeof candidate?.question === "string" && candidate.question.trim()
        ? candidate.question.trim()
        : null,
    confidence: normalizeConfidence(candidate?.confidence),
  };
}

function parseExecutionAgentResult(answer: string) {
  try {
    return normalizeExecutionAgentResult(JSON.parse(extractJsonObject(answer)));
  } catch {
    return normalizeExecutionAgentResult({ answerDraft: answer, confidence: 0.4 });
  }
}

function normalizeValidationAgentResult(value: unknown): ValidationAgentResult {
  const candidate = value as Partial<ValidationAgentResult>;
  return {
    passed: candidate?.passed === true,
    reason:
      typeof candidate?.reason === "string" && candidate.reason.trim()
        ? candidate.reason.trim()
        : "Validation did not provide a reason.",
    failedInvariants: uniqueStrings(
      Array.isArray(candidate?.failedInvariants)
        ? candidate.failedInvariants.filter((item): item is string => typeof item === "string")
        : [],
      8,
    ),
    retryInstruction:
      typeof candidate?.retryInstruction === "string" &&
      candidate.retryInstruction.trim()
        ? candidate.retryInstruction.trim()
        : null,
    confidence: normalizeConfidence(candidate?.confidence),
  };
}

function parseValidationAgentResult(answer: string) {
  try {
    return normalizeValidationAgentResult(JSON.parse(extractJsonObject(answer)));
  } catch {
    return normalizeValidationAgentResult({
      passed: false,
      reason: "Validation response was not structured JSON.",
      retryInstruction: answer,
      confidence: 0.2,
    });
  }
}

function normalizeLexicalText(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}+#.\s-]/gu, " ");
}

function lexicalContains(text: string, term: string) {
  const normalizedText = ` ${normalizeLexicalText(text).replace(/\s+/g, " ")} `;
  const normalizedTerm = normalizeLexicalText(term).replace(/\s+/g, " ").trim();

  if (!normalizedTerm || normalizedTerm.length < 3) {
    return false;
  }

  return normalizedText.includes(` ${normalizedTerm} `);
}

function cleanForbiddenTerm(term: string) {
  return term
    .replace(/\b(until|unless|except|because|when|while|if|and|or|as|for|in|on|to|with|the|a|an|any|all|visible|product|current|primary|main|experience|workflow|strategy|manually|automatically|editable|separate)\b.*$/i, "")
    .replace(/[.;:,()[\]{}"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractForbiddenTerms(invariant: TaskInvariant) {
  const text = `${invariant.title}. ${invariant.description}`;
  const genericTerms = new Set([
    "done",
    "validation",
    "task",
    "tasks",
    "assistant",
    "users",
    "user",
    "context",
    "memory",
  ]);
  const patterns = [
    /\b(?:do not|don't|must not|should not|never|no|avoid|forbidden|prohibit(?:ed)?|without)\s+([^.;\n]+)/gi,
    /\b(?:must not|should not)\s+(?:use|include|add|create|reintroduce|select|choose|duplicate|move to|mark)\s+([^.;\n]+)/gi,
  ];
  const terms: string[] = [];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1] ?? "";
      const withoutLeadingVerb = raw.replace(
        /^(?:use|using|include|including|add|adding|create|creating|reintroduce|reintroducing|select|selecting|choose|choosing|duplicate|duplicating|move to|mark)\s+/i,
        "",
      );
      const term = cleanForbiddenTerm(withoutLeadingVerb);
      if (
        term &&
        normalizeWords(term).length <= 5 &&
        !genericTerms.has(term.toLowerCase())
      ) {
        terms.push(term);
      }
    }
  }

  return uniqueStrings(terms, 8);
}

function detectBlockerInvariantConflicts(input: {
  prompt: string;
  executionDraft: string;
  invariants: TaskInvariant[];
}) {
  return input.invariants
    .filter((invariant) => invariant.enabled && invariant.severity === "blocker")
    .flatMap((invariant) =>
      extractForbiddenTerms(invariant)
        .filter(
          (term) =>
            lexicalContains(input.prompt, term) ||
            lexicalContains(input.executionDraft, term),
        )
        .map((term) => ({
          invariant,
          term,
          source: lexicalContains(input.executionDraft, term) ? "draft" : "prompt",
        })),
    );
}

function buildStageMessages(input: {
  prompt: string;
  stage: TaskState;
  agentId: string;
  role: string;
  focus: string;
  schema: string;
  activeProfile: UserProfile;
  taskRun: TaskRun;
  invariants: TaskInvariant[];
  selectedBranch: MemoryBranch;
  selectedBranchSummary: string;
  recentMessages: ChatMessage[];
  workingMemory: MemoryLayerNote[];
  longTermMemory: MemoryLayerNote[];
  executionDraft?: string;
  validationResult?: ValidationResult;
  extraContext?: string;
}) {
  return [
    {
      role: "system" as const,
      content: [
        `You are ${input.role}, an internal stage agent in the unified AI Advent Challenge assistant.`,
        `Agent id: ${input.agentId}. Stage: ${input.stage}.`,
        input.focus,
        "You receive only orchestrator-selected context, not the full raw chat history.",
        "You only know your own lifecycle stage, neighboring allowed transitions, and the artifacts explicitly provided to this stage.",
        "Do not inspect, infer, or claim outputs for non-neighbor stages.",
        "Respect every blocker invariant. If a request conflicts with an invariant, do not work around it.",
        "Return only valid JSON. Do not wrap JSON in markdown.",
        "",
        "JSON schema:",
        input.schema,
      ].join("\n"),
    },
    {
      role: "system" as const,
      content: [
        [
          "Active user profile:",
          `Name: ${input.activeProfile.name}`,
          `Role/context: ${input.activeProfile.roleContext || "- empty"}`,
          `Style: ${input.activeProfile.style || "- empty"}`,
          `Format: ${input.activeProfile.format || "- empty"}`,
          `Constraints: ${input.activeProfile.constraints || "- empty"}`,
        ].join("\n"),
        input.stage === "planning"
          ? `Selected branch: ${input.selectedBranch.title}`
          : "Selected branch: hidden from this stage",
        input.stage === "planning"
          ? `Selected branch summary:\n${input.selectedBranchSummary || "- empty"}`
          : "Selected branch summary: hidden from this stage",
        input.stage === "planning"
          ? formatNotes("Working memory", input.workingMemory)
          : "Working memory: hidden from this stage",
        input.stage === "planning"
          ? formatNotes("Long-term memory", input.longTermMemory)
          : "Long-term memory: hidden from this stage",
        buildStageLocalContext({
          stage: input.stage,
          taskRun: input.taskRun,
          executionDraft: input.executionDraft,
          validationResult: input.validationResult,
        }),
        formatInvariantsForPrompt(input.invariants),
        input.extraContext || "",
      ].join("\n\n"),
    },
    ...(input.stage === "planning" ? input.recentMessages.slice(-4) : []),
    {
      role: "user" as const,
      content: input.prompt,
    },
  ];
}

async function runPlanningSwarm(input: {
  prompt: string;
  model?: string;
  activeProfile: UserProfile;
  taskRun: TaskRun;
  invariants: TaskInvariant[];
  selectedBranch: MemoryBranch;
  selectedBranchSummary: string;
  recentMessages: ChatMessage[];
  workingMemory: MemoryLayerNote[];
  longTermMemory: MemoryLayerNote[];
}) {
  const agents = [
    {
      agentId: "planning-requirements",
      role: "Requirements Planning Agent",
      focus:
        "Extract the user goal, missing requirements, and a practical plan. Do not let implementation tasks leave Planning until target platform/location, core requirements/constraints, and definition of done are known.",
    },
    {
      agentId: "planning-constraints",
      role: "Invariant Planning Agent",
      focus: "Find constraints, risks, and task-specific invariants that must shape the plan.",
    },
    {
      agentId: "planning-context",
      role: "Context Planning Agent",
      focus: "Check whether selected memory and branch context are sufficient for the task.",
    },
  ];
  const schema =
    '{"requirementsContract":{"goal":"clear outcome","targetLocation":"where to deliver or implement, or null","requirements":["concrete requirement"],"constraints":["constraint"],"assumptions":["safe assumption"],"acceptanceCriteria":["completion criterion"],"openQuestions":["question for user"],"readyForApproval":false},"plan":["ordered step"],"findings":["short finding"],"taskInvariants":[{"title":"short title","description":"rule to enforce","severity":"blocker|warning"}],"needsUserInput":false,"question":null,"confidence":0.0}';

  const outputs = await Promise.all(
    agents.map(async (agent) => {
      const messages = buildStageMessages({
        prompt: input.prompt,
        stage: "planning",
        agentId: agent.agentId,
        role: agent.role,
        focus: agent.focus,
        schema,
        activeProfile: input.activeProfile,
        taskRun: input.taskRun,
        invariants: input.invariants,
        selectedBranch: input.selectedBranch,
        selectedBranchSummary: input.selectedBranchSummary,
        recentMessages: input.recentMessages,
        workingMemory: input.workingMemory,
        longTermMemory: input.longTermMemory,
        extraContext: [
          "Planning contract rules:",
          "- Fill requirementsContract as the main Planning artifact.",
          "- Do not invent high-impact unknowns. Put them in openQuestions.",
          "- readyForApproval can be true only when goal, target/location, concrete requirements, acceptance criteria, and openQuestions are complete.",
          "- The orchestrator will not enter Execution until this contract is complete and the user explicitly approves the plan.",
        ].join("\n"),
      });
      const result = await callLlm({
        messages,
        model: input.model,
        temperature: 0.1,
      });
      const parsed = parsePlanningAgentResult(result.answer);
      return {
        parsed,
        payload: makeStagePayload({
          stage: "planning",
          agentId: agent.agentId,
          role: agent.role,
          messages,
        }),
        run: makeAgentRun({
          agentId: agent.agentId,
          stage: "planning",
          role: agent.role,
          inputSummary: `${input.taskRun.context.task} | ${agent.focus}`,
          output: result.answer,
          findings: parsed.findings,
          confidence: parsed.confidence,
        }),
      };
    }),
  );
  const plan = uniqueStrings(
    outputs.flatMap((output) => output.parsed.plan),
    6,
  );
  const findings = uniqueStrings(
    outputs.flatMap((output) => output.parsed.findings),
    10,
  );
  const taskInvariants = uniqueStrings(
    outputs
      .flatMap((output) => output.parsed.taskInvariants)
      .map((invariant) => `${invariant.title}|${invariant.description}|${invariant.severity}`),
    6,
  ).map((value) => {
    const [title, description, severity] = value.split("|");
    return buildTaskInvariant({
      title,
      description,
      severity: severity === "warning" ? "warning" : "blocker",
    });
  });
  const requirementsContract = mergeRequirementsContracts(
    outputs.map((output) => output.parsed.requirementsContract),
  );
  const agentQuestion =
    outputs.find((output) => output.parsed.question)?.parsed.question ?? null;
  const contractQuestion = requirementsContract.openQuestions.length
    ? [
        "I need to stay in Planning before Execution because the requirements contract is incomplete.",
        "",
        "Open questions:",
        ...requirementsContract.openQuestions.map((question, index) => `${index + 1}. ${question}`),
      ].join("\n")
    : null;
  const needsUserInput =
    !requirementsContract.readyForApproval ||
    outputs.some((output) => output.parsed.needsUserInput);
  const question = contractQuestion ?? agentQuestion;
  const planningFindings = uniqueStrings(
    [
      ...findings,
      ...requirementsContract.openQuestions.map(
        (question) => `Open requirement question: ${question}`,
      ),
    ],
    12,
  );
  const aggregatedDecision = [
    `Plan: ${plan.length ? plan.join(" -> ") : "fallback plan required"}`,
    formatRequirementsContract(requirementsContract),
    `Findings: ${planningFindings.length ? planningFindings.join("; ") : "no special findings"}`,
    needsUserInput ? `Needs user input: ${question || "yes"}` : "Ready for execution.",
  ].join("\n");
  const swarmRun: SwarmRun = {
    id: makeMemoryLayerId("swarm-run"),
    stage: "planning",
    agentIds: agents.map((agent) => agent.agentId),
    outputs: outputs.map((output) => output.run),
    aggregatedDecision,
    createdAt: new Date().toISOString(),
  };

  return {
    plan: plan.length
      ? plan
      : [
          "Clarify the task goal and constraints.",
          "Prepare a focused answer or artifact.",
          "Validate the result against active invariants.",
          "Finalize only after validation passes.",
    ],
    requirementsContract,
    taskInvariants,
    needsUserInput,
    question,
    swarmRun,
    agentRuns: outputs.map((output) => output.run),
    stagePayloads: outputs.map((output) => output.payload),
  };
}

async function runExecutionAgent(input: {
  prompt: string;
  model?: string;
  activeProfile: UserProfile;
  taskRun: TaskRun;
  invariants: TaskInvariant[];
  selectedBranch: MemoryBranch;
  selectedBranchSummary: string;
  recentMessages: ChatMessage[];
  workingMemory: MemoryLayerNote[];
  longTermMemory: MemoryLayerNote[];
}) {
  const messages = buildStageMessages({
    prompt: input.prompt,
    stage: "execution",
    agentId: "execution-agent",
    role: "Execution Agent",
    focus:
      "Execute the current plan step without skipping validation. Produce a user-ready draft, but do not mark the task done.",
    schema:
      '{"answerDraft":"draft response or artifact","completed":["completed work item"],"current":"current next action","needsUserInput":false,"question":null,"confidence":0.0}',
    activeProfile: input.activeProfile,
    taskRun: input.taskRun,
    invariants: input.invariants,
    selectedBranch: input.selectedBranch,
    selectedBranchSummary: input.selectedBranchSummary,
    recentMessages: input.recentMessages,
    workingMemory: input.workingMemory,
    longTermMemory: input.longTermMemory,
  });
  const result = await callLlm({
    messages,
    model: input.model,
    temperature: 0.2,
  });
  const parsed = parseExecutionAgentResult(result.answer);
  const run = makeAgentRun({
    agentId: "execution-agent",
    stage: "execution",
    role: "Execution Agent",
    inputSummary: input.taskRun.context.plan.join(" | "),
    output: result.answer,
    findings: parsed.completed,
    confidence: parsed.confidence,
  });

  return {
    parsed,
    run,
    payload: makeStagePayload({
      stage: "execution",
      agentId: "execution-agent",
      role: "Execution Agent",
      messages,
    }),
  };
}

async function runValidationAgent(input: {
  prompt: string;
  model?: string;
  activeProfile: UserProfile;
  taskRun: TaskRun;
  invariants: TaskInvariant[];
  selectedBranch: MemoryBranch;
  selectedBranchSummary: string;
  recentMessages: ChatMessage[];
  workingMemory: MemoryLayerNote[];
  longTermMemory: MemoryLayerNote[];
  executionDraft: string;
}) {
  const messages = buildStageMessages({
    prompt: input.prompt,
    stage: "validation",
    agentId: "validation-agent",
    role: "Validation Agent",
    focus:
      "Validate the execution draft against the plan, stage contracts, and every active invariant. Fail if any applicable blocker invariant is violated. Do not fail because the original user request is non-English; user messages may be in any language.",
    schema:
      '{"passed":false,"reason":"validation reason","failedInvariants":["invariant title"],"retryInstruction":null,"confidence":0.0}',
    activeProfile: input.activeProfile,
    taskRun: input.taskRun,
    invariants: input.invariants,
    selectedBranch: input.selectedBranch,
    selectedBranchSummary: input.selectedBranchSummary,
    recentMessages: input.recentMessages,
    workingMemory: input.workingMemory,
    longTermMemory: input.longTermMemory,
    executionDraft: input.executionDraft,
  });
  const deterministicConflicts = detectBlockerInvariantConflicts({
    prompt: input.prompt,
    executionDraft: input.executionDraft,
    invariants: input.invariants,
  });
  const deterministicFailedInvariants = uniqueStrings(
    deterministicConflicts.map((conflict) => conflict.invariant.title),
  );
  const deterministicReason = deterministicConflicts.length
    ? [
        "Deterministic blocker gate failed before LLM validation.",
        ...deterministicConflicts.map(
          (conflict) =>
            `${conflict.invariant.title}: ${conflict.source} contains forbidden term "${conflict.term}".`,
        ),
      ].join(" ")
    : "";

  if (deterministicConflicts.length > 0) {
    const retryInstruction =
      "Revise the draft or task request so it does not contain content forbidden by enabled blocker invariants.";
    const run = makeAgentRun({
      agentId: "validation-agent",
      stage: "validation",
      role: "Validation Agent",
      inputSummary: input.executionDraft.slice(0, 240),
      output: deterministicReason,
      findings: [deterministicReason, ...deterministicFailedInvariants],
      confidence: 1,
    });
    const validationResult: ValidationResult = {
      passed: false,
      reason: deterministicReason,
      failedInvariants: deterministicFailedInvariants,
      retryInstruction,
      reviewerCount: 1,
      createdAt: new Date().toISOString(),
    };

    return {
      parsed: {
        passed: false,
        reason: deterministicReason,
        failedInvariants: deterministicFailedInvariants,
        retryInstruction,
        confidence: 1,
      },
      run,
      validationResult,
      payload: makeStagePayload({
        stage: "validation",
        agentId: "validation-agent",
        role: "Validation Agent",
        messages,
      }),
    };
  }

  const result = await callLlm({
    messages,
    model: input.model,
    temperature: 0,
  });
  const parsed = parseValidationAgentResult(result.answer);
  const run = makeAgentRun({
    agentId: "validation-agent",
    stage: "validation",
    role: "Validation Agent",
    inputSummary: input.executionDraft.slice(0, 240),
    output: result.answer,
    findings: [parsed.reason, ...parsed.failedInvariants],
    confidence: parsed.confidence,
  });
  const validationResult: ValidationResult = {
    passed: parsed.passed,
    reason: parsed.reason,
    failedInvariants: parsed.failedInvariants,
    retryInstruction: parsed.retryInstruction,
    reviewerCount: 1,
    createdAt: new Date().toISOString(),
  };

  return {
    parsed: {
      ...parsed,
      passed: validationResult.passed,
      reason: validationResult.reason,
      failedInvariants: validationResult.failedInvariants,
      retryInstruction: validationResult.retryInstruction,
    },
    run,
    validationResult,
    payload: makeStagePayload({
      stage: "validation",
      agentId: "validation-agent",
      role: "Validation Agent",
      messages,
    }),
  };
}

async function runDoneAgent(input: {
  prompt: string;
  model?: string;
  activeProfile: UserProfile;
  taskRun: TaskRun;
  invariants: TaskInvariant[];
  selectedBranch: MemoryBranch;
  selectedBranchSummary: string;
  recentMessages: ChatMessage[];
  workingMemory: MemoryLayerNote[];
  longTermMemory: MemoryLayerNote[];
  executionDraft: string;
  validationResult: ValidationResult;
  needsSummary: boolean;
  currentProfileSuggestionCount: number;
}) {
  const messages = [
    {
      role: "system" as const,
      content: [
        "You are the Done Agent, the final lifecycle stage of the unified AI Advent Challenge assistant.",
        "Finalize only because validation passed.",
        "Use the execution draft as the answer source. Do not invent extra claims.",
        "You do not change lifecycle state; the orchestrator already approved the validation -> done transition.",
        "You only know the passed validation result, final draft, and active profile formatting preferences.",
        "Return the existing assistant JSON schema with answer, branch, memoryUpdates, and confirmationQuestion.",
        "",
        "JSON schema:",
        '{"answer":"assistant reply","branch":{"action":"keep|rename|create","title":null,"summary":null,"reason":null},"memoryUpdates":[{"layer":"working|longTerm","text":"fact to save","confidence":0.0,"reason":"short reason"}],"confirmationQuestion":null}',
      ].join("\n\n"),
    },
    {
      role: "system" as const,
      content: [
        [
          "Active user profile:",
          `Name: ${input.activeProfile.name}`,
          `Role/context: ${input.activeProfile.roleContext || "- empty"}`,
          `Style: ${input.activeProfile.style || "- empty"}`,
          `Format: ${input.activeProfile.format || "- empty"}`,
          `Constraints: ${input.activeProfile.constraints || "- empty"}`,
        ].join("\n"),
        buildStageLocalContext({
          stage: "done",
          taskRun: input.taskRun,
          executionDraft: input.executionDraft,
          validationResult: input.validationResult,
        }),
        `Pending profile suggestions already captured: ${input.currentProfileSuggestionCount}`,
        input.needsSummary
          ? "Branch summary may be updated if the final answer introduces durable topic context."
          : "Keep branch summary unchanged unless the final answer clearly improves it.",
      ].join("\n\n"),
    },
    {
      role: "user" as const,
      content: input.prompt,
    },
  ];
  const result = await callLlm({
    messages,
    model: input.model,
    temperature: 0.1,
  });
  const structured = parseAssistantResult(result.answer);
  const run = makeAgentRun({
    agentId: "done-agent",
    stage: "done",
    role: "Done Agent",
    inputSummary: input.validationResult.reason,
    output: result.answer,
    findings: [structured.answer.slice(0, 220)],
    confidence: 0.9,
  });

  return {
    structured,
    run,
    payload: makeStagePayload({
      stage: "done",
      agentId: "done-agent",
      role: "Done Agent",
      messages,
    }),
  };
}

function updateTaskContext(input: {
  taskRun: TaskRun;
  state: TaskState;
  plan?: string[];
  done?: string[];
  current: string;
  pausedReason?: string | null;
  awaitingPlanApproval?: boolean;
  requirementsContract?: RequirementsContract;
}) {
  const now = new Date().toISOString();
  return {
    ...input.taskRun.context,
    state: input.state,
    step: TASK_STAGE_ORDER[input.state],
    total: TASK_LIFECYCLE_STATES.length,
    plan: input.plan ?? input.taskRun.context.plan,
    done: uniqueStrings(input.done ?? input.taskRun.context.done, 12),
    current: input.current,
    pausedReason: input.pausedReason ?? null,
    awaitingPlanApproval:
      input.awaitingPlanApproval ?? input.taskRun.context.awaitingPlanApproval,
    requirementsContract:
      input.requirementsContract ?? input.taskRun.context.requirementsContract,
    updatedAt: now,
  };
}

function buildPausedStructuredAnswer(message: string): AssistantStructuredResult {
  return {
    answer: message,
    branch: {
      action: "keep",
      title: null,
      summary: null,
      reason: "Task lifecycle paused before completion.",
    },
    memoryUpdates: [],
    confirmationQuestion: null,
  };
}

function taskEvents(input: {
  taskRun: TaskRun;
  transitions: TransitionDecision[];
  agentRuns: AgentRun[];
  swarmRuns: SwarmRun[];
  validationResult: ValidationResult | null;
  filePath: string;
}) {
  const events: MemoryLayerEvent[] = [
    {
      layer: "shortTerm",
      action: "task_state",
      detail: [
        `Task: ${input.taskRun.context.task}`,
        `State: ${input.taskRun.context.state}`,
        `Step: ${input.taskRun.context.step}/${input.taskRun.context.total}`,
        `Current: ${input.taskRun.context.current || "- empty"}`,
      ].join("\n"),
      filePath: input.filePath,
    },
    ...input.agentRuns.slice(-8).map((run) => ({
      layer: "shortTerm" as const,
      action: "agent_run" as const,
      detail: [
        `${run.role} (${run.agentId})`,
        `Stage: ${run.stage}`,
        `Findings: ${run.findings.length ? run.findings.join("; ") : "- empty"}`,
      ].join("\n"),
      filePath: input.filePath,
    })),
    ...input.swarmRuns.slice(-2).map((run) => ({
      layer: "shortTerm" as const,
      action: "agent_run" as const,
      detail: [
        `Swarm stage: ${run.stage}`,
        `Agents: ${run.agentIds.join(", ")}`,
        run.aggregatedDecision,
      ].join("\n"),
      filePath: input.filePath,
    })),
    ...input.transitions.map((transition) => ({
      layer: "shortTerm" as const,
      action: "transition" as const,
      detail: `${transition.from} -> ${transition.to}: ${
        transition.allowed ? "allowed" : "blocked"
      }\n${transition.reason}`,
      filePath: input.filePath,
    })),
  ];

  if (input.validationResult) {
    events.push({
      layer: "shortTerm",
      action: "invariant_check",
      detail: [
        input.validationResult.passed ? "Validation passed." : "Validation failed.",
        input.validationResult.reason,
        input.validationResult.failedInvariants.length
          ? `Failed invariants: ${input.validationResult.failedInvariants.join(", ")}`
          : "Failed invariants: none",
      ].join("\n"),
      filePath: input.filePath,
    });
  }

  return events;
}

async function runTaskOrchestration(input: {
  prompt: string;
  model?: string;
  initialTaskRun: TaskRun;
  activeProfile: UserProfile;
  selectedBranch: MemoryBranch;
  selectedBranchSummary: string;
  recentMessages: ChatMessage[];
  workingMemory: MemoryLayerNote[];
  longTermMemory: MemoryLayerNote[];
  globalInvariants: TaskInvariant[];
  needsSummary: boolean;
  currentProfileSuggestionCount: number;
  shortTermFilePath: string;
}): Promise<TaskOrchestrationResult> {
  let taskRun = input.initialTaskRun;
  const events: MemoryLayerEvent[] = [];
  const agentRuns: AgentRun[] = [];
  const swarmRuns: SwarmRun[] = [];
  const stagePayloads: StagePayload[] = [];
  const transitions: TransitionDecision[] = [];
  const artifacts: StageArtifact[] = [];
  const newInvariants: TaskInvariant[] = [];
  let availableInvariants = input.globalInvariants;
  let validationResult: ValidationResult | null = null;
  const planApprovalGranted =
    taskRun.context.state === "planning" &&
    taskRun.context.awaitingPlanApproval &&
    taskRun.context.plan.length > 0 &&
    taskRun.context.requirementsContract.readyForApproval &&
    isExplicitPlanApproval(input.prompt);
  const shouldPlan =
    (taskRun.context.state === "planning" && !planApprovalGranted) ||
    taskRun.context.plan.length === 0;

  if (shouldPlan) {
    const planningInvariants = activeInvariantsForStage(
      availableInvariants,
      taskInvariantsForRun(availableInvariants, taskRun),
      "planning",
      input.prompt,
    );
    const planning = await runPlanningSwarm({
      prompt: input.prompt,
      model: input.model,
      activeProfile: input.activeProfile,
      taskRun,
      invariants: planningInvariants,
      selectedBranch: input.selectedBranch,
      selectedBranchSummary: input.selectedBranchSummary,
      recentMessages: input.recentMessages,
      workingMemory: input.workingMemory,
      longTermMemory: input.longTermMemory,
    });
    agentRuns.push(...planning.agentRuns);
    stagePayloads.push(...planning.stagePayloads);
    swarmRuns.push(planning.swarmRun);
    artifacts.push(
      makeStageArtifact(
        "planning",
        "Planning swarm decision",
        planning.swarmRun.aggregatedDecision,
      ),
    );
    newInvariants.push(...planning.taskInvariants);
    availableInvariants = [...availableInvariants, ...planning.taskInvariants];
    const taskInvariantRefs = uniqueStrings([
      ...taskRun.invariantRefs,
      ...planning.taskInvariants.map((invariant) => invariant.id),
    ]);

    if (planning.needsUserInput) {
      const pauseTransition = makeTransitionDecision(
        "planning",
        "planning",
        planning.question || "Planning paused for user input.",
      );
      transitions.push(pauseTransition);
      taskRun = {
        ...taskRun,
        invariantRefs: taskInvariantRefs,
        artifacts: [...taskRun.artifacts, ...artifacts],
        agentRuns: [...taskRun.agentRuns, ...agentRuns],
        swarmRuns: [...taskRun.swarmRuns, ...swarmRuns],
        transitions: [...taskRun.transitions, pauseTransition],
        context: updateTaskContext({
          taskRun,
          state: "planning",
          plan: planning.plan,
          done: taskRun.context.done,
          current: planning.question || "Planning needs user input.",
          pausedReason: planning.question,
          awaitingPlanApproval: false,
          requirementsContract: planning.requirementsContract,
        }),
        updatedAt: new Date().toISOString(),
      };
      events.push(...taskEvents({
        taskRun,
        transitions,
        agentRuns,
        swarmRuns,
        validationResult,
        filePath: input.shortTermFilePath,
      }));
      return {
        structured: buildPausedStructuredAnswer(
          planning.question || "I need one more detail before I can plan this safely.",
        ),
        taskRun,
        newInvariants,
        events,
        agentRuns,
        swarmRuns,
        stagePayloads,
        transitions,
        validationResult,
      };
    }

    const blockedExecutionTransition = makeTransitionDecision(
      "planning",
      "execution",
      "Planning produced a plan, but explicit user approval is required before Execution.",
      false,
    );
    transitions.push(blockedExecutionTransition);
    const approvalQuestion = buildPlanApprovalQuestion(
      planning.plan,
      planning.requirementsContract,
    );
    taskRun = {
      ...taskRun,
      invariantRefs: taskInvariantRefs,
      artifacts: [...taskRun.artifacts, ...artifacts],
      agentRuns: [...taskRun.agentRuns, ...agentRuns],
      swarmRuns: [...taskRun.swarmRuns, ...swarmRuns],
      transitions: [...taskRun.transitions, blockedExecutionTransition],
      context: updateTaskContext({
        taskRun,
        state: "planning",
        plan: planning.plan,
        done: [...taskRun.context.done, "Planning completed by swarm"],
        current: approvalQuestion,
        pausedReason: "Waiting for explicit plan approval.",
        awaitingPlanApproval: true,
        requirementsContract: planning.requirementsContract,
      }),
      updatedAt: new Date().toISOString(),
    };
    events.push(...taskEvents({
      taskRun,
      transitions,
      agentRuns,
      swarmRuns,
      validationResult,
      filePath: input.shortTermFilePath,
    }));
    return {
      structured: buildPausedStructuredAnswer(approvalQuestion),
      taskRun,
      newInvariants,
      events,
      agentRuns,
      swarmRuns,
      stagePayloads,
      transitions,
      validationResult,
    };
  } else if (planApprovalGranted) {
    const planningTransition = makeTransitionDecision(
      "planning",
      "execution",
      "User explicitly approved the plan; execution is allowed.",
    );
    transitions.push(planningTransition);
    taskRun = {
      ...taskRun,
      transitions: [...taskRun.transitions, planningTransition],
      context: updateTaskContext({
        taskRun,
        state: "execution",
        done: [...taskRun.context.done, "Plan explicitly approved by user"],
        current: taskRun.context.plan[0] || "Execute the approved plan.",
        pausedReason: null,
        awaitingPlanApproval: false,
      }),
      updatedAt: new Date().toISOString(),
    };
  } else if (taskRun.context.state === "validation") {
    const retryTransition = makeTransitionDecision(
      "validation",
      "execution",
      "Existing task was in validation; continuing with a new execution attempt.",
    );
    transitions.push(retryTransition);
    taskRun = {
      ...taskRun,
      transitions: [...taskRun.transitions, retryTransition],
      context: updateTaskContext({
        taskRun,
        state: "execution",
        current: "Continue execution before the next validation attempt.",
        awaitingPlanApproval: false,
      }),
      updatedAt: new Date().toISOString(),
    };
  }

  const executionInvariants = activeInvariantsForStage(
    availableInvariants,
    taskInvariantsForRun(availableInvariants, taskRun),
    "execution",
    input.prompt,
  );
  const execution = await runExecutionAgent({
    prompt: input.prompt,
    model: input.model,
    activeProfile: input.activeProfile,
    taskRun,
    invariants: executionInvariants,
    selectedBranch: input.selectedBranch,
    selectedBranchSummary: input.selectedBranchSummary,
    recentMessages: input.recentMessages,
    workingMemory: input.workingMemory,
    longTermMemory: input.longTermMemory,
  });
  agentRuns.push(execution.run);
  stagePayloads.push(execution.payload);
  artifacts.push(
    makeStageArtifact("execution", "Execution draft", execution.parsed.answerDraft),
  );

  if (execution.parsed.needsUserInput) {
    const pauseTransition = makeTransitionDecision(
      "execution",
      "planning",
      execution.parsed.question ||
        "Execution paused and returned to planning for user input.",
    );
    transitions.push(pauseTransition);
    taskRun = {
      ...taskRun,
      artifacts: [...taskRun.artifacts, artifacts[artifacts.length - 1]],
      agentRuns: [...taskRun.agentRuns, execution.run],
      transitions: [...taskRun.transitions, pauseTransition],
      context: updateTaskContext({
        taskRun,
        state: "planning",
        done: [...taskRun.context.done, ...execution.parsed.completed],
        current: execution.parsed.question || execution.parsed.current,
        pausedReason: execution.parsed.question,
        awaitingPlanApproval: false,
      }),
      updatedAt: new Date().toISOString(),
    };
    events.push(...taskEvents({
      taskRun,
      transitions,
      agentRuns,
      swarmRuns,
      validationResult,
      filePath: input.shortTermFilePath,
    }));
    return {
      structured: buildPausedStructuredAnswer(
        execution.parsed.question || "I need one more detail before execution can continue.",
      ),
      taskRun,
      newInvariants,
      events,
      agentRuns,
      swarmRuns,
      stagePayloads,
      transitions,
      validationResult,
    };
  }

  const executionTransition = makeTransitionDecision(
    "execution",
    "validation",
    "Execution agent produced a draft artifact.",
  );
  transitions.push(executionTransition);
  taskRun = {
    ...taskRun,
    artifacts: [...taskRun.artifacts, artifacts[artifacts.length - 1]],
    agentRuns: [...taskRun.agentRuns, execution.run],
    transitions: [...taskRun.transitions, executionTransition],
    context: updateTaskContext({
      taskRun,
      state: "validation",
      done: [...taskRun.context.done, ...execution.parsed.completed, "Execution draft completed"],
      current: "Validate execution draft against invariants.",
      awaitingPlanApproval: false,
    }),
    updatedAt: new Date().toISOString(),
  };

  const validationInvariants = activeInvariantsForStage(
    availableInvariants,
    taskInvariantsForRun(availableInvariants, taskRun),
    "validation",
    input.prompt,
  );
  const validation = await runValidationAgent({
    prompt: input.prompt,
    model: input.model,
    activeProfile: input.activeProfile,
    taskRun,
    invariants: validationInvariants,
    selectedBranch: input.selectedBranch,
    selectedBranchSummary: input.selectedBranchSummary,
    recentMessages: input.recentMessages,
    workingMemory: input.workingMemory,
    longTermMemory: input.longTermMemory,
    executionDraft: execution.parsed.answerDraft,
  });
  agentRuns.push(validation.run);
  stagePayloads.push(validation.payload);
  validationResult = validation.validationResult;
  artifacts.push(
    makeStageArtifact("validation", "Validation result", validation.validationResult.reason),
  );

  if (!validation.parsed.passed) {
    const blockedDoneTransition = makeTransitionDecision(
      "validation",
      "done",
      validation.validationResult.reason,
      false,
    );
    const failedTransition = makeTransitionDecision(
      "validation",
      "execution",
      validation.parsed.retryInstruction ||
        "Validation failed and returned the task to execution.",
      true,
    );
    transitions.push(blockedDoneTransition);
    transitions.push(failedTransition);
    taskRun = {
      ...taskRun,
      artifacts: [...taskRun.artifacts, artifacts[artifacts.length - 1]],
      agentRuns: [...taskRun.agentRuns, validation.run],
      transitions: [...taskRun.transitions, blockedDoneTransition, failedTransition],
      validationResult,
      context: updateTaskContext({
        taskRun,
        state: "execution",
        current:
          validation.parsed.retryInstruction ||
          "Revise the execution draft to satisfy validation.",
        pausedReason: validation.parsed.reason,
        awaitingPlanApproval: false,
      }),
      updatedAt: new Date().toISOString(),
    };
    events.push(...taskEvents({
      taskRun,
      transitions,
      agentRuns,
      swarmRuns,
      validationResult,
      filePath: input.shortTermFilePath,
    }));
    return {
      structured: buildPausedStructuredAnswer(
        [
          "I cannot mark this task done yet because validation failed.",
          validation.parsed.reason,
          validation.parsed.retryInstruction
            ? `Next: ${validation.parsed.retryInstruction}`
            : "I will keep the task in Execution until the issue is fixed.",
        ].join("\n\n"),
      ),
      taskRun,
      newInvariants,
      events,
      agentRuns,
      swarmRuns,
      stagePayloads,
      transitions,
      validationResult,
    };
  }

  const validationTransition = makeTransitionDecision(
    "validation",
    "done",
    "Validation passed; finalization is allowed.",
  );
  transitions.push(validationTransition);
  taskRun = {
    ...taskRun,
    artifacts: [...taskRun.artifacts, artifacts[artifacts.length - 1]],
    agentRuns: [...taskRun.agentRuns, validation.run],
    transitions: [...taskRun.transitions, validationTransition],
    validationResult,
    context: updateTaskContext({
      taskRun,
      state: "done",
      done: [...taskRun.context.done, "Validation passed"],
      current: "Finalize response.",
      awaitingPlanApproval: false,
    }),
    updatedAt: new Date().toISOString(),
  };

  const doneInvariants = activeInvariantsForStage(
    availableInvariants,
    taskInvariantsForRun(availableInvariants, taskRun),
    "done",
    input.prompt,
  );
  const done = await runDoneAgent({
    prompt: input.prompt,
    model: input.model,
    activeProfile: input.activeProfile,
    taskRun,
    invariants: doneInvariants,
    selectedBranch: input.selectedBranch,
    selectedBranchSummary: input.selectedBranchSummary,
    recentMessages: input.recentMessages,
    workingMemory: input.workingMemory,
    longTermMemory: input.longTermMemory,
    executionDraft: execution.parsed.answerDraft,
    validationResult,
    needsSummary: input.needsSummary,
    currentProfileSuggestionCount: input.currentProfileSuggestionCount,
  });
  agentRuns.push(done.run);
  stagePayloads.push(done.payload);
  artifacts.push(makeStageArtifact("done", "Final answer", done.structured.answer));
  taskRun = {
    ...taskRun,
    artifacts: [...taskRun.artifacts, artifacts[artifacts.length - 1]],
    agentRuns: [...taskRun.agentRuns, done.run],
    context: updateTaskContext({
      taskRun,
      state: "done",
      done: [...taskRun.context.done, "Done agent finalized the response"],
      current: "Task complete.",
      awaitingPlanApproval: false,
    }),
    updatedAt: new Date().toISOString(),
  };
  events.push(...taskEvents({
    taskRun,
    transitions,
    agentRuns,
    swarmRuns,
    validationResult,
    filePath: input.shortTermFilePath,
  }));

  return {
    structured: done.structured,
    taskRun,
    newInvariants,
    events,
    agentRuns,
    swarmRuns,
    stagePayloads,
    transitions,
    validationResult,
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
  taskRun?: TaskRun | null;
  invariants?: TaskInvariant[];
}) {
  return [
    {
      role: "system" as const,
      content: [
        "You are the unified AI Advent Challenge assistant.",
        "Use Day 9 compression, Day 10 topic branching, and Day 11 memory layers as one product.",
        "Use Day 13-15 lifecycle-only orchestration for every user turn: respect state, stage artifacts, transitions, and invariants.",
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
        formatTaskContextForPrompt(input.taskRun ?? null),
        formatInvariantsForPrompt(input.invariants ?? []),
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
  taskRun: TaskRun | null;
  invariantRefs: string[];
  stageAgentInputs?: AgentRun[];
  stagePayloads?: StagePayload[];
  swarmRuns?: SwarmRun[];
  transitionDecisions?: TransitionDecision[];
  validationResult?: ValidationResult | null;
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
    taskContext: input.taskRun?.context ?? null,
    invariantRefs: input.invariantRefs,
    stageAgentInputs: input.stageAgentInputs ?? [],
    stagePayloads: input.stagePayloads ?? [],
    swarmRuns: input.swarmRuns ?? [],
    transitionDecisions: input.transitionDecisions ?? [],
    validationResult: input.validationResult ?? null,
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

    if (action === "create_invariant") {
      const nextState = createTaskInvariant(state, body.invariant ?? {});
      await writeMemoryLayersState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "update_invariant") {
      if (!body.invariant?.id) {
        return NextResponse.json(
          { error: "invariant.id is required." },
          { status: 400 },
        );
      }
      const nextState = updateTaskInvariant(
        state,
        body.invariant as Partial<TaskInvariant> & { id: string },
      );
      await writeMemoryLayersState(nextState);
      return NextResponse.json(nextState);
    }

    if (action === "delete_invariant") {
      if (!body.invariantId) {
        return NextResponse.json(
          { error: "invariantId is required." },
          { status: 400 },
        );
      }
      const nextState = deleteTaskInvariant(state, body.invariantId);
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
    const turnTaskRun =
      active.taskRun && active.taskRun.context.state !== "done"
        ? active.taskRun
        : createInitialTaskRun(prompt);
    let extractorError: string | null = null;
    let extractedProfileUpdates: AssistantProfileUpdate[] = [];
    try {
      extractedProfileUpdates = await extractProfileUpdates({
        prompt,
        activeProfile,
        taskRun: turnTaskRun,
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
    const lifecycleDebugMessages: ChatMessage[] = [
      {
        role: "system",
        content:
          "Lifecycle-only debug snapshot. User turns are not sent through this message list directly; provider calls happen inside stage payloads after TaskContext is created.",
      },
      ...buildMessages({
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
        taskRun: turnTaskRun,
        invariants: state.invariants,
      }),
    ];
    const startedAt = performance.now();
    const taskOrchestration = await runTaskOrchestration({
      prompt,
      model: body.model,
      initialTaskRun: turnTaskRun,
      activeProfile,
      selectedBranch: selected.branch,
      selectedBranchSummary,
      recentMessages,
      workingMemory: promptWorkingMemory.notes,
      longTermMemory: promptLongTermMemory.notes,
      globalInvariants: state.invariants,
      needsSummary,
      currentProfileSuggestionCount: pendingProfileUpdates.length,
      shortTermFilePath: state.filePaths.shortTerm,
    });
    const structured = taskOrchestration.structured;
    const result: LlmResult = {
      answer: "",
      model: body.model || "orchestrated",
      elapsedMs: Math.round(performance.now() - startedAt),
      usage: {
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        providerCost: null,
      },
    };
    result.answer = JSON.stringify(structured);
    const requestTaskRun = taskOrchestration.taskRun;
    const nextInvariantMap = new Map(
      state.invariants.map((invariant) => [invariant.id, invariant]),
    );
    for (const invariant of taskOrchestration.newInvariants) {
      nextInvariantMap.set(invariant.id, invariant);
    }
    const nextInvariants = Array.from(nextInvariantMap.values());
    const requestInvariantRefs = uniqueStrings(
      [
        ...state.invariants.map((invariant) => invariant.id),
        ...(requestTaskRun?.invariantRefs ?? []),
        ...taskOrchestration.newInvariants.map((invariant) => invariant.id),
      ],
      64,
    );
    const requestContext = buildRequestContextDebug({
      activeProfile,
      selectedBranch: selected.branch,
      selectedBranchSummary,
      recentMessages,
      workingMemory: promptWorkingMemory.notes,
      longTermMemory: promptLongTermMemory.notes,
      taskRun: requestTaskRun,
      invariantRefs: requestInvariantRefs,
      stageAgentInputs: taskOrchestration.agentRuns,
      stagePayloads: taskOrchestration.stagePayloads,
      swarmRuns: taskOrchestration.swarmRuns,
      transitionDecisions: taskOrchestration.transitions,
      validationResult: taskOrchestration.validationResult,
      assembledMessages: lifecycleDebugMessages,
    });
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
    const contextTokens = estimateMessageTokens(lifecycleDebugMessages).estimatedTokens;
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
          "Task orchestration: lifecycle-only mode captured stage agents, planning swarm, transition checks, and validation result.",
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
      ...taskOrchestration.events,
    ];
    const nextState = withUpdatedActiveMemoryDialog(
      addGlobalMetricRow({
        ...state,
        invariants: nextInvariants,
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
        taskRun: taskOrchestration.taskRun,
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
