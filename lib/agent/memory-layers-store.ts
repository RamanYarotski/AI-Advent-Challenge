import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChatMessage } from "@/lib/llm";
import type { TokenMetricRow } from "@/lib/tokens";

const DATA_DIR = path.join(process.cwd(), ".data", "day-11");
const MEMORY_INDEX_FILE = path.join(DATA_DIR, "memory-index.json");

export type MemoryLayerKey = "shortTerm" | "working" | "longTerm";

export type MemoryFileSettings = {
  memoryFolder: string;
  shortTermFileName: string;
  workingMemoryFileName: string;
  longTermMemoryFileName: string;
  userProfilesFileName: string;
  invariantsFileName: string;
};

export type MemoryFilePaths = {
  shortTerm: string;
  working: string;
  longTerm: string;
  userProfiles: string;
  invariants: string;
  index: string;
};

export type MemoryLayerNote = {
  id: string;
  text: string;
  source: string;
  createdAt: string;
};

export type MemoryLayerEvent = {
  layer: MemoryLayerKey;
  action:
    | "saved"
    | "skipped"
    | "needs_confirmation"
    | "selected_branch"
    | "created_branch"
    | "updated_summary"
    | "prompt_context"
    | "task_state"
    | "agent_run"
    | "transition"
    | "invariant_check";
  detail: string;
  filePath: string;
};

export type TaskState =
  | "planning"
  | "execution"
  | "validation"
  | "acceptance"
  | "done";

export type TaskDeliverableKind = "planning_artifact" | "implementation_result";

export type TaskInvariantScope = "global" | "task" | "stage";

export type TaskInvariantSeverity = "blocker" | "warning";

export type TaskInvariant = {
  id: string;
  title: string;
  description: string;
  dialogId: string | null;
  scope: TaskInvariantScope;
  appliesTo: TaskState[];
  severity: TaskInvariantSeverity;
  enabled: boolean;
  source: "built-in" | "user" | "task";
  createdAt: string;
  updatedAt: string;
};

export type RequirementsContract = {
  goal: string;
  targetLocation: string | null;
  requirements: string[];
  constraints: string[];
  assumptions: string[];
  acceptanceCriteria: string[];
  openQuestions: string[];
  readyForApproval: boolean;
  updatedAt: string;
};

export type TaskContext = {
  id: string;
  task: string;
  state: TaskState;
  deliverableKind: TaskDeliverableKind;
  step: number;
  total: number;
  plan: string[];
  done: string[];
  current: string;
  pausedReason: string | null;
  awaitingPlanApproval: boolean;
  requirementsContract: RequirementsContract;
  externalContext: string | null;
  startedAt: string;
  updatedAt: string;
};

export type StageArtifact = {
  id: string;
  stage: TaskState;
  title: string;
  content: string;
  summary: string;
  createdAt: string;
};

export type AgentRun = {
  id: string;
  agentId: string;
  stage: TaskState;
  role: string;
  inputSummary: string;
  output: string;
  findings: string[];
  confidence: number;
  createdAt: string;
};

export type SwarmRun = {
  id: string;
  stage: TaskState;
  agentIds: string[];
  outputs: AgentRun[];
  aggregatedDecision: string;
  createdAt: string;
};

export type TransitionDecision = {
  id: string;
  from: TaskState;
  to: TaskState;
  allowed: boolean;
  reason: string;
  createdAt: string;
};

export type ValidationResult = {
  passed: boolean;
  reason: string;
  failedInvariants: string[];
  retryInstruction: string | null;
  reviewerCount: number;
  createdAt: string;
};

export type TaskRun = {
  context: TaskContext;
  invariantRefs: string[];
  taskInvariants: TaskInvariant[];
  pendingTaskInvariants: TaskInvariant[];
  artifacts: StageArtifact[];
  agentRuns: AgentRun[];
  swarmRuns: SwarmRun[];
  transitions: TransitionDecision[];
  validationResult: ValidationResult | null;
  updatedAt: string;
};

export type MemoryBranch = {
  id: string;
  title: string;
  summary: string;
  profileSummaries?: Record<string, string>;
  messages: ChatMessage[];
  updatedAt: string;
};

export type MemoryDialog = {
  id: string;
  title: string;
  messages: ChatMessage[];
  metrics: TokenMetricRow[];
  activeBranchId: string;
  branches: MemoryBranch[];
  compactMetricsSummary: string;
  pendingConfirmation: string | null;
  taskRun: TaskRun | null;
};

export type UserProfile = {
  id: string;
  name: string;
  roleContext: string;
  style: string;
  format: string;
  constraints: string;
  updatedAt: string;
};

export type UserProfileField = "roleContext" | "style" | "format" | "constraints";

export type PendingProfileUpdate = {
  id: string;
  profileId: string;
  field: UserProfileField;
  value: string;
  reason: string;
  sourceText: string;
  confidence: number;
  createdAt: string;
};

export type MemoryMetricTotals = {
  turns: number;
  requestTokens: number;
  contextTokens: number;
  responseTokens: number;
  totalTokens: number;
  elapsedMs: number;
  providerCost: number;
  hasProviderCost: boolean;
};

export type MemoryLayersState = {
  activeDialogId: string;
  dialogs: MemoryDialog[];
  workingMemory: MemoryLayerNote[];
  longTermMemory: MemoryLayerNote[];
  activeProfileId: string;
  userProfiles: UserProfile[];
  invariants: TaskInvariant[];
  pendingProfileUpdates: PendingProfileUpdate[];
  globalMetrics: MemoryMetricTotals;
  fileSettings: MemoryFileSettings;
  filePaths: MemoryFilePaths;
};

type MemoryIndexFile = {
  activeDialogId?: string;
  fileSettings?: Partial<MemoryFileSettings>;
};

type ShortTermFile = {
  dialogs?: unknown[];
  invariants?: unknown[];
  globalMetrics?: unknown;
  pendingProfileUpdates?: unknown[];
};

type TaskInvariantsFile = {
  invariants?: unknown[];
};

type UserProfilesFile = {
  activeProfileId?: string;
  profiles?: unknown[];
};

function defaultMemoryFolder() {
  return path.join(os.homedir(), "Documents", "AI-Advent-Challenge", "memory");
}

