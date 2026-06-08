"use client";

import { FormEvent, useMemo, useState } from "react";

type DayKey = "day1" | "day2" | "day3" | "day4" | "day5";

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

type PanelResult = LlmResult & {
  title: string;
  note?: string;
  manualCost?: number | null;
};

type ModelRow = {
  label: string;
  model: string;
};

const modelGroups = [
  {
    label: "Слабая",
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
    label: "Средняя",
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
    label: "Сильная",
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

const tabs: Array<{ key: DayKey; label: string; title: string }> = [
  { key: "day1", label: "Day 1 API", title: "Первый запрос к LLM через API" },
  { key: "day2", label: "Day 2 Format", title: "Формат ответа" },
  { key: "day3", label: "Day 3 Reasoning", title: "Разные способы рассуждения" },
  { key: "day4", label: "Day 4 Temperature", title: "Температура" },
  { key: "day5", label: "Day 5 Models", title: "Версии моделей" },
];

const defaultPrompts: Record<DayKey, string> = {
  day1: "Объясни простыми словами, что такое промптинг, в 5 предложениях.",
  day2: "Расскажи, как разработчику использовать LLM в ежедневной работе.",
  day3:
    "У меня есть 9 монет, одна из них легче остальных. Как найти легкую монету за два взвешивания на чашечных весах?",
  day4: "Придумай короткую идею pet-проекта для разработчика, который изучает AI.",
  day5:
    "Можно ли использовать несуществующую библиотеку react-ai-router-kit для production-проекта? Ответь как инженер.",
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

function formatTokens(value: number | null) {
  return value === null ? "n/a" : value.toLocaleString("ru-RU");
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
    "Верни JSON с полями summary, bullets, final_marker.",
  );
  const [maxTokens, setMaxTokens] = useState("160");
  const [stopSequence, setStopSequence] = useState("END");
  const [temperatures, setTemperatures] = useState(["0", "0.7", "1.2"]);
  const [modelRows, setModelRows] = useState<ModelRow[]>([
    {
      label: "Слабая",
      model:
        process.env.NEXT_PUBLIC_MODEL_WEAK ||
        "meta-llama/llama-3.2-1b-instruct",
    },
    {
      label: "Средняя",
      model: process.env.NEXT_PUBLIC_MODEL_MEDIUM || "qwen/qwen3-32b",
    },
    {
      label: "Сильная",
      model:
        process.env.NEXT_PUBLIC_MODEL_STRONG ||
        "qwen/qwen3-235b-a22b-thinking-2507",
    },
  ]);
  const [results, setResults] = useState<PanelResult[]>([]);
  const [conclusion, setConclusion] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.key === activeDay) ?? tabs[0],
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

Требования к ответу:
${formatInstruction}
Ограничь ответ примерно ${maxTokens || "160"} токенами.
Заверши ответ строкой ${stopSequence || "END"}.`;
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
          { title: "Без ограничений", ...baseline },
          { title: "С контролем формата", ...controlled },
        ]);
      }

      if (activeDay === "day3") {
        const directPrompt = prompt;
        const stepPrompt = `${prompt}\n\nРешай пошагово. В конце дай короткий финальный ответ.`;
        const metaPromptRequest = `Составь сильный промпт для решения этой задачи через LLM. Верни только готовый промпт:\n\n${prompt}`;
        const expertsPrompt = `${prompt}

Реши задачу как группа экспертов:
1. Аналитик формулирует ход решения.
2. Инженер проверяет практическую корректность.
3. Критик ищет ошибку.
4. Модератор дает финальный ответ.`;

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
          { title: "Прямой ответ", ...direct },
          { title: "Решай пошагово", ...step },
          {
            title: "Промпт от модели",
            note: metaPrompt.answer,
            ...generated,
          },
          { title: "Группа экспертов", ...experts },
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
          <h1>5 дней LLM API практики</h1>
        </div>
        <div className="status">OpenAI-compatible API</div>
      </section>

      <nav className="tabs" aria-label="Days">
        {tabs.map((tab) => (
          <button
            className={tab.key === activeDay ? "tab active" : "tab"}
            key={tab.key}
            onClick={() => switchDay(tab.key)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className="workspace">
        <form className="controls" onSubmit={runDay}>
          <div>
            <p className="eyebrow">Задание</p>
            <h2>{activeTab.title}</h2>
          </div>

          <label>
            Запрос
            <textarea
              onChange={(event) => setPrompt(event.target.value)}
              rows={7}
              value={prompt}
            />
          </label>

          <label>
            Модель
            <select
              onChange={(event) => setModel(event.target.value)}
              value={model}
            >
              {modelGroups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} · {option.value}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {activeDay === "day2" && (
            <div className="control-grid">
              <label>
                Формат ответа
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
                      next[index] = { ...next[index], model: event.target.value };
                      setModelRows(next);
                    }}
                    value={row.model}
                  >
                    {(modelGroups[index]?.options ?? []).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} В· {option.value}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          <button className="run" disabled={loading} type="submit">
            {loading ? "Выполняю..." : "Запустить задание"}
          </button>
          {error && <p className="error">{error}</p>}
        </form>

        <section className="results">
          {results.length === 0 && !loading && (
            <div className="empty">
              Выбери день, проверь prompt и запусти запрос. Ответы и метрики появятся здесь.
            </div>
          )}
          {loading && <div className="empty">Запрос выполняется...</div>}

          {activeDay === "day5" && results.length > 0 ? (
            <DayFiveTable results={results} />
          ) : (
            <div className="result-grid">
              {results.map((result) => (
                <ResultCard key={result.title} result={result} />
              ))}
            </div>
          )}

          {results.length > 0 && (
            <label className="conclusion">
              Короткий вывод для видео
              <textarea
                onChange={(event) => setConclusion(event.target.value)}
                placeholder="Зафиксируй, какой вариант оказался лучше и почему."
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
          <summary>Сгенерированный промпт</summary>
          <pre>{result.note}</pre>
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
            <th>Уровень</th>
            <th>Модель</th>
            <th>Время</th>
            <th>Токены</th>
            <th>Стоимость</th>
            <th>Ответ</th>
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
