"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type DayKey =
  | "day1"
  | "day2"
  | "day3"
  | "day4"
  | "day5"
  | "day6"
  | "day7"
  | "day8"
  | "day9"
  | "day10"
  | "day11"
  | "day12";

type Usage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  providerCost: number | null;
};

type LlmResult = {
  answer: string;
  model: string;
  elapsedMs: number;
  usage: Usage;
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  profileId?: string;
};

type AgentTrace = {
  step: string;
  label: string;
  detail: string;
};

type PanelResult = LlmResult & {
  title: string;
  note?: string;
  manualCost?: number | null;
  trace?: AgentTrace[];
  history?: ChatMessage[];
};

type ModelRow = {
  label: string;
  model: string;
};

type TokenMetricRow = {
  id: string;
  turn: number;
  status: "sent";
  requestTokens: number;
  contextTokens: number;
  responseTokens: number | null;
  totalTokens: number | null;
  elapsedMs: number | null;
  providerCost: number | null;
  note: string;
};

type TokenDialog = {
  id: string;
  title: string;
  messages: ChatMessage[];
  metrics: TokenMetricRow[];
  summary?: string;
  facts?: string[];
  branch?: string;
  branches?: string[];
  strategy?: "sliding_window" | "sticky_facts" | "branching";
};

type TokenLabState = {
  activeDialogId: string;
  dialogs: TokenDialog[];
};

type MemoryLayerKey = "shortTerm" | "working" | "longTerm";

type MemoryFileSettings = {
  memoryFolder: string;
  shortTermFileName: string;
  workingMemoryFileName: string;
  longTermMemoryFileName: string;
  userProfilesFileName: string;
};

type MemoryFilePaths = {
  shortTerm: string;
  working: string;
  longTerm: string;
  userProfiles: string;
  index: string;
};

type MemoryLayerNote = {
  id: string;
  text: string;
  source: string;
  createdAt: string;
};

type MemoryLayerEvent = {
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

type UserProfile = {
  id: string;
  name: string;
  roleContext: string;
  style: string;
  format: string;
  constraints: string;
  updatedAt: string;
};

type UserProfileField = "roleContext" | "style" | "format" | "constraints";

type PendingProfileUpdate = {
  id: string;
  profileId: string;
  field: UserProfileField;
  value: string;
  reason: string;
  sourceText: string;
  confidence: number;
  createdAt: string;
};

type MemoryMetricTotals = {
  turns: number;
  requestTokens: number;
  contextTokens: number;
  responseTokens: number;
  totalTokens: number;
  elapsedMs: number;
  providerCost: number;
  hasProviderCost: boolean;
};

type RequestContextDebug = {
  createdAt: string;
  profile: UserProfile;
  selectedBranchTitle: string;
  selectedBranchSummary: string;
  recentMessages: ChatMessage[];
  workingMemory: MemoryLayerNote[];
  longTermMemory: MemoryLayerNote[];
  assembledMessages: ChatMessage[];
};

type MemoryBranch = {
  id: string;
  title: string;
  summary: string;
  profileSummaries?: Record<string, string>;
  messages: ChatMessage[];
  updatedAt: string;
};

type MemoryDialog = Omit<TokenDialog, "branches"> & {
  activeBranchId: string;
  branches: MemoryBranch[];
  compactMetricsSummary: string;
  pendingConfirmation: string | null;
};

type MemoryLayersState = {
  activeDialogId: string;
  dialogs: MemoryDialog[];
  workingMemory: MemoryLayerNote[];
  longTermMemory: MemoryLayerNote[];
  activeProfileId: string;
  userProfiles: UserProfile[];
  pendingProfileUpdates: PendingProfileUpdate[];
  globalMetrics: MemoryMetricTotals;
  lastRequestContext: RequestContextDebug | null;
  fileSettings: MemoryFileSettings;
  filePaths: MemoryFilePaths;
};

type ModelOption = {
  value: string;
  label: string;
  contextWindowTokens?: number;
};

const modelGroups = [
  {
    label: "Weak",
    options: [
      {
        value: "meta-llama/llama-3.2-1b-instruct",
        label: "Llama 3.2 1B Instruct",
        contextWindowTokens: 131072,
      },
      {
        value: "openai/gpt-4.1-nano",
        label: "GPT-4.1 Nano",
        contextWindowTokens: 1047576,
      },
      {
        value: "deepseek/deepseek-v4-flash",
        label: "DeepSeek V4 Flash",
        contextWindowTokens: 1048576,
      },
    ],
  },
  {
    label: "Medium",
    options: [
      {
        value: "qwen/qwen3-32b",
        label: "Qwen3 32B",
        contextWindowTokens: 131072,
      },
      {
        value: "qwen/qwen-2.5-72b-instruct",
        label: "Qwen 2.5 72B Instruct",
        contextWindowTokens: 131072,
      },
      {
        value: "deepseek/deepseek-chat-v3.1",
        label: "DeepSeek Chat V3.1",
        contextWindowTokens: 163840,
      },
    ],
  },
  {
    label: "Strong",
    options: [
      {
        value: "qwen/qwen3-235b-a22b-thinking-2507",
        label: "Qwen3 235B A22B Thinking",
        contextWindowTokens: 262144,
      },
      {
        value: "deepseek/deepseek-r1",
        label: "DeepSeek R1",
        contextWindowTokens: 163840,
      },
      {
        value: "deepseek/deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
        contextWindowTokens: 1048576,
      },
      { value: "openai/gpt-4o", label: "GPT-4o", contextWindowTokens: 128000 },
      {
        value: "anthropic/claude-sonnet-4",
        label: "Claude Sonnet 4",
        contextWindowTokens: 1000000,
      },
    ],
  },
];

const defaultModel = "openai/gpt-4o";

const days: Array<{ key: DayKey; label: string; title: string }> = [
  { key: "day1", label: "Day 1 API", title: "First LLM API request" },
  { key: "day2", label: "Day 2 Format", title: "Response format control" },
  { key: "day3", label: "Day 3 Reasoning", title: "Reasoning strategies" },
  { key: "day4", label: "Day 4 Temperature", title: "Temperature comparison" },
  { key: "day5", label: "Day 5 Models", title: "Model version comparison" },
  { key: "day6", label: "Day 6 Agent", title: "First agent" },
  { key: "day7", label: "Day 7 Memory", title: "Persistent context" },
  { key: "day8", label: "Day 8 Tokens", title: "Token usage analysis" },
  { key: "day9", label: "Day 9 Compression", title: "History compression" },
  { key: "day10", label: "Day 10 Strategies", title: "Context strategies" },
  { key: "day11", label: "Day 11 Memory", title: "Memory layers" },
  { key: "day12", label: "Day 12 Personalization", title: "Personalized assistant" },
];

const defaultPrompts: Record<DayKey, string> = {
  day1: "Explain what prompt engineering is in 5 simple sentences.",
  day2: "Explain how a developer can use LLMs in everyday work.",
  day3:
    "I have 9 coins. One coin is lighter than the others. How can I find the lighter coin in two weighings on a balance scale?",
  day4: "Suggest a short pet project idea for a developer learning AI.",
  day5:
    "Can I use a non-existent library called react-ai-router-kit in a production project? Answer as an engineer.",
  day6:
    "Explain what an agent is in an LLM application in 3 short sentences.",
  day7:
    "Remember this: my demo project is an AI Advent Challenge web chat. Reply with one short confirmation.",
  day8:
    "Explain why token usage grows in a long LLM conversation. Keep the answer practical.",
  day9:
    "Using the previous dialog context, explain the main user goal and next best action.",
  day10:
    "Remember that this branch is about comparing context management strategies.",
  day11:
    "Remember this project decision: the Day 11 assistant should keep UI text in English and hide low-level context strategies from users.",
  day12:
    "Explain how we should approach the next architecture decision in this assistant.",
};

async function runLlm(input: {
  prompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stop?: string;
  system?: string;
}) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload as LlmResult;
}

async function runAgent(input: {
  prompt: string;
  model?: string;
  system?: string;
}) {
  const response = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Agent request failed.");
  }
  return payload as LlmResult & { trace: AgentTrace[] };
}

async function loadMemoryHistory() {
  const response = await fetch("/api/agent/memory");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Failed to load memory history.");
  }
  return payload.history as ChatMessage[];
}

async function runMemoryAgent(input: {
  prompt: string;
  model?: string;
  system?: string;
}) {
  const response = await fetch("/api/agent/memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Memory agent request failed.");
  }
  return payload as LlmResult & {
    history: ChatMessage[];
    trace: AgentTrace[];
  };
}

async function loadTokenLab() {
  const response = await fetch("/api/agent/tokens");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Failed to load token dialogs.");
  }
  return payload as TokenLabState;
}

