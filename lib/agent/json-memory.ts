import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatMessage } from "@/lib/llm";

const MEMORY_DIR = path.join(process.cwd(), ".data");
const MEMORY_FILE = path.join(MEMORY_DIR, "day-7-history.json");

type MemoryFile = {
  messages: ChatMessage[];
};

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

export async function readMemory(): Promise<ChatMessage[]> {
  try {
    const raw = await readFile(MEMORY_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<MemoryFile>;
    return Array.isArray(parsed.messages)
      ? parsed.messages.filter(isChatMessage)
      : [];
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function writeMemory(messages: ChatMessage[]) {
  await mkdir(MEMORY_DIR, { recursive: true });
  await writeFile(
    MEMORY_FILE,
    JSON.stringify({ messages }, null, 2),
    "utf8",
  );
}

