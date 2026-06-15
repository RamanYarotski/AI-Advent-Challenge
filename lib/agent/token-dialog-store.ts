import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatMessage } from "@/lib/llm";
import type { TokenDialog, TokenLabState, TokenMetricRow } from "@/lib/tokens";

const DATA_DIR = path.join(process.cwd(), ".data");
const TOKEN_DIALOG_FILE = path.join(DATA_DIR, "day-8-dialogs.json");

const SYSTEM_MESSAGE: ChatMessage = {
  role: "system",
  content:
    "You are a token-aware assistant for AI Advent Challenge. Keep answers concise and useful for demonstrating token growth in a dialog.",
};

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createDialog(index: number): TokenDialog {
  return {
    id: makeId("dialog"),
    title: `Dialog ${index}`,
    messages: [SYSTEM_MESSAGE],
    metrics: [],
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

function normalizeState(value: unknown): TokenLabState {
  const parsed = value as Partial<TokenLabState>;
  const dialogs = Array.isArray(parsed.dialogs)
    ? parsed.dialogs
        .filter((dialog): dialog is TokenDialog => {
          return (
            !!dialog &&
            typeof dialog === "object" &&
            typeof (dialog as TokenDialog).id === "string" &&
            typeof (dialog as TokenDialog).title === "string"
          );
        })
        .map((dialog) => ({
          id: dialog.id,
          title: dialog.title,
          messages: Array.isArray(dialog.messages)
            ? dialog.messages.filter(isChatMessage)
            : [SYSTEM_MESSAGE],
          metrics: Array.isArray(dialog.metrics)
            ? dialog.metrics.filter(isMetricRow)
            : [],
        }))
    : [];

  const safeDialogs = dialogs.length ? dialogs : [createDialog(1)];
  const activeDialogId =
    safeDialogs.find((dialog) => dialog.id === parsed.activeDialogId)?.id ??
    safeDialogs[0].id;

  return {
    activeDialogId,
    dialogs: safeDialogs,
  };
}

export function makeMetricId() {
  return makeId("metric");
}

export async function readTokenLabState(): Promise<TokenLabState> {
  try {
    const raw = await readFile(TOKEN_DIALOG_FILE, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return normalizeState({});
    }
    throw error;
  }
}

export async function writeTokenLabState(state: TokenLabState) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(
    TOKEN_DIALOG_FILE,
    JSON.stringify(normalizeState(state), null, 2),
    "utf8",
  );
}

export function createTokenDialog(state: TokenLabState): TokenLabState {
  const dialog = createDialog(state.dialogs.length + 1);
  return {
    activeDialogId: dialog.id,
    dialogs: [...state.dialogs, dialog],
  };
}

export function deleteTokenDialog(
  state: TokenLabState,
  dialogId: string,
): TokenLabState {
  const nextDialogs = state.dialogs.filter((dialog) => dialog.id !== dialogId);
  const dialogs = nextDialogs.length ? nextDialogs : [createDialog(1)];
  const activeDialogId =
    state.activeDialogId === dialogId ? dialogs[0].id : state.activeDialogId;

  return normalizeState({
    activeDialogId,
    dialogs,
  });
}
