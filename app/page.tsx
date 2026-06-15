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
  | "day9";

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
};

type TokenLabState = {
  activeDialogId: string;
  dialogs: TokenDialog[];
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
  const [activeDay, setActiveDay] = useState<DayKey>("day1");
  const [prompt, setPrompt] = useState(defaultPrompts.day1);
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

  function switchDay(day: DayKey) {
    setActiveDay(day);
    setPrompt(defaultPrompts[day]);
    setResults([]);
    setTokenLab(null);
    setCompressionLab(null);
    setError("");
  }

  async function runDay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeDay === "day8" || activeDay === "day9") {
      return;
    }
    setLoading(true);
    setError("");
    setResults([]);
    setTokenLab(null);
    setCompressionLab(null);

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
          <h1>LLM API Practice</h1>
        </div>
        <div className="status">OpenAI-compatible API</div>
      </section>

      <label className="day-picker">
        Day
        <select
          onChange={(event) => switchDay(event.target.value as DayKey)}
          value={activeDay}
        >
          {days.map((day) => (
            <option key={day.key} value={day.key}>
              {day.label}
            </option>
          ))}
        </select>
      </label>

      <section
        className={
          activeDay === "day8" || activeDay === "day9"
            ? "workspace day8-workspace"
            : "workspace"
        }
      >
        {activeDay !== "day8" && activeDay !== "day9" && (
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
          {(activeDay === "day8" || activeDay === "day9") && error && (
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

          {results.length === 0 &&
            !loading &&
            activeDay !== "day8" &&
            activeDay !== "day9" && (
            <div className="empty">
              Select a day, review the prompt, and run the request. Answers and
              metrics will appear here.
            </div>
          )}
          {loading && <div className="empty">Request is running...</div>}

          {activeDay === "day5" && results.length > 0 ? (
            <DayFiveTable results={results} />
          ) : activeDay === "day8" || activeDay === "day9" ? null : (
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

function TokenLabView({
  activeDialog,
  lab,
  loading,
  model,
  mode = "tokens",
  onCreate,
  onDelete,
  onModelChange,
  onRename,
  onSelect,
  onSend,
  prompt,
  recentMessages,
  setRecentMessages,
  setPrompt,
}: {
  activeDialog: TokenDialog | null;
  lab: TokenLabState;
  loading: boolean;
  model: string;
  mode?: "tokens" | "compression";
  onCreate: () => void;
  onDelete: (dialog: TokenDialog) => void;
  onModelChange: (value: string) => void;
  onRename: (dialog: TokenDialog) => void;
  onSelect: (dialogId: string) => void;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
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
            <button
              aria-label={`Rename ${dialog.title}`}
              className="tab-rename"
              onClick={(event) => {
                event.stopPropagation();
                onRename(dialog);
              }}
              type="button"
            >
              rename
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
              <div className="context-usage">
                <div>
                  <strong>Context usage</strong>
                  <span>
                    {formatTokens(usedContextTokens)} / {compactTokens(contextLimit)} tokens
                  </span>
                </div>
                <div className="context-bar" aria-label="Context usage">
                  <span style={{ width: `${contextPercent}%` }} />
                </div>
                <small>
                  {contextPercent}% of OpenRouter max context for selected model
                </small>
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