async function runTokenAction(input: {
  action:
    | "create_dialog"
    | "delete_dialog"
    | "send_message"
    | "set_active_dialog"
    | "rename_dialog";
  dialogId?: string;
  title?: string;
  prompt?: string;
  model?: string;
}) {
  const response = await fetch("/api/agent/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Token dialog action failed.");
  }
  return payload as TokenLabState;
}

async function loadCompressionLab() {
  const response = await fetch("/api/agent/compress");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Failed to load compression dialogs.");
  }
  return payload as TokenLabState;
}

async function runCompressionAction(input: {
  action:
    | "create_dialog"
    | "delete_dialog"
    | "send_message"
    | "set_active_dialog"
    | "rename_dialog";
  dialogId?: string;
  title?: string;
  prompt?: string;
  model?: string;
  recentMessages?: number;
}) {
  const response = await fetch("/api/agent/compress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Compression dialog action failed.");
  }
  return payload as TokenLabState;
}

async function loadStrategyLab() {
  const response = await fetch("/api/agent/strategy");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Failed to load strategy dialogs.");
  }
  return payload as TokenLabState;
}

async function runStrategyAction(input: {
  action:
    | "create_dialog"
    | "delete_dialog"
    | "send_message"
    | "set_active_dialog"
    | "rename_dialog"
    | "set_strategy"
    | "set_branch";
  dialogId?: string;
  title?: string;
  prompt?: string;
  model?: string;
  strategy?: "sliding_window" | "sticky_facts" | "branching";
  branch?: string;
  recentMessages?: number;
}) {
  const response = await fetch("/api/agent/strategy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Strategy dialog action failed.");
  }
  return payload as TokenLabState;
}

async function loadMemoryLayersLab() {
  const response = await fetch("/api/agent/memory-layers");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Failed to load memory layers.");
  }
  return payload as MemoryLayersState;
}

async function runMemoryLayersAction(input: {
  action:
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
  dialogId?: string;
  title?: string;
  prompt?: string;
  model?: string;
  memoryFolder?: string;
  fileSettings?: Partial<MemoryFileSettings>;
  profileId?: string;
  profileUpdateId?: string;
  profile?: Partial<UserProfile>;
}) {
  const response = await fetch("/api/agent/memory-layers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Memory layers action failed.");
  }
  return payload as MemoryLayersState & {
    events?: MemoryLayerEvent[];
    recentMessageCount?: number;
  };
}

function formatTokens(value: number | null) {
  return value === null ? "n/a" : value.toLocaleString("en-US");
}

function compactTokens(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  }
  return value.toLocaleString("en-US");
}

function getModelOption(modelId: string): ModelOption | null {
  for (const group of modelGroups) {
    const option = group.options.find((item) => item.value === modelId);
    if (option) {
      return option;
    }
  }
  return null;
}

function estimateUiTextTokens(text: string) {
  const compact = text.trim();
  const words = compact ? compact.split(/\s+/).length : 0;
  return Math.max(Math.ceil(compact.length / 4), Math.ceil(words * 1.35), compact ? 1 : 0);
}

function estimateUiMessageTokens(messages: ChatMessage[]) {
  const text = messages
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
  return estimateUiTextTokens(text) + messages.length * 4;
}

function formatCost(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }
  return `$${value.toFixed(6)}`;
}