const DEFAULT_FILE_SETTINGS: MemoryFileSettings = {
  memoryFolder: defaultMemoryFolder(),
  shortTermFileName: "short-term-dialogs.json",
  workingMemoryFileName: "working-memory.md",
  longTermMemoryFileName: "long-term-memory.md",
  userProfilesFileName: "user-profiles.json",
  invariantsFileName: "task-invariants.json",
};

const TASK_STATES: TaskState[] = [
  "planning",
  "execution",
  "validation",
  "acceptance",
  "done",
];

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function emptyMetricTotals(): MemoryMetricTotals {
  return {
    turns: 0,
    requestTokens: 0,
    contextTokens: 0,
    responseTokens: 0,
    totalTokens: 0,
    elapsedMs: 0,
    providerCost: 0,
    hasProviderCost: false,
  };
}

function visibleMessages(messages: ChatMessage[]) {
  return messages.filter((message) => message.role !== "system");
}

function makeBranch(index: number, messages: ChatMessage[] = []): MemoryBranch {
  return {
    id: makeId("memory-branch"),
    title: index === 1 ? "Main topic" : `Topic ${index}`,
    summary: "",
    profileSummaries: {},
    messages,
    updatedAt: nowIso(),
  };
}

function createDialog(index: number): MemoryDialog {
  const branch = makeBranch(1);
  return {
    id: makeId("memory-dialog"),
    title: `Dialog ${index}`,
    messages: [],
    metrics: [],
    activeBranchId: branch.id,
    branches: [branch],
    compactMetricsSummary: "No requests yet.",
    pendingConfirmation: null,
    taskRun: null,
  };
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ChatMessage>;
  return (
    (candidate.role === "system" ||
      candidate.role === "user" ||
      candidate.role === "assistant") &&
    typeof candidate.content === "string"
  );
}

function isMetricRow(value: unknown): value is TokenMetricRow {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<TokenMetricRow>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.turn === "number" &&
    candidate.status === "sent" &&
    typeof candidate.requestTokens === "number" &&
    typeof candidate.contextTokens === "number"
  );
}

function safeFileName(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const fileName = value.trim();
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || path.isAbsolute(fileName)) {
    return fallback;
  }
  return fileName;
}

function normalizeFileSettings(value: unknown): MemoryFileSettings {
  const parsed = value as Partial<MemoryFileSettings>;
  const memoryFolder =
    typeof parsed?.memoryFolder === "string" && parsed.memoryFolder.trim()
      ? parsed.memoryFolder.trim()
      : DEFAULT_FILE_SETTINGS.memoryFolder;

  return {
    memoryFolder,
    shortTermFileName: safeFileName(
      parsed?.shortTermFileName,
      DEFAULT_FILE_SETTINGS.shortTermFileName,
    ),
    workingMemoryFileName: safeFileName(
      parsed?.workingMemoryFileName,
      DEFAULT_FILE_SETTINGS.workingMemoryFileName,
    ),
    longTermMemoryFileName: safeFileName(
      parsed?.longTermMemoryFileName,
      DEFAULT_FILE_SETTINGS.longTermMemoryFileName,
    ),
    userProfilesFileName: safeFileName(
      parsed?.userProfilesFileName,
      DEFAULT_FILE_SETTINGS.userProfilesFileName,
    ),
    invariantsFileName: DEFAULT_FILE_SETTINGS.invariantsFileName,
  };
}

function resolveFilePaths(settings: MemoryFileSettings): MemoryFilePaths {
  return {
    shortTerm: path.join(settings.memoryFolder, settings.shortTermFileName),
    working: path.join(settings.memoryFolder, settings.workingMemoryFileName),
    longTerm: path.join(settings.memoryFolder, settings.longTermMemoryFileName),
    userProfiles: path.join(settings.memoryFolder, settings.userProfilesFileName),
    invariants: path.join(settings.memoryFolder, settings.invariantsFileName),
    index: MEMORY_INDEX_FILE,
  };
}

function makeProfile(input: Omit<UserProfile, "id" | "updatedAt">): UserProfile {
  return {
    id: makeId("user-profile"),
    ...input,
    updatedAt: nowIso(),
  };
}

function defaultUserProfiles(): UserProfile[] {
  return [
    makeProfile({
      name: "Senior engineer",
      roleContext:
        "Experienced software engineer working on production-grade AI and web applications.",
      style:
        "Concise, technical, direct. Prefer trade-offs, implementation details, and edge cases.",
      format:
        "Start with the recommendation, then short bullets, then code or concrete steps when useful.",
      constraints:
        "Avoid overengineering. Preserve existing architecture. Mention risks and verification steps.",
    }),
    makeProfile({
      name: "Beginner product owner",
      roleContext:
        "Product owner learning how AI assistants work and how product decisions affect implementation.",
      style:
        "Plain language, patient, practical. Avoid unexplained jargon.",
      format:
        "Start with the user impact, then explain the idea, then list next steps.",
      constraints:
        "Keep answers short, connect technical choices to product value, and call out decisions that need confirmation.",
    }),
  ];
}

function normalizeProfile(value: unknown, index: number): UserProfile | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<UserProfile>;
  if (typeof candidate.id !== "string") {
    return null;
  }

  return {
    id: candidate.id,
    name:
      typeof candidate.name === "string" && candidate.name.trim()
        ? candidate.name.trim()
        : `Profile ${index}`,
    roleContext:
      typeof candidate.roleContext === "string" ? candidate.roleContext : "",
    style: typeof candidate.style === "string" ? candidate.style : "",
    format: typeof candidate.format === "string" ? candidate.format : "",
    constraints:
      typeof candidate.constraints === "string" ? candidate.constraints : "",
    updatedAt:
      typeof candidate.updatedAt === "string" && candidate.updatedAt
        ? candidate.updatedAt
        : nowIso(),
  };
}

function normalizeProfiles(value: unknown): {
  activeProfileId: string;
  userProfiles: UserProfile[];
} {
  const parsed = value as Partial<UserProfilesFile>;
  const profiles = Array.isArray(parsed.profiles)
    ? parsed.profiles
        .map((profile, index) => normalizeProfile(profile, index + 1))
        .filter((profile): profile is UserProfile => profile !== null)
    : [];
  const userProfiles = profiles.length ? profiles : defaultUserProfiles();
  const activeProfileId =
    typeof parsed.activeProfileId === "string" &&
    userProfiles.some((profile) => profile.id === parsed.activeProfileId)
      ? parsed.activeProfileId
      : userProfiles[0].id;

  return { activeProfileId, userProfiles };
}

