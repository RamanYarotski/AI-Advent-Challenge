import { mkdir, readFile, writeFile } from "node:fs/promises";
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
};

export type MemoryFilePaths = {
  shortTerm: string;
  working: string;
  longTerm: string;
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
    | "prompt_context";
  detail: string;
  filePath: string;
};

export type MemoryBranch = {
  id: string;
  title: string;
  summary: string;
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
};

export type MemoryLayersState = {
  activeDialogId: string;
  dialogs: MemoryDialog[];
  workingMemory: MemoryLayerNote[];
  longTermMemory: MemoryLayerNote[];
  fileSettings: MemoryFileSettings;
  filePaths: MemoryFilePaths;
};

type MemoryIndexFile = {
  activeDialogId?: string;
  fileSettings?: Partial<MemoryFileSettings>;
};

type ShortTermFile = {
  dialogs?: unknown[];
};

const SYSTEM_MESSAGE: ChatMessage = {
  role: "system",
  content:
    "You are a unified AI Advent Challenge assistant. Use short-term branch context, working task memory, and long-term profile memory deliberately.",
};

function defaultMemoryFolder() {
  return path.join(os.homedir(), "Documents", "AI-Advent-Challenge", "memory");
}

const DEFAULT_FILE_SETTINGS: MemoryFileSettings = {
  memoryFolder: defaultMemoryFolder(),
  shortTermFileName: "short-term-dialogs.json",
  workingMemoryFileName: "working-memory.md",
  longTermMemoryFileName: "long-term-memory.md",
};

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function visibleMessages(messages: ChatMessage[]) {
  return messages.filter((message) => message.role !== "system");
}

function makeBranch(index: number, messages: ChatMessage[] = []): MemoryBranch {
  return {
    id: makeId("memory-branch"),
    title: index === 1 ? "Main topic" : `Topic ${index}`,
    summary: "",
    messages,
    updatedAt: nowIso(),
  };
}

function createDialog(index: number): MemoryDialog {
  const branch = makeBranch(1);
  return {
    id: makeId("memory-dialog"),
    title: `Dialog ${index}`,
    messages: [SYSTEM_MESSAGE],
    metrics: [],
    activeBranchId: branch.id,
    branches: [branch],
    compactMetricsSummary: "No requests yet.",
    pendingConfirmation: null,
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
  };
}

function resolveFilePaths(settings: MemoryFileSettings): MemoryFilePaths {
  return {
    shortTerm: path.join(settings.memoryFolder, settings.shortTermFileName),
    working: path.join(settings.memoryFolder, settings.workingMemoryFileName),
    longTerm: path.join(settings.memoryFolder, settings.longTermMemoryFileName),
    index: MEMORY_INDEX_FILE,
  };
}

function normalizeBranch(value: unknown, index: number): MemoryBranch | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<MemoryBranch>;
  if (typeof candidate.id !== "string") {
    return null;
  }

  return {
    id: candidate.id,
    title:
      typeof candidate.title === "string" && candidate.title.trim()
        ? candidate.title.trim()
        : index === 1
          ? "Main topic"
          : `Topic ${index}`,
    summary: typeof candidate.summary === "string" ? candidate.summary : "",
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
            ? dialog.messages.filter(isChatMessage)
            : [SYSTEM_MESSAGE];
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
            messages: messages.length ? messages : [SYSTEM_MESSAGE],
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
  const dialogs = normalizeDialogs(shortTerm);
  const safeDialogs = dialogs.length ? dialogs : [createDialog(1)];
  const activeDialogId =
    safeDialogs.find((dialog) => dialog.id === index.activeDialogId)?.id ??
    safeDialogs[0].id;
  const workingMarkdown = await readTextFile(filePaths.working);
  const longTermMarkdown = await readTextFile(filePaths.longTerm);

  return {
    activeDialogId,
    dialogs: safeDialogs,
    workingMemory: parseMarkdownNotes(workingMarkdown, fileSettings.workingMemoryFileName),
    longTermMemory: parseMarkdownNotes(longTermMarkdown, fileSettings.longTermMemoryFileName),
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
    JSON.stringify({ dialogs: state.dialogs }, null, 2),
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