export default function Home() {
  const [activeDay] = useState<DayKey>("day12");
  const [prompt, setPrompt] = useState(defaultPrompts.day12);
  const [model, setModel] = useState(defaultModel);
  const [formatInstruction, setFormatInstruction] = useState(
    "Return JSON with the fields summary, bullets, and final_marker.",
  );
  const [maxTokens, setMaxTokens] = useState("160");
  const [stopSequence, setStopSequence] = useState("END");
  const [temperatures, setTemperatures] = useState(["0", "0.7", "1.2"]);
  const [modelRows, setModelRows] = useState<ModelRow[]>([
    {
      label: "Weak",
      model:
        process.env.NEXT_PUBLIC_MODEL_WEAK ||
        "meta-llama/llama-3.2-1b-instruct",
    },
    {
      label: "Medium",
      model: process.env.NEXT_PUBLIC_MODEL_MEDIUM || "qwen/qwen3-32b",
    },
    {
      label: "Strong",
      model:
        process.env.NEXT_PUBLIC_MODEL_STRONG ||
        "qwen/qwen3-235b-a22b-thinking-2507",
    },
  ]);
  const [results, setResults] = useState<PanelResult[]>([]);
  const [memoryHistory, setMemoryHistory] = useState<ChatMessage[]>([]);
  const [tokenLab, setTokenLab] = useState<TokenLabState | null>(null);
  const [compressionLab, setCompressionLab] = useState<TokenLabState | null>(null);
  const [strategyLab, setStrategyLab] = useState<TokenLabState | null>(null);
  const [memoryLayersLab, setMemoryLayersLab] =
    useState<MemoryLayersState | null>(null);
  const [memoryLayerEvents, setMemoryLayerEvents] = useState<MemoryLayerEvent[]>([]);
  const [recentMessages, setRecentMessages] = useState("4");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const activeDayMeta = useMemo(
    () => days.find((day) => day.key === activeDay) ?? days[0],
    [activeDay],
  );

  useEffect(() => {
    if (activeDay !== "day7") {
      return;
    }

    let cancelled = false;
    loadMemoryHistory()
      .then((history) => {
        if (!cancelled) {
          setMemoryHistory(history);
        }
      })
      .catch((historyError) => {
        if (!cancelled) {
          setError(
            historyError instanceof Error
              ? historyError.message
              : "Failed to load memory history.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeDay]);

  useEffect(() => {
    if (activeDay !== "day8") {
      return;
    }

    let cancelled = false;
    loadTokenLab()
      .then((lab) => {
        if (!cancelled) {
          setTokenLab(lab);
        }
      })
      .catch((labError) => {
        if (!cancelled) {
          setError(
            labError instanceof Error
              ? labError.message
              : "Failed to load token dialogs.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeDay]);

  useEffect(() => {
    if (activeDay !== "day9") {
      return;
    }

    let cancelled = false;
    loadCompressionLab()
      .then((lab) => {
        if (!cancelled) {
          setCompressionLab(lab);
        }
      })
      .catch((labError) => {
        if (!cancelled) {
          setError(
            labError instanceof Error
              ? labError.message
              : "Failed to load compression dialogs.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeDay]);

  useEffect(() => {
    if (activeDay !== "day10") {
      return;
    }

    let cancelled = false;
    loadStrategyLab()
      .then((lab) => {
        if (!cancelled) {
          setStrategyLab(lab);
        }
      })
      .catch((labError) => {
        if (!cancelled) {
          setError(
            labError instanceof Error
              ? labError.message
              : "Failed to load strategy dialogs.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeDay]);

  useEffect(() => {
    if (activeDay !== "day11" && activeDay !== "day12") {
      return;
    }

    let cancelled = false;
    loadMemoryLayersLab()
      .then((lab) => {
        if (!cancelled) {
          setMemoryLayersLab(lab);
        }
      })
      .catch((labError) => {
        if (!cancelled) {
          setError(
            labError instanceof Error
              ? labError.message
              : "Failed to load memory layers.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeDay]);

  const activeTokenDialog = useMemo(() => {
    if (!tokenLab) {
      return null;
    }
    return (
      tokenLab.dialogs.find(
        (dialog) => dialog.id === tokenLab.activeDialogId,
      ) ?? tokenLab.dialogs[0]
    );
  }, [tokenLab]);

  const activeCompressionDialog = useMemo(() => {
    if (!compressionLab) {
      return null;
    }
    return (
      compressionLab.dialogs.find(
        (dialog) => dialog.id === compressionLab.activeDialogId,
      ) ?? compressionLab.dialogs[0]
    );
  }, [compressionLab]);

  const activeStrategyDialog = useMemo(() => {
    if (!strategyLab) {
      return null;
    }
    return (
      strategyLab.dialogs.find(
        (dialog) => dialog.id === strategyLab.activeDialogId,
      ) ?? strategyLab.dialogs[0]
    );
  }, [strategyLab]);

  const activeMemoryLayersDialog = useMemo(() => {
    if (!memoryLayersLab) {
      return null;
    }
    return (
      memoryLayersLab.dialogs.find(
        (dialog) => dialog.id === memoryLayersLab.activeDialogId,
      ) ?? memoryLayersLab.dialogs[0]
    );
  }, [memoryLayersLab]);

  async function updateTokenLab(
    action: Parameters<typeof runTokenAction>[0],
  ) {
    setLoading(true);
    setError("");
    try {
      const nextLab = await runTokenAction(action);
      setTokenLab(nextLab);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unexpected token dialog error.",
      );
    } finally {
      setLoading(false);
    }
  }

  function createTokenDialog() {
    void updateTokenLab({ action: "create_dialog" });
  }

  function setActiveTokenDialog(dialogId: string) {
    void updateTokenLab({ action: "set_active_dialog", dialogId });
  }

  function deleteTokenDialog(dialog: TokenDialog) {
    const confirmed = window.confirm(`Delete ${dialog.title}?`);
    if (!confirmed) {
      return;
    }
    void updateTokenLab({ action: "delete_dialog", dialogId: dialog.id });
  }

  function renameTokenDialog(dialog: TokenDialog) {
    const title = window.prompt("Rename dialog", dialog.title)?.trim();
    if (!title || title === dialog.title) {
      return;
    }
    void updateTokenLab({
      action: "rename_dialog",
      dialogId: dialog.id,
      title,
    });
  }

  async function updateCompressionLab(
    action: Parameters<typeof runCompressionAction>[0],
  ) {
    setLoading(true);
    setError("");
    try {
      const nextLab = await runCompressionAction(action);
      setCompressionLab(nextLab);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unexpected compression dialog error.",
      );
    } finally {
      setLoading(false);
    }
  }

  function createCompressionDialog() {
    void updateCompressionLab({ action: "create_dialog" });
  }

  function setActiveCompressionDialog(dialogId: string) {
    void updateCompressionLab({ action: "set_active_dialog", dialogId });
  }

  function deleteCompressionDialog(dialog: TokenDialog) {
    const confirmed = window.confirm(`Delete ${dialog.title}?`);
    if (!confirmed) {
      return;
    }
    void updateCompressionLab({ action: "delete_dialog", dialogId: dialog.id });
  }

  function renameCompressionDialog(dialog: TokenDialog) {
    const title = window.prompt("Rename dialog", dialog.title)?.trim();
    if (!title || title === dialog.title) {
      return;
    }
    void updateCompressionLab({
      action: "rename_dialog",
      dialogId: dialog.id,
      title,
    });
  }

  async function sendCompressionMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const nextLab = await runCompressionAction({
        action: "send_message",
        prompt,
        model: model || undefined,
        recentMessages: Number(recentMessages) || undefined,
      });
      setCompressionLab(nextLab);
      setPrompt("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unexpected compression dialog error.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function updateStrategyLab(
    action: Parameters<typeof runStrategyAction>[0],
  ) {
    setLoading(true);
    setError("");
    try {
      const nextLab = await runStrategyAction(action);
      setStrategyLab(nextLab);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unexpected strategy dialog error.",
      );
    } finally {
      setLoading(false);
    }
  }

  function createStrategyDialog() {
    void updateStrategyLab({ action: "create_dialog" });
  }

  function setActiveStrategyDialog(dialogId: string) {
    void updateStrategyLab({ action: "set_active_dialog", dialogId });
  }

  function deleteStrategyDialog(dialog: TokenDialog) {
    const confirmed = window.confirm(`Delete ${dialog.title}?`);
    if (!confirmed) {
      return;
    }
    void updateStrategyLab({ action: "delete_dialog", dialogId: dialog.id });
  }

  function renameStrategyDialog(dialog: TokenDialog) {
    const title = window.prompt("Rename dialog", dialog.title)?.trim();
    if (!title || title === dialog.title) {
      return;
    }
    void updateStrategyLab({
      action: "rename_dialog",
      dialogId: dialog.id,
      title,
    });
  }

  function setStrategy(strategy: "sliding_window" | "sticky_facts" | "branching") {
    void updateStrategyLab({ action: "set_strategy", strategy });
  }

  function setBranch(branch: string) {
    void updateStrategyLab({ action: "set_branch", branch });
  }

  async function sendStrategyMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const nextLab = await runStrategyAction({
        action: "send_message",
        prompt,
        model: model || undefined,
        recentMessages: Number(recentMessages) || undefined,
        strategy: activeStrategyDialog?.strategy ?? "sliding_window",
        branch: activeStrategyDialog?.branch ?? "main",
      });
      setStrategyLab(nextLab);
      setPrompt("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unexpected strategy dialog error.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function updateMemoryLayersLab(
    action: Parameters<typeof runMemoryLayersAction>[0],
  ) {
    setLoading(true);
    setError("");
    try {
      const nextLab = await runMemoryLayersAction(action);
      setMemoryLayersLab(nextLab);
      if (nextLab.events) {
        setMemoryLayerEvents(nextLab.events);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unexpected memory layers error.",
      );
    } finally {
      setLoading(false);
    }
  }

  function createMemoryLayersDialog() {
    void updateMemoryLayersLab({ action: "create_dialog" });
  }

  function setActiveMemoryLayersDialog(dialogId: string) {
    void updateMemoryLayersLab({ action: "set_active_dialog", dialogId });
  }

  function deleteMemoryLayersDialog(dialog: MemoryDialog) {
    const confirmed = window.confirm(`Delete ${dialog.title}?`);
    if (!confirmed) {
      return;
    }
    void updateMemoryLayersLab({ action: "delete_dialog", dialogId: dialog.id });
  }

  function renameMemoryLayersDialog(dialog: MemoryDialog) {
    const title = window.prompt("Rename dialog", dialog.title)?.trim();
    if (!title || title === dialog.title) {
      return;
    }
    void updateMemoryLayersLab({
      action: "rename_dialog",
      dialogId: dialog.id,
      title,
    });
  }

  function moveMemoryFolder(memoryFolder: string) {
    void updateMemoryLayersLab({
      action: "move_memory_folder",
      memoryFolder,
    });
  }

  function setActiveProfile(profileId: string) {
    void updateMemoryLayersLab({
      action: "set_active_profile",
      profileId,
    });
  }

  function createUserProfile(name: string) {
    void updateMemoryLayersLab({
      action: "create_profile",
      title: name,
    });
  }

  function renameUserProfile(profileId: string, name: string) {
    void updateMemoryLayersLab({
      action: "rename_profile",
      profileId,
      title: name,
    });
  }

  function deleteUserProfile(profileId: string) {
    void updateMemoryLayersLab({
      action: "delete_profile",
      profileId,
    });
  }

  function updateUserProfile(profile: Partial<UserProfile> & { id: string }) {
    void updateMemoryLayersLab({
      action: "update_profile",
      profile,
    });
  }

  function applyProfileUpdate(profileUpdateId: string) {
    void updateMemoryLayersLab({
      action: "apply_profile_update",
      profileUpdateId,
    });
  }

  function dismissProfileUpdate(profileUpdateId: string) {
    void updateMemoryLayersLab({
      action: "dismiss_profile_update",
      profileUpdateId,
    });
  }

  function applyAllProfileUpdates(profileId: string) {
    void updateMemoryLayersLab({ action: "apply_all_profile_updates", profileId });
  }

  function dismissAllProfileUpdates(profileId: string) {
    void updateMemoryLayersLab({ action: "dismiss_all_profile_updates", profileId });
  }

  async function sendMemoryLayersMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const nextLab = await runMemoryLayersAction({
        action: "send_message",
        prompt,
        model: model || undefined,
      });
      setMemoryLayersLab(nextLab);
      setMemoryLayerEvents(nextLab.events ?? []);
      setPrompt("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unexpected memory layers error.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function sendTokenMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const nextLab = await runTokenAction({
        action: "send_message",
        prompt,
        model: model || undefined,
      });
      setTokenLab(nextLab);
      setPrompt("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unexpected token dialog error.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function runDay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      activeDay === "day8" ||
      activeDay === "day9" ||
      activeDay === "day10" ||
      activeDay === "day11" ||
      activeDay === "day12"
    ) {
      return;
    }
    setLoading(true);
    setError("");
    setResults([]);
    setTokenLab(null);
    setCompressionLab(null);
    setStrategyLab(null);
    setMemoryLayersLab(null);

    try {
      if (activeDay === "day1") {
        const result = await runLlm({
          prompt,
          model: model || undefined,
        });
        setResults([{ title: "API response", ...result }]);
      }

      if (activeDay === "day2") {
        const controlledPrompt = `${prompt}

Response requirements:
${formatInstruction}
Limit the answer to about ${maxTokens || "160"} tokens.
Finish the answer with the line ${stopSequence || "END"}.`;
        const [baseline, controlled] = await Promise.all([
          runLlm({
            prompt,
            model: model || undefined,
          }),
          runLlm({
            prompt: controlledPrompt,
            model: model || undefined,
            maxTokens: Number(maxTokens) || undefined,
            stop: stopSequence || undefined,
          }),
        ]);
        setResults([
          { title: "Baseline", ...baseline },
          { title: "Controlled format", ...controlled },
        ]);
      }

      if (activeDay === "day3") {
        const directPrompt = prompt;
        const stepPrompt = `${prompt}\n\nSolve step by step. End with a short final answer.`;
        const metaPromptRequest = `Create a strong prompt for solving this task with an LLM. Return only the ready-to-use prompt:\n\n${prompt}`;
        const expertsPrompt = `${prompt}

Solve the task as a group of experts:
1. The analyst explains the solution path.
2. The engineer checks practical correctness.
3. The critic looks for mistakes.
4. The moderator gives the final answer.`;

        const [direct, step, metaPrompt, experts] = await Promise.all([
          runLlm({
            prompt: directPrompt,
            model: model || undefined,
          }),
          runLlm({
            prompt: stepPrompt,
            model: model || undefined,
          }),
          runLlm({
            prompt: metaPromptRequest,
            model: model || undefined,
          }),
          runLlm({
            prompt: expertsPrompt,
            model: model || undefined,
          }),
        ]);

        const generated = await runLlm({
          prompt: metaPrompt.answer,
          model: model || undefined,
        });

        setResults([
          { title: "Direct answer", ...direct },
          { title: "Step-by-step", ...step },
          {
            title: "Model-generated prompt",
            note: metaPrompt.answer,
            ...generated,
          },
          { title: "Expert group", ...experts },
        ]);
      }

      if (activeDay === "day4") {
        const parsedTemperatures = temperatures.map((value) => {
          const parsed = Number(value.replace(",", "."));
          return Number.isFinite(parsed) ? parsed : 0;
        });
        const temperatureResults = await Promise.all(
          parsedTemperatures.map((temperature) =>
            runLlm({
              prompt,
              model: model || undefined,
              temperature,
            }),
          ),
        );
        setResults(
          temperatureResults.map((result, index) => ({
            title: `temperature = ${parsedTemperatures[index]}`,
            ...result,
          })),
        );
      }

      if (activeDay === "day5") {
        const day5Results = await Promise.all(
          modelRows.map(async (row) => {
            const result = await runLlm({
              prompt,
              model: row.model,
            });
            return {
              title: row.label,
              ...result,
            };
          }),
        );
        setResults(day5Results);
      }

      if (activeDay === "day6") {
        const result = await runAgent({
          prompt,
          model: model || undefined,
        });
        setResults([{ title: "SimpleAgent response", ...result }]);
      }

      if (activeDay === "day7") {
        const result = await runMemoryAgent({
          prompt,
          model: model || undefined,
        });
        setMemoryHistory(result.history);
        setResults([{ title: "MemoryAgent response", ...result }]);
      }

    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unexpected request error.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">AI Advent Challenge</p>
          <h1>Memory Layer Assistant</h1>
        </div>
        <div className="status">OpenAI-compatible API</div>
      </section>

      <section className="workspace current-workspace">
        {activeDay !== "day8" &&
          activeDay !== "day9" &&
          activeDay !== "day10" &&
        activeDay !== "day11" &&
          activeDay !== "day12" && (
        <form className="controls" onSubmit={runDay}>
          <div>
            <p className="eyebrow">Task</p>
            <h2>{activeDayMeta.title}</h2>
          </div>

          <label>
            Prompt
            <textarea
              onChange={(event) => setPrompt(event.target.value)}
              rows={7}
              value={prompt}
            />
          </label>

          <label>
            Model
            <select
              onChange={(event) => setModel(event.target.value)}
              value={model}
            >
              {modelGroups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} - {option.value}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {activeDay === "day2" && (
            <div className="control-grid">
              <label>
                Response format
                <textarea
                  onChange={(event) => setFormatInstruction(event.target.value)}
                  rows={3}
                  value={formatInstruction}
                />
              </label>
              <label>
                Max tokens
                <input
                  inputMode="numeric"
                  onChange={(event) => setMaxTokens(event.target.value)}
                  value={maxTokens}
                />
              </label>
              <label>
                Stop sequence
                <input
                  onChange={(event) => setStopSequence(event.target.value)}
                  value={stopSequence}
                />
              </label>
            </div>
          )}

          {activeDay === "day4" && (
            <div className="control-grid">
              {temperatures.map((temperature, index) => (
                <label key={index}>
                  Temperature {index + 1}
                  <input
                    inputMode="decimal"
                    onChange={(event) => {
                      const next = [...temperatures];
                      next[index] = event.target.value;
                      setTemperatures(next);
                    }}
                    value={temperature}
                  />
                </label>
              ))}
            </div>
          )}

          {activeDay === "day5" && (
            <div className="models">
              {modelRows.map((row, index) => (
                <div className="model-row" key={row.label}>
                  <strong>{row.label}</strong>
                  <select
                    onChange={(event) => {
                      const next = [...modelRows];
                      next[index] = {
                        ...next[index],
                        model: event.target.value,
                      };
                      setModelRows(next);
                    }}
                    value={row.model}
                  >
                    {(modelGroups[index]?.options ?? []).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} - {option.value}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          <button className="run" disabled={loading} type="submit">
            {loading ? "Running..." : "Run task"}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
        )}

        <section className="results">
          {(activeDay === "day8" ||
            activeDay === "day9" ||
            activeDay === "day10" ||
            activeDay === "day11" ||
            activeDay === "day12") && error && (
            <p className="error">{error}</p>
          )}
          {activeDay === "day8" && tokenLab && (
            <TokenLabView
              activeDialog={activeTokenDialog}
              lab={tokenLab}
              loading={loading}
              model={model}
              onCreate={createTokenDialog}
              onDelete={deleteTokenDialog}
              onModelChange={setModel}
              onRename={renameTokenDialog}
              onSelect={setActiveTokenDialog}
              onSend={sendTokenMessage}
              prompt={prompt}
              setPrompt={setPrompt}
            />
          )}
          {activeDay === "day9" && compressionLab && (
            <TokenLabView
              activeDialog={activeCompressionDialog}
              lab={compressionLab}
              loading={loading}
              model={model}
              mode="compression"
              onCreate={createCompressionDialog}
              onDelete={deleteCompressionDialog}
              onModelChange={setModel}
              onRename={renameCompressionDialog}
              onSelect={setActiveCompressionDialog}
              onSend={sendCompressionMessage}
              prompt={prompt}
              recentMessages={recentMessages}
              setPrompt={setPrompt}
              setRecentMessages={setRecentMessages}
            />
          )}
          {activeDay === "day10" && strategyLab && (
            <TokenLabView
              activeDialog={activeStrategyDialog}
              lab={strategyLab}
              loading={loading}
              model={model}
              mode="strategy"
              onBranchChange={setBranch}
              onCreate={createStrategyDialog}
              onDelete={deleteStrategyDialog}
              onModelChange={setModel}
              onRename={renameStrategyDialog}
              onSelect={setActiveStrategyDialog}
              onSend={sendStrategyMessage}
              onStrategyChange={setStrategy}
              prompt={prompt}
              recentMessages={recentMessages}
              setPrompt={setPrompt}
              setRecentMessages={setRecentMessages}
            />
          )}
          {(activeDay === "day11" || activeDay === "day12") && memoryLayersLab && (
            <MemoryLayersView
              activeDialog={activeMemoryLayersDialog}
              events={memoryLayerEvents}
              lab={memoryLayersLab}
              loading={loading}
              model={model}
              onCreate={createMemoryLayersDialog}
              onDelete={deleteMemoryLayersDialog}
              onModelChange={setModel}
              onRename={renameMemoryLayersDialog}
              onSelect={setActiveMemoryLayersDialog}
              onSend={sendMemoryLayersMessage}
              onMemoryFolderMove={moveMemoryFolder}
              onProfileApplySuggestion={applyProfileUpdate}
              onProfileApplySuggestions={applyAllProfileUpdates}
              onProfileCreate={createUserProfile}
              onProfileDelete={deleteUserProfile}
              onProfileDismissSuggestion={dismissProfileUpdate}
              onProfileDismissSuggestions={dismissAllProfileUpdates}
              onProfileRename={renameUserProfile}
              onProfileSelect={setActiveProfile}
              onProfileUpdate={updateUserProfile}
              prompt={prompt}
              setPrompt={setPrompt}
            />
          )}

          {results.length === 0 &&
            !loading &&
            activeDay !== "day8" &&
            activeDay !== "day9" &&
            activeDay !== "day10" &&
            activeDay !== "day11" &&
            activeDay !== "day12" && (
            <div className="empty">
              Select a day, review the prompt, and run the request. Answers and
              metrics will appear here.
            </div>
          )}
          {loading && <div className="empty">Request is running...</div>}

          {activeDay === "day5" && results.length > 0 ? (
            <DayFiveTable results={results} />
          ) : activeDay === "day8" ||
            activeDay === "day9" ||
            activeDay === "day10" ||
            activeDay === "day11" ||
            activeDay === "day12" ? null : (
            <div className="result-grid">
              {results.map((result) => (
                <ResultCard key={result.title} result={result} />
              ))}
            </div>
          )}

          {activeDay === "day7" && memoryHistory.length > 0 && (
            <ConversationHistory messages={memoryHistory} />
          )}
        </section>
      </section>
    </main>
  );
}

function hasCompleteCostData(rows: TokenMetricRow[]) {
  const sentRows = rows.filter((row) => row.status === "sent");
  return (
    sentRows.length > 0 &&
    sentRows.every((row) => row.providerCost !== null)
  );
}

function graphPoints(
  rows: TokenMetricRow[],
  xKey: "requestTokens" | "contextTokens" | "responseTokens",
) {
  return rows
    .filter(
      (row) =>
        row.status === "sent" &&
        row.providerCost !== null &&
        row[xKey] !== null,
    )
    .map((row) => ({
      label: `Turn ${row.turn}`,
      turn: row.turn,
      x: Number(row[xKey]),
      y: row.providerCost ?? 0,
    }))
    .sort((left, right) => left.x - right.x || left.turn - right.turn);
}

function CostGraph({
  title,
  rows,
  xKey,
}: {
  title: string;
  rows: TokenMetricRow[];
  xKey: "requestTokens" | "contextTokens" | "responseTokens";
}) {
  const points = graphPoints(rows, xKey);
  const width = 400;
  const height = 230;
  const padding = 46;
  const maxX = Math.max(...points.map((point) => point.x), 1);
  const maxY = Math.max(...points.map((point) => point.y), 0.000001);
  const coords = points.map((point) => ({
    ...point,
    cx: padding + (point.x / maxX) * (width - padding * 2),
    cy: height - padding - (point.y / maxY) * (height - padding * 2),
  }));
  const path = coords
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.cx} ${point.cy}`)
    .join(" ");

  return (
    <article className="cost-graph">
      <h3>{title}</h3>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        <text className="axis-label" x={width / 2} y={height - 6} textAnchor="middle">
          tokens
        </text>
        <text
          className="axis-label"
          textAnchor="middle"
          transform={`translate(14 ${height / 2}) rotate(-90)`}
        >
          cost, USD
        </text>
        <line
          className="axis"
          x1={padding}
          x2={padding}
          y1={padding}
          y2={height - padding}
        />
        <line
          className="axis"
          x1={padding}
          x2={width - padding}
          y1={height - padding}
          y2={height - padding}
        />
        <text className="tick-label" x={padding} y={height - padding + 16} textAnchor="middle">
          0
        </text>
        <text className="tick-label" x={width - padding} y={height - padding + 16} textAnchor="middle">
          {formatTokens(maxX)}
        </text>
        <text className="tick-label" x={padding - 7} y={height - padding + 4} textAnchor="end">
          $0
        </text>
        <text className="tick-label" x={padding - 7} y={padding + 4} textAnchor="end">
          {formatCost(maxY)}
        </text>
        {path && <path className="graph-line" d={path} />}
        {coords.map((point) => (
          <circle className="graph-dot" cx={point.cx} cy={point.cy} key={`${point.label}-${point.x}`} r="4">
            <title>{`${point.label}: ${point.x} tokens, ${formatCost(point.y)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="graph-scale">
        <span>x max {formatTokens(maxX)}</span>
        <span>y max {formatCost(maxY)}</span>
      </div>
    </article>
  );
}

function MemoryLayerPanel({
  title,
  description,
  notes,
  filePath,
}: {
  title: string;
  description: string;
  notes: MemoryLayerNote[];
  filePath: string;
}) {
  return (
    <article className="memory-layer-card">
      <div className="memory-layer-head">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <div className="memory-file-path">
          <span>File</span>
          <code>{filePath}</code>
        </div>
      </div>
      {notes.length === 0 ? (
        <div className="memory-empty">No saved items yet.</div>
      ) : (
        <ul className="memory-note-list">
          {notes.map((note) => (
            <li key={note.id}>
              <span>{note.text}</span>
              <small>{note.source}</small>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function MemoryFileSettingsForm({
  filePaths,
  initialSettings,
  loading,
  onSubmit,
}: {
  filePaths: MemoryFilePaths;
  initialSettings: MemoryFileSettings;
  loading: boolean;
  onSubmit: (memoryFolder: string) => void;
}) {
  const [draftFolder, setDraftFolder] = useState(initialSettings.memoryFolder);

  return (
    <section className="settings-page">
      <div className="settings-page-head">
        <h3>Memory location</h3>
        <p>Move the assistant memory files to another server-visible folder.</p>
      </div>
      <div className="memory-file-grid compact-settings">
        <label className="memory-folder-field">
          Memory folder
          <input
            onChange={(event) => setDraftFolder(event.target.value)}
            value={draftFolder}
          />
        </label>
        <button
          className="run memory-file-apply"
          disabled={loading}
          onClick={() => onSubmit(draftFolder)}
          type="button"
        >
          Move memory
        </button>
      </div>
      <div className="memory-path-list">
        <span>Short-term: {filePaths.shortTerm}</span>
        <span>Working: {filePaths.working}</span>
        <span>Long-term: {filePaths.longTerm}</span>
        <span>Profiles: {filePaths.userProfiles}</span>
      </div>
      <p className="settings-note">
        File names are fixed. The move is blocked if a target memory file already exists.
      </p>
    </section>
  );
}

type SettingsSection = "profile" | "location" | "memory" | "metrics" | "context";

function activeProfileFrom(lab: MemoryLayersState) {
  return (
    lab.userProfiles.find((profile) => profile.id === lab.activeProfileId) ??
    lab.userProfiles[0]
  );
}

function AssistantSettingsModal({
  lab,
  loading,
  onClose,
  onMemoryFolderMove,
  onProfileApplySuggestion,
  onProfileApplySuggestions,
  onProfileCreate,
  onProfileDelete,
  onProfileDismissSuggestion,
  onProfileDismissSuggestions,
  onProfileRename,
  onProfileSelect,
  onProfileUpdate,
}: {
  lab: MemoryLayersState;
  loading: boolean;
  onClose: () => void;
  onMemoryFolderMove: (memoryFolder: string) => void;
  onProfileApplySuggestion: (profileUpdateId: string) => void;
  onProfileApplySuggestions: (profileId: string) => void;
  onProfileCreate: (name: string) => void;
  onProfileDelete: (profileId: string) => void;
  onProfileDismissSuggestion: (profileUpdateId: string) => void;
  onProfileDismissSuggestions: (profileId: string) => void;
  onProfileRename: (profileId: string, name: string) => void;
  onProfileSelect: (profileId: string) => void;
  onProfileUpdate: (profile: Partial<UserProfile> & { id: string }) => void;
}) {
  const [section, setSection] = useState<SettingsSection>("profile");
  const activeProfile = activeProfileFrom(lab);
  const sections: Array<{ id: SettingsSection; label: string }> = [
    { id: "profile", label: "Profile" },
    { id: "location", label: "Memory location" },
    { id: "memory", label: "Saved memory" },
    { id: "metrics", label: "Metrics" },
    { id: "context", label: "Request context" },
  ];

  return (
    <div className="settings-overlay" role="presentation">
      <section
        aria-label="Assistant settings"
        aria-modal="true"
        className="settings-modal"
        role="dialog"
      >
        <aside className="settings-nav">
          <div>
            <p className="eyebrow">Settings</p>
            <h2>Assistant</h2>
          </div>
          <nav aria-label="Settings sections">
            {sections.map((item) => (
              <button
                className={section === item.id ? "active" : ""}
                key={item.id}
                onClick={() => setSection(item.id)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>
        <div className="settings-content">
          <button
            aria-label="Close settings"
            className="settings-close"
            onClick={onClose}
            type="button"
          >
            x
          </button>
          {section === "profile" && (
            <ProfileSettingsPage
              activeProfile={activeProfile}
              key={`${activeProfile?.id ?? "no-profile"}-${activeProfile?.updatedAt ?? "no-update"}`}
              loading={loading}
              onProfileApplySuggestion={onProfileApplySuggestion}
              onProfileApplySuggestions={onProfileApplySuggestions}
              onProfileCreate={onProfileCreate}
              onProfileDelete={onProfileDelete}
              onProfileDismissSuggestion={onProfileDismissSuggestion}
              onProfileDismissSuggestions={onProfileDismissSuggestions}
              onProfileRename={onProfileRename}
              onProfileSelect={onProfileSelect}
              onProfileUpdate={onProfileUpdate}
              pendingProfileUpdates={lab.pendingProfileUpdates}
              profiles={lab.userProfiles}
            />
          )}
          {section === "location" && (
            <MemoryFileSettingsForm
              filePaths={lab.filePaths}
              initialSettings={lab.fileSettings}
              key={lab.fileSettings.memoryFolder}
              loading={loading}
              onSubmit={onMemoryFolderMove}
            />
          )}
          {section === "memory" && (
            <SavedMemorySettingsPage lab={lab} />
          )}
          {section === "metrics" && (
            <MetricsSettingsPage totals={lab.globalMetrics} />
          )}
          {section === "context" && (
            <RequestContextSettingsPage context={lab.lastRequestContext} />
          )}
        </div>
      </section>
    </div>
  );
}

function ProfileSettingsPage({
  activeProfile,
  loading,
  onProfileApplySuggestion,
  onProfileApplySuggestions,
  onProfileCreate,
  onProfileDelete,
  onProfileDismissSuggestion,
  onProfileDismissSuggestions,
  onProfileRename,
  onProfileSelect,
  onProfileUpdate,
  pendingProfileUpdates,
  profiles,
}: {
  activeProfile: UserProfile | undefined;
  loading: boolean;
  onProfileApplySuggestion: (profileUpdateId: string) => void;
  onProfileApplySuggestions: (profileId: string) => void;
  onProfileCreate: (name: string) => void;
  onProfileDelete: (profileId: string) => void;
  onProfileDismissSuggestion: (profileUpdateId: string) => void;
  onProfileDismissSuggestions: (profileId: string) => void;
  onProfileRename: (profileId: string, name: string) => void;
  onProfileSelect: (profileId: string) => void;
  onProfileUpdate: (profile: Partial<UserProfile> & { id: string }) => void;
  pendingProfileUpdates: PendingProfileUpdate[];
  profiles: UserProfile[];
}) {
  const [draft, setDraft] = useState<UserProfile | undefined>(activeProfile);

  if (!draft) {
    return <div className="empty">No profiles are available.</div>;
  }
  const currentProfile = draft;
  const activeSuggestions = pendingProfileUpdates.filter(
    (update) => update.profileId === currentProfile.id,
  );

  function updateField<K extends keyof UserProfile>(
    key: K,
    value: UserProfile[K],
  ) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function createProfile() {
    const name = window.prompt("New profile name")?.trim();
    if (!name) {
      return;
    }
    onProfileCreate(name);
  }

  function renameProfile() {
    const name = window.prompt("Rename profile", currentProfile.name)?.trim();
    if (!name || name === currentProfile.name) {
      return;
    }
    onProfileRename(currentProfile.id, name);
  }

  function deleteProfile() {
    const confirmed = window.confirm(`Delete ${currentProfile.name}?`);
    if (!confirmed) {
      return;
    }
    onProfileDelete(currentProfile.id);
  }

  return (
    <section className="settings-page profile-settings">
      <div className="settings-page-head">
        <h3>User profile</h3>
        <p>Personalization is applied to every assistant request.</p>
      </div>
      <label>
        Active profile
        <select
          onChange={(event) => onProfileSelect(event.target.value)}
          value={currentProfile.id}
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>
      <div className="profile-toolbar">
        <div>
          <span>Selected profile</span>
          <strong>{currentProfile.name}</strong>
        </div>
        <button
          className="secondary-action"
          disabled={loading}
          onClick={createProfile}
          type="button"
        >
          New
        </button>
        <button
          className="secondary-action"
          disabled={loading}
          onClick={renameProfile}
          type="button"
        >
          Rename
        </button>
        <button
          className="danger-action"
          disabled={loading}
          onClick={deleteProfile}
          type="button"
        >
          Delete
        </button>
      </div>
      <label>
        Role / context
        <textarea
          onChange={(event) => updateField("roleContext", event.target.value)}
          rows={3}
          value={currentProfile.roleContext}
        />
      </label>
      <label>
        Style
        <textarea
          onChange={(event) => updateField("style", event.target.value)}
          rows={3}
          value={currentProfile.style}
        />
      </label>
      <label>
        Format
        <textarea
          onChange={(event) => updateField("format", event.target.value)}
          rows={3}
          value={currentProfile.format}
        />
      </label>
      <label>
        Constraints
        <textarea
          onChange={(event) => updateField("constraints", event.target.value)}
          rows={3}
          value={currentProfile.constraints}
        />
      </label>
      <div className="settings-actions">
        <button
          className="run"
          disabled={loading}
          onClick={() =>
            onProfileUpdate({
              id: currentProfile.id,
              roleContext: currentProfile.roleContext,
              style: currentProfile.style,
              format: currentProfile.format,
              constraints: currentProfile.constraints,
            })
          }
          type="button"
        >
          Save preferences
        </button>
      </div>
      <section className="profile-suggestions">
        <div className="settings-page-head">
          <h3>Suggested profile updates</h3>
          <p>Explicit preferences found in the chat wait here until you apply them.</p>
        </div>
        {activeSuggestions.length === 0 ? (
          <div className="memory-empty">No suggested profile updates yet.</div>
        ) : (
          <>
            <div className="settings-actions">
              <button
                className="secondary-action"
                disabled={loading}
                onClick={() => onProfileApplySuggestions(currentProfile.id)}
                type="button"
              >
                Apply all
              </button>
              <button
                className="secondary-action"
                disabled={loading}
                onClick={() => onProfileDismissSuggestions(currentProfile.id)}
                type="button"
              >
                Dismiss all
              </button>
            </div>
            <div className="profile-suggestion-list">
              {activeSuggestions.map((suggestion) => (
                <article className="profile-suggestion" key={suggestion.id}>
                  <div>
                    <span>{profileFieldLabel(suggestion.field)}</span>
                    <strong>{suggestion.value}</strong>
                  </div>
                  <p>{suggestion.reason || "Explicit user preference."}</p>
                  <blockquote>{suggestion.sourceText}</blockquote>
                  <small>
                    Confidence {Math.round(suggestion.confidence * 100)}%
                  </small>
                  <div className="settings-actions">
                    <button
                      className="run"
                      disabled={loading}
                      onClick={() => onProfileApplySuggestion(suggestion.id)}
                      type="button"
                    >
                      Apply
                    </button>
                    <button
                      className="secondary-action"
                      disabled={loading}
                      onClick={() => onProfileDismissSuggestion(suggestion.id)}
                      type="button"
                    >
                      Dismiss
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </section>
  );
}

function profileFieldLabel(field: UserProfileField) {
  if (field === "roleContext") {
    return "Role / context";
  }
  if (field === "style") {
    return "Style";
  }
  if (field === "format") {
    return "Format";
  }
  return "Constraints";
}

function SavedMemorySettingsPage({
  lab,
}: {
  lab: MemoryLayersState;
}) {
  return (
    <section className="settings-page">
      <div className="settings-page-head">
        <h3>Saved memory</h3>
        <p>Review what the assistant currently uses from each memory layer.</p>
      </div>
      <div className="memory-layer-grid settings-memory-grid">
        <MemoryLayerPanel
          description="Current task facts, project decisions, and active work context."
          filePath={lab.filePaths.working}
          notes={lab.workingMemory}
          title="Working memory"
        />
        <MemoryLayerPanel
          description="Stable user preferences, reusable facts, and global knowledge."
          filePath={lab.filePaths.longTerm}
          notes={lab.longTermMemory}
          title="Long-term memory"
        />
      </div>
    </section>
  );
}

function MetricsSettingsPage({
  totals,
}: {
  totals: MemoryMetricTotals;
}) {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Turns", value: totals.turns.toLocaleString("en-US") },
    { label: "Request tokens", value: formatTokens(totals.requestTokens) },
    { label: "Context tokens", value: formatTokens(totals.contextTokens) },
    { label: "Response tokens", value: formatTokens(totals.responseTokens) },
    { label: "Total tokens", value: formatTokens(totals.totalTokens) },
    { label: "Elapsed time", value: `${totals.elapsedMs.toLocaleString("en-US")} ms` },
    {
      label: "Provider cost",
      value: totals.hasProviderCost ? formatCost(totals.providerCost) : "n/a",
    },
  ];

  return (
    <section className="settings-page">
      <div className="settings-page-head">
        <h3>Metrics</h3>
        <p>Global totals for this memory store, including deleted dialogs.</p>
      </div>
      <div className="metrics-total-grid">
        {rows.map((row) => (
          <article className="metric-total-card" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

function RequestContextSettingsPage({
  context,
}: {
  context: RequestContextDebug | null;
}) {
  if (!context) {
    return (
      <section className="settings-page">
        <div className="settings-page-head">
          <h3>Request context</h3>
          <p>Send a message to inspect the exact context payload assembled for the model.</p>
        </div>
        <div className="empty">No request context has been captured yet.</div>
      </section>
    );
  }

  return (
    <section className="settings-page request-context-page">
      <div className="settings-page-head">
        <h3>Request context</h3>
        <p>
          Payload/context sent to the LLM. Captured at{" "}
          {new Date(context.createdAt).toLocaleString("en-US")}.
        </p>
      </div>
      <RequestContextBlock
        title="Active profile"
        value={[
          `Name: ${context.profile.name}`,
          `Role/context: ${context.profile.roleContext || "- empty"}`,
          `Style: ${context.profile.style || "- empty"}`,
          `Format: ${context.profile.format || "- empty"}`,
          `Constraints: ${context.profile.constraints || "- empty"}`,
        ].join("\n")}
      />
      <RequestContextBlock
        title="Selected branch summary"
        value={[
          `Branch: ${context.selectedBranchTitle}`,
          context.selectedBranchSummary || "- empty",
        ].join("\n")}
      />
      <RequestContextBlock
        title="Recent selected-branch messages"
        value={formatDebugMessages(context.recentMessages)}
      />
      <RequestContextBlock
        title="Working memory"
        value={formatDebugNotes(context.workingMemory)}
      />
      <RequestContextBlock
        title="Long-term memory"
        value={formatDebugNotes(context.longTermMemory)}
      />
      <RequestContextBlock
        title="Full assembled messages"
        value={formatDebugMessages(context.assembledMessages)}
      />
    </section>
  );
}

function RequestContextBlock({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <article className="request-context-block">
      <h4>{title}</h4>
      <pre>{value || "- empty"}</pre>
    </article>
  );
}

function formatDebugMessages(messages: ChatMessage[]) {
  if (!messages.length) {
    return "- empty";
  }

  return messages
    .map((message, index) => `${index + 1}. ${message.role}\n${message.content}`)
    .join("\n\n");
}

function formatDebugNotes(notes: MemoryLayerNote[]) {
  if (!notes.length) {
    return "- empty";
  }

  return notes.map((note) => `- ${note.text}`).join("\n");
}

function MemoryLayersView({
  activeDialog,
  events,
  lab,
  loading,
  model,
  onCreate,
  onDelete,
  onModelChange,
  onRename,
  onSelect,
  onSend,
  onMemoryFolderMove,
  onProfileApplySuggestion,
  onProfileApplySuggestions,
  onProfileCreate,
  onProfileDelete,
  onProfileDismissSuggestion,
  onProfileDismissSuggestions,
  onProfileRename,
  onProfileSelect,
  onProfileUpdate,
  prompt,
  setPrompt,
}: {
  activeDialog: MemoryDialog | null;
  events: MemoryLayerEvent[];
  lab: MemoryLayersState;
  loading: boolean;
  model: string;
  onCreate: () => void;
  onDelete: (dialog: MemoryDialog) => void;
  onModelChange: (value: string) => void;
  onRename: (dialog: MemoryDialog) => void;
  onSelect: (dialogId: string) => void;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
  onMemoryFolderMove: (memoryFolder: string) => void;
  onProfileApplySuggestion: (profileUpdateId: string) => void;
  onProfileApplySuggestions: (profileId: string) => void;
  onProfileCreate: (name: string) => void;
  onProfileDelete: (profileId: string) => void;
  onProfileDismissSuggestion: (profileUpdateId: string) => void;
  onProfileDismissSuggestions: (profileId: string) => void;
  onProfileRename: (profileId: string, name: string) => void;
  onProfileSelect: (profileId: string) => void;
  onProfileUpdate: (profile: Partial<UserProfile> & { id: string }) => void;
  prompt: string;
  setPrompt: (value: string) => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const rows = activeDialog?.metrics ?? [];
  const lastMetricRow = rows[rows.length - 1];
  const activeBranch = activeDialog?.branches.find(
    (branch) => branch.id === activeDialog.activeBranchId,
  );
  const activeBranchSummary =
    activeBranch?.profileSummaries?.[lab.activeProfileId] ??
    activeBranch?.summary ??
    "";
  const modelOption = getModelOption(model);
  const contextLimit = modelOption?.contextWindowTokens ?? 128000;
  const usedContextTokens =
    lastMetricRow?.contextTokens ??
    (activeDialog ? estimateUiMessageTokens(activeDialog.messages) : 0);
  const contextPercent = Math.min(
    100,
    Math.round((usedContextTokens / contextLimit) * 1000) / 10,
  );
  return (
    <section className="token-lab memory-lab">
      <div className="assistant-toolbar">
        <div>
          <p className="eyebrow">Unified assistant</p>
          <h2>Personalized memory assistant</h2>
        </div>
        <button
          aria-label="Open assistant settings"
          className="icon-button"
          onClick={() => setSettingsOpen(true)}
          title="Settings"
          type="button"
        >
          ⚙
        </button>
      </div>
      <div className="dialog-tabs" aria-label="Memory layer dialogs">
        {lab.dialogs.map((dialog) => (
          <div
            className={
              dialog.id === lab.activeDialogId
                ? "dialog-tab active"
                : "dialog-tab"
            }
            key={dialog.id}
          >
            <button
              className="tab-select"
              onClick={() => onSelect(dialog.id)}
              title={dialog.title}
              type="button"
            >
              {dialog.title}
            </button>
            <button
              aria-label={`Rename ${dialog.title}`}
              className="tab-rename"
              onClick={(event) => {
                event.stopPropagation();
                onRename(dialog);
              }}
              title="Rename dialog"
              type="button"
            >
              {"\u270e"}
            </button>
            <button
              aria-label={`Delete ${dialog.title}`}
              className="tab-close"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(dialog);
              }}
              title="Delete dialog"
              type="button"
            >
              x
            </button>
          </div>
        ))}
        <button className="dialog-add" onClick={onCreate} type="button">
          +
        </button>
      </div>

      {!activeDialog ? (
        <div className="empty">Create a dialog to start using memory layers.</div>
      ) : (
        <>
          <ConversationHistory messages={activeDialog.messages} />
          <div className="branch-summary">
            <span>Active topic: {activeBranch?.title ?? "Main topic"}</span>
            <span>
              {activeBranchSummary
                ? `Summary: ${activeBranchSummary}`
                : "Summary: empty"}
            </span>
          </div>
          <form className="chat-composer" onSubmit={onSend}>
            <textarea
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Send a message. The assistant will decide which memory layer should be updated."
              rows={4}
              value={prompt}
            />
            <div className="composer-controls memory-composer-controls">
              <label>
                Model
                <select
                  onChange={(event) => onModelChange(event.target.value)}
                  value={model}
                >
                  {modelGroups.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label} - {option.value}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <div className="context-usage compact">
                <span>
                  Context: {formatTokens(usedContextTokens)} /{" "}
                  {compactTokens(contextLimit)} · {contextPercent}%
                </span>
                <div className="context-bar" aria-label="Context usage">
                  <span style={{ width: `${contextPercent}%` }} />
                </div>
              </div>
              <button className="run" disabled={loading} type="submit">
                {loading ? "Sending..." : "Send"}
              </button>
            </div>
          </form>

          <details open className="metrics-details">
            <summary>Memory routing trace</summary>
            {events.length === 0 ? (
              <div className="empty">
                Send a message to see how memory was routed.
              </div>
            ) : (
              <ol className="trace-list">
                {events.map((event, index) => (
                  <li key={`${event.layer}-${event.action}-${index}`}>
                    <strong>{event.layer}</strong>
                    <span>{event.action}</span>
                    <pre>{`${event.detail}\n${event.filePath}`}</pre>
                  </li>
                ))}
              </ol>
            )}
          </details>
        </>
      )}
      {settingsOpen && (
        <AssistantSettingsModal
          lab={lab}
          loading={loading}
          onClose={() => setSettingsOpen(false)}
          onMemoryFolderMove={onMemoryFolderMove}
          onProfileApplySuggestion={onProfileApplySuggestion}
          onProfileApplySuggestions={onProfileApplySuggestions}
          onProfileCreate={onProfileCreate}
          onProfileDelete={onProfileDelete}
          onProfileDismissSuggestion={onProfileDismissSuggestion}
          onProfileDismissSuggestions={onProfileDismissSuggestions}
          onProfileRename={onProfileRename}
          onProfileSelect={onProfileSelect}
          onProfileUpdate={onProfileUpdate}
        />
      )}
    </section>
  );
}

function TokenLabView({
  activeDialog,
  lab,
  loading,
  model,
  mode = "tokens",
  onBranchChange,
  onCreate,
  onDelete,
  onModelChange,
  onRename,
  onSelect,
  onSend,
  onStrategyChange,
  prompt,
  recentMessages,
  setRecentMessages,
  setPrompt,
}: {
  activeDialog: TokenDialog | null;
  lab: TokenLabState;
  loading: boolean;
  model: string;
  mode?: "tokens" | "compression" | "strategy";
  onBranchChange?: (branch: string) => void;
  onCreate: () => void;
  onDelete: (dialog: TokenDialog) => void;
  onModelChange: (value: string) => void;
  onRename: (dialog: TokenDialog) => void;
  onSelect: (dialogId: string) => void;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
  onStrategyChange?: (strategy: "sliding_window" | "sticky_facts" | "branching") => void;
  prompt: string;
  recentMessages?: string;
  setRecentMessages?: (value: string) => void;
  setPrompt: (value: string) => void;
}) {
  const rows = activeDialog?.metrics ?? [];
  const canShowCostGraphs = hasCompleteCostData(rows);
  const lastMetricRow = rows[rows.length - 1];
  const modelOption = getModelOption(model);
  const contextLimit = modelOption?.contextWindowTokens ?? 128000;
  const usedContextTokens =
    lastMetricRow?.contextTokens ??
    (activeDialog ? estimateUiMessageTokens(activeDialog.messages) : 0);
  const contextPercent = Math.min(
    100,
    Math.round((usedContextTokens / contextLimit) * 1000) / 10,
  );

  return (
    <section className="token-lab">
      <div className="dialog-tabs" aria-label="Token dialogs">
        {lab.dialogs.map((dialog) => (
          <div
            className={
              dialog.id === lab.activeDialogId
                ? "dialog-tab active"
                : "dialog-tab"
            }
            key={dialog.id}
          >
            <button
              className="tab-select"
              onClick={() => onSelect(dialog.id)}
              type="button"
            >
              {dialog.title}
            </button>
            <button
              aria-label={`Rename ${dialog.title}`}
              className="tab-rename"
              onClick={(event) => {
                event.stopPropagation();
                onRename(dialog);
              }}
              title="Rename dialog"
              type="button"
            >
              {"\u270e"}
            </button>
            <button
              aria-label={`Delete ${dialog.title}`}
              className="tab-close"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(dialog);
              }}
              type="button"
            >
              x
            </button>
          </div>
        ))}
        <button className="dialog-add" onClick={onCreate} type="button">
          +
        </button>
      </div>

      {!activeDialog ? (
        <div className="empty">Create a dialog to start measuring tokens.</div>
      ) : (
        <>
          {mode === "compression" && activeDialog.summary && (
            <details open className="metrics-details">
              <summary>Compressed memory summary</summary>
              <pre className="answer">{activeDialog.summary}</pre>
            </details>
          )}
          {mode === "strategy" && activeDialog.facts && activeDialog.facts.length > 0 && (
            <details open className="metrics-details">
              <summary>Sticky facts</summary>
              <ul className="fact-list">
                {activeDialog.facts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
            </details>
          )}
          <ConversationHistory messages={activeDialog.messages} />
          <form className="chat-composer" onSubmit={onSend}>
            <textarea
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Send a message and watch token/cost metrics grow..."
              rows={4}
              value={prompt}
            />
            <div className="composer-controls">
              <label>
                Model
                <select
                  onChange={(event) => onModelChange(event.target.value)}
                  value={model}
                >
                  {modelGroups.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label} - {option.value}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <div className="context-usage compact">
                <span>
                  Context: {formatTokens(usedContextTokens)} /{" "}
                  {compactTokens(contextLimit)} · {contextPercent}%
                </span>
                <div className="context-bar" aria-label="Context usage">
                  <span style={{ width: `${contextPercent}%` }} />
                </div>
              </div>
              {mode === "compression" && setRecentMessages && (
                <label>
                  Recent messages to keep
                  <input
                    inputMode="numeric"
                    onChange={(event) => setRecentMessages(event.target.value)}
                    value={recentMessages ?? "4"}
                  />
                </label>
              )}
              {mode === "strategy" && onStrategyChange && (
                <label>
                  Strategy
                  <select
                    onChange={(event) =>
                      onStrategyChange(
                        event.target.value as
                          | "sliding_window"
                          | "sticky_facts"
                          | "branching",
                      )
                    }
                    value={activeDialog.strategy ?? "sliding_window"}
                  >
                    <option value="sliding_window">Sliding Window</option>
                    <option value="sticky_facts">Sticky Facts</option>
                    <option value="branching">Branching</option>
                  </select>
                </label>
              )}
              {mode === "strategy" && setRecentMessages && (
                <label>
                  Recent messages
                  <input
                    inputMode="numeric"
                    onChange={(event) => setRecentMessages(event.target.value)}
                    value={recentMessages ?? "6"}
                  />
                </label>
              )}
              {mode === "strategy" &&
                activeDialog.strategy === "branching" &&
                onBranchChange && (
                  <label>
                    Branch
                    <select
                      onChange={(event) => onBranchChange(event.target.value)}
                      value={activeDialog.branch ?? "main"}
                    >
                      {(activeDialog.branches ?? ["main", "idea-a", "idea-b"]).map(
                        (branch) => (
                          <option key={branch} value={branch}>
                            {branch}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                )}
              <button className="run" disabled={loading} type="submit">
                {loading ? "Sending..." : "Send"}
              </button>
            </div>
          </form>
          <TokenMetricsTable rows={activeDialog.metrics} />
          {rows.length > 0 &&
            (canShowCostGraphs ? (
              <div className="cost-graphs">
                <CostGraph
                  rows={rows}
                  title="Cost vs request size"
                  xKey="requestTokens"
                />
                <CostGraph
                  rows={rows}
                  title="Cost vs dialog size"
                  xKey="contextTokens"
                />
                <CostGraph
                  rows={rows}
                  title="Cost vs response size"
                  xKey="responseTokens"
                />
              </div>
            ) : (
              <div className="cost-warning">
                This provider did not return cost data. Select another
                provider/model to see cost graphs.
              </div>
            ))}
        </>
      )}
    </section>
  );
}

function TokenMetricsTable({ rows }: { rows: TokenMetricRow[] }) {
  if (rows.length === 0) {
    return (
      <details className="metrics-details">
        <summary>Turn metrics table</summary>
        <div className="empty">
          Send a few messages to fill the token and cost table.
        </div>
      </details>
    );
  }

  return (
    <details className="metrics-details">
      <summary>Turn metrics table</summary>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Turn</th>
              <th>Status</th>
              <th>Request tokens</th>
              <th>Dialog tokens</th>
              <th>Response tokens</th>
              <th>Total tokens</th>
              <th>Time</th>
              <th>Provider cost</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.turn}</td>
                <td>{row.status}</td>
                <td>{formatTokens(row.requestTokens)}</td>
                <td>{formatTokens(row.contextTokens)}</td>
                <td>{formatTokens(row.responseTokens)}</td>
                <td>{formatTokens(row.totalTokens)}</td>
                <td>{row.elapsedMs === null ? "n/a" : `${row.elapsedMs} ms`}</td>
                <td>{formatCost(row.providerCost)}</td>
                <td>{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function ConversationHistory({ messages }: { messages: ChatMessage[] }) {
  return (
    <section className="history-panel">
      <div className="card-head">
        <h3>Saved conversation history</h3>
        <span>{messages.length} messages</span>
      </div>
      <div className="history-list">
        {messages.map((message, index) => (
          <article className="history-message" key={`${message.role}-${index}`}>
            <strong>{message.role}</strong>
            <pre>{message.content}</pre>
          </article>
        ))}
      </div>
    </section>
  );
}

function ResultCard({ result }: { result: PanelResult }) {
  return (
    <article className="result-card">
      <div className="card-head">
        <h3>{result.title}</h3>
        <span>{result.elapsedMs} ms</span>
      </div>
      <p className="model">{result.model}</p>
      <div className="metrics">
        <span>prompt {formatTokens(result.usage.promptTokens)}</span>
        <span>completion {formatTokens(result.usage.completionTokens)}</span>
        <span>total {formatTokens(result.usage.totalTokens)}</span>
        <span>
          cost{" "}
          {formatCost(result.usage.providerCost ?? result.manualCost ?? null)}
        </span>
      </div>
      {result.note && (
        <details>
          <summary>Generated prompt</summary>
          <pre>{result.note}</pre>
        </details>
      )}
      {result.trace && (
        <details open>
          <summary>Agent trace</summary>
          <ol className="trace-list">
            {result.trace.map((item) => (
              <li key={item.step}>
                <strong>{item.label}</strong>
                <span>{item.step}</span>
                <pre>{item.detail}</pre>
              </li>
            ))}
          </ol>
        </details>
      )}
      <pre className="answer">{result.answer || "No content returned."}</pre>
    </article>
  );
}

function DayFiveTable({ results }: { results: PanelResult[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Level</th>
            <th>Model</th>
            <th>Time</th>
            <th>Tokens</th>
            <th>Cost</th>
            <th>Answer</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={result.title}>
              <td>{result.title}</td>
              <td>{result.model}</td>
              <td>{result.elapsedMs} ms</td>
              <td>{formatTokens(result.usage.totalTokens)}</td>
              <td>
                {formatCost(result.usage.providerCost ?? result.manualCost ?? null)}
              </td>
              <td>
                <pre>{result.answer}</pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