function normalizeMetricTotals(value: unknown): MemoryMetricTotals {
  const candidate = value as Partial<MemoryMetricTotals>;

  return {
    turns:
      typeof candidate?.turns === "number" && Number.isFinite(candidate.turns)
        ? candidate.turns
        : 0,
    requestTokens:
      typeof candidate?.requestTokens === "number" &&
      Number.isFinite(candidate.requestTokens)
        ? candidate.requestTokens
        : 0,
    contextTokens:
      typeof candidate?.contextTokens === "number" &&
      Number.isFinite(candidate.contextTokens)
        ? candidate.contextTokens
        : 0,
    responseTokens:
      typeof candidate?.responseTokens === "number" &&
      Number.isFinite(candidate.responseTokens)
        ? candidate.responseTokens
        : 0,
    totalTokens:
      typeof candidate?.totalTokens === "number" &&
      Number.isFinite(candidate.totalTokens)
        ? candidate.totalTokens
        : 0,
    elapsedMs:
      typeof candidate?.elapsedMs === "number" &&
      Number.isFinite(candidate.elapsedMs)
        ? candidate.elapsedMs
        : 0,
    providerCost:
      typeof candidate?.providerCost === "number" &&
      Number.isFinite(candidate.providerCost)
        ? candidate.providerCost
        : 0,
    hasProviderCost: candidate?.hasProviderCost === true,
  };
}

function normalizeTaskState(value: unknown, fallback: TaskState = "planning"): TaskState {
  return TASK_STATES.includes(value as TaskState) ? (value as TaskState) : fallback;
}

function normalizeTaskDeliverableKind(
  value: unknown,
  task = "",
  contract?: RequirementsContract,
): TaskDeliverableKind {
  if (value === "planning_artifact" || value === "implementation_result") {
    return value;
  }

  const text = [
    task,
    contract?.goal ?? "",
    contract?.targetLocation ?? "",
    ...(contract?.requirements ?? []),
  ]
    .join(" ")
    .toLowerCase();

  return /assistant dialog|workflow-aware plan|\bshow\b.*\bplan\b|\bplan\b|план|услови|задан/i.test(
    text,
  )
    ? "planning_artifact"
    : "implementation_result";
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function normalizeTaskInvariant(value: unknown): TaskInvariant | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<TaskInvariant>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.description !== "string" ||
    !candidate.title.trim() ||
    !candidate.description.trim()
  ) {
    return null;
  }

  const appliesTo = Array.isArray(candidate.appliesTo)
    ? candidate.appliesTo
        .map((stage) => normalizeTaskState(stage, "planning"))
        .filter((stage, index, stages) => stages.indexOf(stage) === index)
    : TASK_STATES;

  return {
    id: candidate.id,
    title: candidate.title.trim(),
    description: candidate.description.trim(),
    dialogId:
      typeof candidate.dialogId === "string" && candidate.dialogId.trim()
        ? candidate.dialogId.trim()
        : null,
    scope:
      candidate.scope === "task" || candidate.scope === "stage"
        ? candidate.scope
        : "global",
    appliesTo: appliesTo.length ? appliesTo : TASK_STATES,
    severity: candidate.severity === "warning" ? "warning" : "blocker",
    enabled: candidate.enabled !== false,
    source:
      candidate.source === "user" || candidate.source === "task"
        ? candidate.source
        : "built-in",
    createdAt:
      typeof candidate.createdAt === "string" && candidate.createdAt
        ? candidate.createdAt
        : nowIso(),
    updatedAt:
      typeof candidate.updatedAt === "string" && candidate.updatedAt
        ? candidate.updatedAt
        : nowIso(),
  };
}

function isWorkflowMetaTaskInvariant(invariant: Pick<TaskInvariant, "title" | "description">) {
  const text = `${invariant.title} ${invariant.description}`
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/giu, " ");
  return [
    "lifecycle workflow priority",
    "workflow lifecycle",
    "explicit approval",
    "plan approval",
    "before execution",
    "read only mcp",
    "mutating mcp",
    "mcp context policy",
    "orchestrator",
    "validation before done",
    "user acceptance",
  ].some((signal) => text.includes(signal));
}

function normalizeInvariants(value: unknown): TaskInvariant[] {
  return Array.isArray(value)
    ? value
        .map(normalizeTaskInvariant)
        .filter((invariant): invariant is TaskInvariant => invariant !== null)
        .filter((invariant) => invariant.source === "user")
    : [];
}

function normalizeInvariantsFile(value: unknown): TaskInvariant[] {
  if (Array.isArray(value)) {
    return normalizeInvariants(value);
  }

  const parsed = value as TaskInvariantsFile;
  return normalizeInvariants(parsed?.invariants);
}

function emptyRequirementsContract(): RequirementsContract {
  return {
    goal: "",
    targetLocation: null,
    requirements: [],
    constraints: [],
    assumptions: [],
    acceptanceCriteria: [],
    openQuestions: [],
    readyForApproval: false,
    updatedAt: nowIso(),
  };
}

function isUnknownRequirementValue(value: string) {
  return /^(unknown|not specified|unspecified|not provided|n\/a|none|null|tbd|to be determined|-+)$/i.test(
    value.trim(),
  );
}

function normalizeRequirementItems(value: unknown) {
  return normalizeStringArray(value).filter(
    (item) => !isUnknownRequirementValue(item),
  );
}

function normalizeRequirementsContract(value: unknown): RequirementsContract {
  if (!value || typeof value !== "object") {
    return emptyRequirementsContract();
  }

  const candidate = value as Partial<RequirementsContract>;
  return {
    goal:
      typeof candidate.goal === "string" &&
      !isUnknownRequirementValue(candidate.goal)
        ? candidate.goal.trim()
        : "",
    targetLocation:
      typeof candidate.targetLocation === "string" &&
      candidate.targetLocation.trim() &&
      !isUnknownRequirementValue(candidate.targetLocation)
        ? candidate.targetLocation.trim()
        : null,
    requirements: normalizeRequirementItems(candidate.requirements),
    constraints: normalizeRequirementItems(candidate.constraints),
    assumptions: normalizeRequirementItems(candidate.assumptions),
    acceptanceCriteria: normalizeRequirementItems(candidate.acceptanceCriteria),
    openQuestions: normalizeRequirementItems(candidate.openQuestions),
    readyForApproval: candidate.readyForApproval === true,
    updatedAt:
      typeof candidate.updatedAt === "string" && candidate.updatedAt
        ? candidate.updatedAt
        : nowIso(),
  };
}

