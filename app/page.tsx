"use client";

import { FormEvent, useMemo, useState } from "react";

type DayKey = "day1" | "day2" | "day3" | "day4" | "day5" | "day6";

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
};

type ModelRow = {
  label: string;
  model: string;
};

const modelGroups = [
  {
    label: "Weak",
    options: [
      {
        value: "meta-llama/llama-3.2-1b-instruct",
        label: "Llama 3.2 1B Instruct",
      },
      { value: "openai/gpt-4.1-nano", label: "GPT-4.1 Nano" },
      { value: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash" },
    ],
  },
  {
    label: "Medium",
    options: [
      { value: "qwen/qwen3-32b", label: "Qwen3 32B" },
      {
        value: "qwen/qwen-2.5-72b-instruct",
        label: "Qwen 2.5 72B Instruct",
      },
      { value: "deepseek/deepseek-chat-v3.1", label: "DeepSeek Chat V3.1" },
    ],
  },
  {
    label: "Strong",
    options: [
      {
        value: "qwen/qwen3-235b-a22b-thinking-2507",
        label: "Qwen3 235B A22B Thinking",
      },
      { value: "deepseek/deepseek-r1", label: "DeepSeek R1" },
      { value: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro" },
      { value: "openai/gpt-4o", label: "GPT-4o" },
      { value: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
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

function formatTokens(value: number | null) {
  return value === null ? "n/a" : value.toLocaleString("en-US");
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
  const [conclusion, setConclusion] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const activeDayMeta = useMemo(
    () => days.find((day) => day.key === activeDay) ?? days[0],
    [activeDay],
  );

  function switchDay(day: DayKey) {
    setActiveDay(day);
    setPrompt(defaultPrompts[day]);
    setResults([]);
    setConclusion("");
    setError("");
  }

  async function runDay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResults([]);
    setConclusion("");

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

      <section className="workspace">
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

        <section className="results">
          {results.length === 0 && !loading && (
            <div className="empty">
              Select a day, review the prompt, and run the request. Answers and
              metrics will appear here.
            </div>
          )}
          {loading && <div className="empty">Request is running...</div>}

          {activeDay === "day5" && results.length > 0 ? (
            <DayFiveTable results={results} />
          ) : (
            <div className="result-grid">
              {results.map((result) => (
                <ResultCard key={result.title} result={result} />
              ))}
            </div>
          )}

          {results.length > 0 && activeDay !== "day6" && (
            <label className="conclusion">
              Short video conclusion
              <textarea
                onChange={(event) => setConclusion(event.target.value)}
                placeholder="Capture which option worked best and why."
                rows={4}
                value={conclusion}
              />
            </label>
          )}
        </section>
      </section>
    </main>
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