function normalizeTaskContext(value: unknown): TaskContext | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<TaskContext>;
  if (typeof candidate.id !== "string" || typeof candidate.task !== "string") {
    return null;
  }

  const plan = normalizeStringArray(candidate.plan);
  const done = normalizeStringArray(candidate.done);
  const total =
    typeof candidate.total === "number" && Number.isFinite(candidate.total)
      ? Math.max(1, Math.round(candidate.total))
      : Math.max(1, plan.length || 4);
  const step =
    typeof candidate.step === "number" && Number.isFinite(candidate.step)
      ? Math.min(total, Math.max(1, Math.round(candidate.step)))
      : 1;
  const requirementsContract = normalizeRequirementsContract(
    candidate.requirementsContract,
  );

  return {
    id: candidate.id,
    task: candidate.task.trim() || "Untitled task",
    state: normalizeTaskState(candidate.state),
    deliverableKind: normalizeTaskDeliverableKind(
      candidate.deliverableKind,
      candidate.task,
      requirementsContract,
    ),
    step,
    total,
    plan,
    done,
    current: typeof candidate.current === "string" ? candidate.current : "",
    pausedReason:
      typeof candidate.pausedReason === "string" && candidate.pausedReason.trim()
        ? candidate.pausedReason.trim()
        : null,
    awaitingPlanApproval: candidate.awaitingPlanApproval === true,
    requirementsContract,
    externalContext:
      typeof candidate.externalContext === "string" &&
      candidate.externalContext.trim()
        ? candidate.externalContext.trim()
        : null,
    startedAt:
      typeof candidate.startedAt === "string" && candidate.startedAt
        ? candidate.startedAt
        : nowIso(),
    updatedAt:
      typeof candidate.updatedAt === "string" && candidate.updatedAt
        ? candidate.updatedAt
        : nowIso(),
  };
}

function normalizeStageArtifact(value: unknown): StageArtifact | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<StageArtifact>;
  if (typeof candidate.id !== "string" || typeof candidate.content !== "string") {
    return null;
  }

  return {
    id: candidate.id,
    stage: normalizeTaskState(candidate.stage),
    title:
      typeof candidate.title === "string" && candidate.title.trim()
        ? candidate.title.trim()
        : "Stage artifact",
    content: candidate.content,
    summary:
      typeof candidate.summary === "string" && candidate.summary.trim()
        ? candidate.summary.trim()
        : candidate.content.slice(0, 180),
    createdAt:
      typeof candidate.createdAt === "string" && candidate.createdAt
        ? candidate.createdAt
        : nowIso(),
  };
}

function normalizeAgentRun(value: unknown): AgentRun | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<AgentRun>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.agentId !== "string" ||
    typeof candidate.output !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    agentId: candidate.agentId,
    stage: normalizeTaskState(candidate.stage),
    role:
      typeof candidate.role === "string" && candidate.role.trim()
        ? candidate.role.trim()
        : candidate.agentId,
    inputSummary:
      typeof candidate.inputSummary === "string" ? candidate.inputSummary : "",
    output: candidate.output,
    findings: normalizeStringArray(candidate.findings),
    confidence:
      typeof candidate.confidence === "number" &&
      Number.isFinite(candidate.confidence)
        ? Math.max(0, Math.min(1, candidate.confidence))
        : 0,
    createdAt:
      typeof candidate.createdAt === "string" && candidate.createdAt
        ? candidate.createdAt
        : nowIso(),
  };
}

function normalizeSwarmRun(value: unknown): SwarmRun | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<SwarmRun>;
  if (typeof candidate.id !== "string") {
    return null;
  }

  const outputs = Array.isArray(candidate.outputs)
    ? candidate.outputs
        .map(normalizeAgentRun)
        .filter((run): run is AgentRun => run !== null)
    : [];

  return {
    id: candidate.id,
    stage: normalizeTaskState(candidate.stage),
    agentIds: normalizeStringArray(candidate.agentIds),
    outputs,
    aggregatedDecision:
      typeof candidate.aggregatedDecision === "string"
        ? candidate.aggregatedDecision
        : "",
    createdAt:
      typeof candidate.createdAt === "string" && candidate.createdAt
        ? candidate.createdAt
        : nowIso(),
  };
}

function normalizeTransitionDecision(value: unknown): TransitionDecision | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<TransitionDecision>;
  if (typeof candidate.id !== "string") {
    return null;
  }

  return {
    id: candidate.id,
    from: normalizeTaskState(candidate.from),
    to: normalizeTaskState(candidate.to),
    allowed: candidate.allowed === true,
    reason: typeof candidate.reason === "string" ? candidate.reason : "",
    createdAt:
      typeof candidate.createdAt === "string" && candidate.createdAt
        ? candidate.createdAt
        : nowIso(),
  };
}

function normalizeValidationResult(value: unknown): ValidationResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<ValidationResult>;
  if (typeof candidate.passed !== "boolean") {
    return null;
  }

  return {
    passed: candidate.passed,
    reason: typeof candidate.reason === "string" ? candidate.reason : "",
    failedInvariants: normalizeStringArray(candidate.failedInvariants),
    retryInstruction:
      typeof candidate.retryInstruction === "string" &&
      candidate.retryInstruction.trim()
        ? candidate.retryInstruction.trim()
        : null,
    reviewerCount:
      typeof candidate.reviewerCount === "number" &&
      Number.isFinite(candidate.reviewerCount)
        ? Math.max(0, Math.round(candidate.reviewerCount))
        : 0,
    createdAt:
      typeof candidate.createdAt === "string" && candidate.createdAt
        ? candidate.createdAt
        : nowIso(),
  };
}

function normalizeTaskInvariantArray(value: unknown): TaskInvariant[] {
  return Array.isArray(value)
    ? value
        .map(normalizeTaskInvariant)
        .filter((invariant): invariant is TaskInvariant => invariant !== null)
        .filter((invariant) => invariant.source === "task")
        .filter((invariant) => !isWorkflowMetaTaskInvariant(invariant))
    : [];
}

function hasApprovedTaskPlan(
  context: TaskContext,
  transitions: TransitionDecision[],
) {
  return (
    context.done.some((item) =>
      item.toLowerCase().includes("plan explicitly approved by user"),
    ) ||
    transitions.some(
      (transition) =>
        transition.from === "planning" &&
        transition.to === "execution" &&
        transition.allowed,
    )
  );
}

function normalizeTaskRun(value: unknown): TaskRun | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<TaskRun> & {
    invariants?: unknown[];
  };
  const context = normalizeTaskContext(candidate.context);
  if (!context) {
    return null;
  }
  const artifacts = Array.isArray(candidate.artifacts)
    ? candidate.artifacts
        .map(normalizeStageArtifact)
        .filter((artifact): artifact is StageArtifact => artifact !== null)
    : [];
  const agentRuns = Array.isArray(candidate.agentRuns)
    ? candidate.agentRuns
        .map(normalizeAgentRun)
        .filter((run): run is AgentRun => run !== null)
    : [];
  const swarmRuns = Array.isArray(candidate.swarmRuns)
    ? candidate.swarmRuns
        .map(normalizeSwarmRun)
        .filter((run): run is SwarmRun => run !== null)
    : [];
  const transitions = Array.isArray(candidate.transitions)
    ? candidate.transitions
        .map(normalizeTransitionDecision)
        .filter((decision): decision is TransitionDecision => decision !== null)
    : [];
  const legacyTaskInvariants = Array.isArray(candidate.taskInvariants)
    ? normalizeTaskInvariantArray(candidate.taskInvariants)
    : normalizeTaskInvariantArray(candidate.invariants);
  const normalizedPendingTaskInvariants = normalizeTaskInvariantArray(
    candidate.pendingTaskInvariants,
  );
  const shouldTreatLegacyInvariantsAsPending =
    context.state === "planning" && !hasApprovedTaskPlan(context, transitions);
  const taskInvariants = shouldTreatLegacyInvariantsAsPending
    ? []
    : legacyTaskInvariants;
  const pendingTaskInvariants = shouldTreatLegacyInvariantsAsPending
    ? [...legacyTaskInvariants, ...normalizedPendingTaskInvariants]
    : normalizedPendingTaskInvariants;
  const allowedInvariantIds = new Set(
    [...taskInvariants, ...pendingTaskInvariants].map((invariant) => invariant.id),
  );
  const invariantRefs = Array.isArray(candidate.invariantRefs)
    ? candidate.invariantRefs
        .filter((item): item is string => typeof item === "string")
        .filter((item) => allowedInvariantIds.has(item))
    : Array.isArray(candidate.invariants)
      ? taskInvariants.map((invariant) => invariant.id)
      : [];

  return {
    context,
    invariantRefs,
    taskInvariants,
    pendingTaskInvariants,
    artifacts,
    agentRuns,
    swarmRuns,
    transitions,
    validationResult: normalizeValidationResult(candidate.validationResult),
    updatedAt:
      typeof candidate.updatedAt === "string" && candidate.updatedAt
        ? candidate.updatedAt
        : nowIso(),
  };
}

function normalizeProfileField(value: unknown): UserProfileField | null {
  return value === "roleContext" ||
    value === "style" ||
    value === "format" ||
    value === "constraints"
    ? value
    : null;
}

function normalizePendingProfileUpdate(
  value: unknown,
): PendingProfileUpdate | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<PendingProfileUpdate>;
  const field = normalizeProfileField(candidate.field);
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.profileId !== "string" ||
    !field ||
    typeof candidate.value !== "string" ||
    !candidate.value.trim()
  ) {
    return null;
  }

  return {
    id: candidate.id,
    profileId: candidate.profileId,
    field,
    value: candidate.value.trim(),
    reason: typeof candidate.reason === "string" ? candidate.reason : "",
    sourceText:
      typeof candidate.sourceText === "string" ? candidate.sourceText : "",
    confidence:
      typeof candidate.confidence === "number" &&
      Number.isFinite(candidate.confidence)
        ? Math.max(0, Math.min(1, candidate.confidence))
        : 0,
    createdAt:
      typeof candidate.createdAt === "string" && candidate.createdAt
        ? candidate.createdAt
        : nowIso(),
  };
}

function isMemoryLayerNote(value: unknown): value is MemoryLayerNote {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<MemoryLayerNote>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.text === "string" &&
    typeof candidate.source === "string" &&
    typeof candidate.createdAt === "string"
  );
}

function normalizeBranch(value: unknown, index: number): MemoryBranch | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<MemoryBranch>;
  if (typeof candidate.id !== "string") {
    return null;
  }
  const profileSummaries =
    candidate.profileSummaries &&
    typeof candidate.profileSummaries === "object" &&
    !Array.isArray(candidate.profileSummaries)
      ? Object.fromEntries(
          Object.entries(candidate.profileSummaries).filter(
            (entry): entry is [string, string] =>
              typeof entry[0] === "string" &&
              typeof entry[1] === "string",
          ),
        )
      : {};

  return {
    id: candidate.id,
    title:
      typeof candidate.title === "string" && candidate.title.trim()
        ? candidate.title.trim()
        : index === 1
          ? "Main topic"
          : `Topic ${index}`,
    summary: typeof candidate.summary === "string" ? candidate.summary : "",
    profileSummaries,
    messages: Array.isArray(candidate.messages)
      ? candidate.messages.filter(isChatMessage)
      : [],
    updatedAt:
      typeof candidate.updatedAt === "string" && candidate.updatedAt
        ? candidate.updatedAt
        : nowIso(),
  };
}

function normalizeDialogs(value: unknown): MemoryDialog[] {
  const parsed = value as Partial<ShortTermFile>;
  return Array.isArray(parsed.dialogs)
    ? parsed.dialogs
        .filter((dialog): dialog is Record<string, unknown> => {
          return (
            !!dialog &&
            typeof dialog === "object" &&
            typeof (dialog as Record<string, unknown>).id === "string" &&
            typeof (dialog as Record<string, unknown>).title === "string"
          );
        })
        .map((dialog, index) => {
          const messages = Array.isArray(dialog.messages)
            ? dialog.messages
                .filter(isChatMessage)
                .filter((message) => message.role !== "system")
            : [];
          const visible = visibleMessages(messages);
          const rawBranches = Array.isArray(dialog.branches)
            ? dialog.branches
            : [];
          const branches = rawBranches
            .map((branch, branchIndex) => normalizeBranch(branch, branchIndex + 1))
            .filter((branch): branch is MemoryBranch => branch !== null);
          const safeBranches = branches.length
            ? branches
            : [makeBranch(1, visible)];
          const activeBranchId =
            typeof dialog.activeBranchId === "string" &&
            safeBranches.some((branch) => branch.id === dialog.activeBranchId)
              ? dialog.activeBranchId
              : safeBranches[0].id;

          return {
            id: String(dialog.id),
            title: String(dialog.title),
            messages,
            metrics: Array.isArray(dialog.metrics)
              ? dialog.metrics.filter(isMetricRow)
              : [],
            activeBranchId,
            branches: safeBranches,
            compactMetricsSummary:
              typeof dialog.compactMetricsSummary === "string" &&
              dialog.compactMetricsSummary.trim()
                ? dialog.compactMetricsSummary
                : "No requests yet.",
            pendingConfirmation:
              typeof dialog.pendingConfirmation === "string" &&
              dialog.pendingConfirmation.trim()
                ? dialog.pendingConfirmation
                : null,
            taskRun: normalizeTaskRun(dialog.taskRun),
          };
        })
    : [];
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function readOptionalJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readTextFile(filePath: string) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function parseMarkdownNotes(markdown: string, source: string): MemoryLayerNote[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line, index) => {
      const text = line.replace(/^- /, "").replace(/\s+\(_source:.*\)$/, "").trim();
      return {
        id: `${source}-${index}-${text.slice(0, 24)}`,
        text,
        source,
        createdAt: "",
      };
    })
    .filter((note) => note.text.length > 0);
}

async function ensureEditableMemoryFile(filePath: string, title: string) {
  try {
    await readFile(filePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `# ${title}\n\n`, "utf8");
  }
}

export function makeMemoryLayerId(prefix: string) {
  return makeId(prefix);
}

export function getActiveMemoryDialog(state: MemoryLayersState) {
  return (
    state.dialogs.find((dialog) => dialog.id === state.activeDialogId) ??
    state.dialogs[0]
  );
}

export function getActiveMemoryBranch(dialog: MemoryDialog) {
  return (
    dialog.branches.find((branch) => branch.id === dialog.activeBranchId) ??
    dialog.branches[0]
  );
}

export async function readMemoryLayersState(): Promise<MemoryLayersState> {
  const index = await readJsonFile<MemoryIndexFile>(MEMORY_INDEX_FILE, {});
  const fileSettings = normalizeFileSettings(index.fileSettings);
  const filePaths = resolveFilePaths(fileSettings);
  const shortTerm = await readJsonFile<ShortTermFile>(filePaths.shortTerm, {});
  const invariantsFile = await readOptionalJsonFile<TaskInvariantsFile | unknown[]>(
    filePaths.invariants,
  );
  const profileFile = await readJsonFile<UserProfilesFile>(
    filePaths.userProfiles,
    {},
  );
  const dialogs = normalizeDialogs(shortTerm);
  const profiles = normalizeProfiles(profileFile);
  const globalMetrics = normalizeMetricTotals(shortTerm.globalMetrics);
  const storedInvariants =
    invariantsFile === null
      ? normalizeInvariants(shortTerm.invariants)
      : normalizeInvariantsFile(invariantsFile);
  const pendingProfileUpdates = Array.isArray(shortTerm.pendingProfileUpdates)
    ? shortTerm.pendingProfileUpdates
        .map(normalizePendingProfileUpdate)
        .filter((update): update is PendingProfileUpdate => update !== null)
    : [];
  const safeDialogs = dialogs.length ? dialogs : [createDialog(1)];
  const activeDialogId =
    safeDialogs.find((dialog) => dialog.id === index.activeDialogId)?.id ??
    safeDialogs[0].id;
  const dialogIds = new Set(safeDialogs.map((dialog) => dialog.id));
  const scopedInvariants = storedInvariants
    .map((invariant) =>
      invariant.source === "user" && !invariant.dialogId
        ? { ...invariant, dialogId: activeDialogId }
        : invariant,
    )
    .filter(
      (invariant) =>
        invariant.source !== "user" ||
        (invariant.dialogId !== null && dialogIds.has(invariant.dialogId)),
    );
  const workingMarkdown = await readTextFile(filePaths.working);
  const longTermMarkdown = await readTextFile(filePaths.longTerm);

  return {
    activeDialogId,
    dialogs: safeDialogs,
    workingMemory: parseMarkdownNotes(workingMarkdown, fileSettings.workingMemoryFileName),
    longTermMemory: parseMarkdownNotes(longTermMarkdown, fileSettings.longTermMemoryFileName),
    activeProfileId: profiles.activeProfileId,
    userProfiles: profiles.userProfiles,
    invariants: scopedInvariants,
    pendingProfileUpdates,
    globalMetrics,
    fileSettings,
    filePaths,
  };
}

export async function writeMemoryLayersState(state: MemoryLayersState) {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(state.fileSettings.memoryFolder, { recursive: true });
  await writeFile(
    MEMORY_INDEX_FILE,
    JSON.stringify(
      {
        activeDialogId: state.activeDialogId,
        fileSettings: state.fileSettings,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    state.filePaths.shortTerm,
    JSON.stringify(
      {
        dialogs: state.dialogs,
        globalMetrics: state.globalMetrics,
        pendingProfileUpdates: state.pendingProfileUpdates,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    state.filePaths.invariants,
    JSON.stringify(
      {
        invariants: state.invariants,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    state.filePaths.userProfiles,
    JSON.stringify(
      {
        activeProfileId: state.activeProfileId,
        profiles: state.userProfiles,
      },
      null,
      2,
    ),
    "utf8",
  );
  await ensureEditableMemoryFile(state.filePaths.working, "Working Memory");
  await ensureEditableMemoryFile(state.filePaths.longTerm, "Long-Term Memory");
}

export async function appendMemoryNote(
  filePath: string,
  text: string,
  source: string,
) {
  await ensureEditableMemoryFile(filePath, path.basename(filePath, path.extname(filePath)));
  const existing = await readTextFile(filePath);
  const normalized = text.trim();
  const alreadyExists = existing
    .toLowerCase()
    .includes(normalized.toLowerCase());

  if (alreadyExists) {
    return false;
  }

  const timestamp = nowIso();
  const line = `- ${normalized} (_source: ${source}; ${timestamp}_)\n`;
  const separator = existing.endsWith("\n") ? "" : "\n";
  await writeFile(filePath, `${existing}${separator}${line}`, "utf8");
  return true;
}

export function updateMemoryFileSettings(
  state: MemoryLayersState,
  settings: Partial<MemoryFileSettings>,
): MemoryLayersState {
  const fileSettings = normalizeFileSettings({
    ...state.fileSettings,
    ...settings,
  });
  const filePaths = resolveFilePaths(fileSettings);

  return {
    ...state,
    fileSettings,
    filePaths,
  };
}

export async function moveMemoryFolder(
  state: MemoryLayersState,
  nextMemoryFolder: string,
): Promise<MemoryLayersState> {
  const memoryFolder = nextMemoryFolder.trim();
  if (!memoryFolder) {
    throw new Error("Memory folder is required.");
  }

  const fileSettings = normalizeFileSettings({
    ...state.fileSettings,
    memoryFolder,
  });
  const nextFilePaths = resolveFilePaths(fileSettings);
  const knownFiles = [
    [state.filePaths.shortTerm, nextFilePaths.shortTerm],
    [state.filePaths.working, nextFilePaths.working],
    [state.filePaths.longTerm, nextFilePaths.longTerm],
    [state.filePaths.userProfiles, nextFilePaths.userProfiles],
    [state.filePaths.invariants, nextFilePaths.invariants],
  ] as const;

  await mkdir(fileSettings.memoryFolder, { recursive: true });

  for (const [source, target] of knownFiles) {
    if (source === target) {
      continue;
    }
    if (await fileExists(target)) {
      throw new Error(`Target memory file already exists: ${target}`);
    }
  }

  for (const [source, target] of knownFiles) {
    if (source === target || !(await fileExists(source))) {
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await rename(source, target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EXDEV") {
        throw error;
      }
      await copyFile(source, target);
      await unlink(source);
    }
  }

  return {
    ...state,
    fileSettings,
    filePaths: nextFilePaths,
  };
}

async function fileExists(filePath: string) {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export function getActiveUserProfile(state: MemoryLayersState) {
  return (
    state.userProfiles.find((profile) => profile.id === state.activeProfileId) ??
    state.userProfiles[0]
  );
}

export function setActiveUserProfile(
  state: MemoryLayersState,
  profileId: string,
): MemoryLayersState {
  const activeProfileId = state.userProfiles.some(
    (profile) => profile.id === profileId,
  )
    ? profileId
    : state.activeProfileId;

  return {
    ...state,
    activeProfileId,
  };
}

export function upsertUserProfile(
  state: MemoryLayersState,
  profile: Partial<UserProfile> & { id?: string },
): MemoryLayersState {
  const existing = profile.id
    ? state.userProfiles.find((item) => item.id === profile.id)
    : null;
  const nextProfile: UserProfile = {
    id: existing?.id ?? makeId("user-profile"),
    name: profile.name?.trim() || existing?.name || "Custom profile",
    roleContext: profile.roleContext ?? existing?.roleContext ?? "",
    style: profile.style ?? existing?.style ?? "",
    format: profile.format ?? existing?.format ?? "",
    constraints: profile.constraints ?? existing?.constraints ?? "",
    updatedAt: nowIso(),
  };
  const userProfiles = existing
    ? state.userProfiles.map((item) =>
        item.id === existing.id ? nextProfile : item,
      )
    : [...state.userProfiles, nextProfile];

  return {
    ...state,
    activeProfileId: nextProfile.id,
    userProfiles,
  };
}

export function createUserProfile(
  state: MemoryLayersState,
  name: string,
): MemoryLayersState {
  const profile = makeProfile({
    name: name.trim(),
    roleContext: "",
    style: "",
    format: "",
    constraints: "",
  });

  return {
    ...state,
    activeProfileId: profile.id,
    userProfiles: [...state.userProfiles, profile],
  };
}

export function renameUserProfile(
  state: MemoryLayersState,
  profileId: string,
  name: string,
): MemoryLayersState {
  const title = name.trim();

  return {
    ...state,
    userProfiles: state.userProfiles.map((profile) =>
      profile.id === profileId
        ? { ...profile, name: title, updatedAt: nowIso() }
        : profile,
    ),
  };
}

export function updateUserProfile(
  state: MemoryLayersState,
  profile: Partial<UserProfile> & { id: string },
): MemoryLayersState {
  return {
    ...state,
    userProfiles: state.userProfiles.map((item) =>
      item.id === profile.id
        ? {
            ...item,
            roleContext: profile.roleContext ?? item.roleContext,
            style: profile.style ?? item.style,
            format: profile.format ?? item.format,
            constraints: profile.constraints ?? item.constraints,
            updatedAt: nowIso(),
          }
        : item,
    ),
  };
}

export function addPendingProfileUpdates(
  state: MemoryLayersState,
  updates: Array<Omit<PendingProfileUpdate, "id" | "createdAt">>,
): MemoryLayersState {
  const existingKeys = new Set(
    state.pendingProfileUpdates.map((update) =>
      [
        update.profileId,
        update.field,
        update.value.trim().toLowerCase(),
      ].join("|"),
    ),
  );
  const pendingProfileUpdates = [...state.pendingProfileUpdates];

  for (const update of updates) {
    const normalizedValue = update.value.trim();
    if (!normalizedValue) {
      continue;
    }

    const key = [
      update.profileId,
      update.field,
      normalizedValue.toLowerCase(),
    ].join("|");
    if (existingKeys.has(key)) {
      continue;
    }

    existingKeys.add(key);
    pendingProfileUpdates.push({
      ...update,
      id: makeId("profile-update"),
      value: normalizedValue,
      confidence: Math.max(0, Math.min(1, update.confidence)),
      createdAt: nowIso(),
    });
  }

  return {
    ...state,
    pendingProfileUpdates,
  };
}

export function applyPendingProfileUpdate(
  state: MemoryLayersState,
  updateId: string,
): MemoryLayersState {
  const update = state.pendingProfileUpdates.find((item) => item.id === updateId);
  if (!update) {
    return state;
  }

  return {
    ...state,
    userProfiles: state.userProfiles.map((profile) =>
      profile.id === update.profileId
        ? {
            ...profile,
            [update.field]: update.value,
            updatedAt: nowIso(),
          }
        : profile,
    ),
    pendingProfileUpdates: state.pendingProfileUpdates.filter(
      (item) => item.id !== updateId,
    ),
  };
}

export function dismissPendingProfileUpdate(
  state: MemoryLayersState,
  updateId: string,
): MemoryLayersState {
  return {
    ...state,
    pendingProfileUpdates: state.pendingProfileUpdates.filter(
      (item) => item.id !== updateId,
    ),
  };
}

export function applyAllPendingProfileUpdates(
  state: MemoryLayersState,
  profileId?: string,
): MemoryLayersState {
  return state.pendingProfileUpdates
    .filter((update) => !profileId || update.profileId === profileId)
    .reduce(
    (nextState, update) => applyPendingProfileUpdate(nextState, update.id),
    state,
  );
}

export function dismissAllPendingProfileUpdates(
  state: MemoryLayersState,
  profileId?: string,
): MemoryLayersState {
  return {
    ...state,
    pendingProfileUpdates: profileId
      ? state.pendingProfileUpdates.filter(
          (update) => update.profileId !== profileId,
        )
      : [],
  };
}

export function deleteUserProfile(
  state: MemoryLayersState,
  profileId: string,
): MemoryLayersState {
  const remaining = state.userProfiles.filter((profile) => profile.id !== profileId);
  const userProfiles =
    remaining.length > 0
      ? remaining
      : [
          makeProfile({
            name: "Default profile",
            roleContext: "",
            style: "",
            format: "",
            constraints: "",
          }),
        ];
  const activeProfileId =
    state.activeProfileId === profileId
      ? userProfiles[0].id
      : state.activeProfileId;

  return {
    ...state,
    activeProfileId,
    userProfiles,
    pendingProfileUpdates: state.pendingProfileUpdates.filter(
      (update) => update.profileId !== profileId,
    ),
  };
}

export function createTaskInvariant(
  state: MemoryLayersState,
  invariant: Partial<TaskInvariant>,
): MemoryLayersState {
  const now = nowIso();
  const title = invariant.title?.trim() || "Project invariant";
  const description = invariant.description?.trim() || title;
  const appliesTo =
    Array.isArray(invariant.appliesTo) && invariant.appliesTo.length
      ? invariant.appliesTo.map((stage) => normalizeTaskState(stage))
      : TASK_STATES;
  const nextInvariant: TaskInvariant = {
    id: makeId("task-invariant"),
    title,
    description,
    dialogId: state.activeDialogId,
    scope:
      invariant.scope === "task" || invariant.scope === "stage"
        ? invariant.scope
        : "global",
    appliesTo: Array.from(new Set(appliesTo)),
    severity: invariant.severity === "warning" ? "warning" : "blocker",
    enabled: invariant.enabled !== false,
    source: "user",
    createdAt: now,
    updatedAt: now,
  };

  return {
    ...state,
    invariants: [...state.invariants, nextInvariant],
  };
}

export function updateTaskInvariant(
  state: MemoryLayersState,
  invariant: Partial<TaskInvariant> & { id: string },
): MemoryLayersState {
  return {
    ...state,
    invariants: state.invariants.map((item) => {
      if (item.id !== invariant.id || item.source !== "user") {
        return item;
      }

      const appliesTo =
        Array.isArray(invariant.appliesTo) && invariant.appliesTo.length
          ? Array.from(
              new Set(invariant.appliesTo.map((stage) => normalizeTaskState(stage))),
            )
          : item.appliesTo;

      return {
        ...item,
        title: invariant.title?.trim() || item.title,
        description: invariant.description?.trim() || item.description,
        scope:
          invariant.scope === "task" || invariant.scope === "stage"
            ? invariant.scope
            : item.scope,
        appliesTo,
        severity:
          invariant.severity === "warning" || invariant.severity === "blocker"
            ? invariant.severity
            : item.severity,
        enabled: invariant.enabled ?? item.enabled,
        updatedAt: nowIso(),
      };
    }),
  };
}

export function deleteTaskInvariant(
  state: MemoryLayersState,
  invariantId: string,
): MemoryLayersState {
  return {
    ...state,
    invariants: state.invariants.filter(
      (invariant) => invariant.id !== invariantId || invariant.source !== "user",
    ),
  };
}

export function getDialogInvariants(
  state: Pick<MemoryLayersState, "activeDialogId" | "invariants">,
  dialogId = state.activeDialogId,
) {
  return state.invariants.filter(
    (invariant) =>
      invariant.source === "user" &&
      invariant.dialogId === dialogId,
  );
}

export function addGlobalMetricRow(
  state: MemoryLayersState,
  row: TokenMetricRow,
): MemoryLayersState {
  return {
    ...state,
    globalMetrics: {
      turns: state.globalMetrics.turns + 1,
      requestTokens: state.globalMetrics.requestTokens + row.requestTokens,
      contextTokens: state.globalMetrics.contextTokens + row.contextTokens,
      responseTokens:
        state.globalMetrics.responseTokens + (row.responseTokens ?? 0),
      totalTokens: state.globalMetrics.totalTokens + (row.totalTokens ?? 0),
      elapsedMs: state.globalMetrics.elapsedMs + (row.elapsedMs ?? 0),
      providerCost:
        state.globalMetrics.providerCost + (row.providerCost ?? 0),
      hasProviderCost:
        state.globalMetrics.hasProviderCost || row.providerCost !== null,
    },
  };
}

export function createMemoryDialog(state: MemoryLayersState): MemoryLayersState {
  const dialog = createDialog(state.dialogs.length + 1);

  return {
    ...state,
    activeDialogId: dialog.id,
    dialogs: [...state.dialogs, dialog],
  };
}

export function deleteMemoryDialog(
  state: MemoryLayersState,
  dialogId: string,
): MemoryLayersState {
  const nextDialogs = state.dialogs.filter((dialog) => dialog.id !== dialogId);
  const dialogs = nextDialogs.length ? nextDialogs : [createDialog(1)];
  const activeDialogId =
    state.activeDialogId === dialogId ? dialogs[0].id : state.activeDialogId;

  return {
    ...state,
    activeDialogId,
    dialogs,
    invariants: state.invariants.filter(
      (invariant) =>
        invariant.source !== "user" || invariant.dialogId !== dialogId,
    ),
  };
}

export function withUpdatedActiveMemoryDialog(
  state: MemoryLayersState,
  updater: (dialog: MemoryDialog) => MemoryDialog,
): MemoryLayersState {
  const active = getActiveMemoryDialog(state);

  return {
    ...state,
    activeDialogId: active.id,
    dialogs: state.dialogs.map((dialog) =>
      dialog.id === active.id ? updater(active) : dialog,
    ),
  };
}
