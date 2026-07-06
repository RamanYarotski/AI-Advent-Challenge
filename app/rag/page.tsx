"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

type RagStatus = {
  manifest: null | {
    day21?: {
      comparison: {
        documentCount: number;
        fixedChunks: number;
        structuralChunks: number;
        fixedAverageTokens: number;
        structuralAverageTokens: number;
        recommendation: string;
      };
      embeddingProvider: string;
      sourceInputs?: string[];
      sourceSummaries?: Array<{
        input: string;
        type: string;
        documentCount: number;
        warning?: string;
      }>;
      warnings?: string[];
      updatedAt: string;
    };
  };
};

type IndexResult = {
  comparison: {
    documentCount: number;
    fixedChunks: number;
    structuralChunks: number;
    fixedAverageTokens: number;
    structuralAverageTokens: number;
    recommendation: string;
  };
  fixed: {
    elapsedMs: number;
  };
  structural: {
    elapsedMs: number;
  };
  reportPath: string;
};

type QueryResult = {
  question: string;
  strategy: string;
  topK: number;
  plain: {
    answer: string;
    mode: string;
    warning: string | null;
  };
  rag: {
    answer: string;
    mode: string;
    warning: string | null;
  };
  matches: Array<{
    id: string;
    text: string;
    score: number;
    metadata: {
      source: string;
      section: string;
      chunk_id: string;
    };
  }>;
};

type RerankResult = {
  question: string;
  rewrittenQuestion: string;
  parameters: {
    initialTopK: number;
    finalTopK: number;
    threshold: number;
  };
  baseline: QueryResult["matches"];
  filtered: QueryResult["matches"];
  reranked: Array<QueryResult["matches"][number] & { rerankScore?: number }>;
  answer: {
    answer: string;
    mode: string;
    warning: string | null;
  };
};

type CitedAnswerResult = {
  status: "answered" | "unknown";
  answer: string;
  topScore: number;
  minScore: number;
  minLexicalOverlap: number;
  sources: Array<{
    source: string;
    section: string;
    chunk_id: string;
    score: number;
  }>;
  citations: Array<{
    id: string;
    source: string;
    section: string;
    chunk_id: string;
    score: number;
    quote: string;
  }>;
};

type RagChatResult = {
  session: {
    id: string;
    messages: Array<{
      role: "user" | "assistant";
      content: string;
      sources?: unknown[];
      citations?: unknown[];
      status?: string;
      createdAt: string;
    }>;
    taskState: {
      goal: string;
      constraints: string[];
      terms: string[];
      clarifications: string[];
    };
  };
  assistantMessage: {
    content: string;
    sources: unknown[];
    citations: unknown[];
    status: string;
  };
};

const defaultSourcesText = [
  "README.md",
  "docs",
  "lib",
  "app/api",
  "mcp",
  "docs/rag-week-chat-notes.md",
].join("\n");

export default function RagWeekPage() {
  const [activeStage, setActiveStage] = useState<
    "day21" | "day22" | "day23" | "day24" | "day25"
  >("day21");
  const [status, setStatus] = useState<RagStatus | null>(null);
  const [result, setResult] = useState<IndexResult | null>(null);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [rerankResult, setRerankResult] = useState<RerankResult | null>(null);
  const [citedResult, setCitedResult] = useState<CitedAnswerResult | null>(null);
  const [chatResult, setChatResult] = useState<RagChatResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [queryLoading, setQueryLoading] = useState(false);
  const [fixedTokens, setFixedTokens] = useState("900");
  const [overlapTokens, setOverlapTokens] = useState("120");
  const [maxStructuralTokens, setMaxStructuralTokens] = useState("1200");
  const [embeddingMode, setEmbeddingMode] = useState("local_hash");
  const [sourcesText, setSourcesText] = useState(defaultSourcesText);
  const [rebuildIndex, setRebuildIndex] = useState(false);
  const [question, setQuestion] = useState(
    "Что должен делать RAG ассистент при слабом контексте?",
  );
  const [strategy, setStrategy] = useState("structural");
  const [topK, setTopK] = useState("8");
  const [generationMode, setGenerationMode] = useState("local");
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState("0.2");
  const [maxTokens, setMaxTokens] = useState("700");
  const [initialTopK, setInitialTopK] = useState("15");
  const [finalTopK, setFinalTopK] = useState("5");
  const [threshold, setThreshold] = useState("0.24");
  const [minScore, setMinScore] = useState("0.24");
  const [minLexicalOverlap, setMinLexicalOverlap] = useState("0.08");
  const [useRewrite, setUseRewrite] = useState(true);
  const [sessionId, setSessionId] = useState("day25-demo");
  const [chatMessage, setChatMessage] = useState(
    "Цель: подготовить сдачу RAG недели. Какие источники и цитаты важны для Day 24?",
  );

  async function loadStatus() {
    const response = await fetch("/api/rag/status");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load RAG status.");
    }
    return payload as RagStatus;
  }

  async function refreshStatus() {
    setStatus(await loadStatus());
  }

  useEffect(() => {
    let cancelled = false;
    async function loadInitialStatus() {
      try {
        const payload = await loadStatus();
        if (!cancelled) {
          setStatus(payload);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load status.");
        }
      }
    }
    void loadInitialStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runIndexing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/rag/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcesText,
          fixedTokens: Number(fixedTokens),
          overlapTokens: Number(overlapTokens),
          maxStructuralTokens: Number(maxStructuralTokens),
          embeddingMode,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Indexing failed.");
      }
      setResult(payload);
      await refreshStatus();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Indexing failed.");
    } finally {
      setLoading(false);
    }
  }

  async function runQuery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQueryLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/rag/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...pipelinePayload(),
          question,
          strategy,
          topK: Number(topK),
          generationMode,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "RAG query failed.");
      }
      setQueryResult(payload);
      setActiveStage("day22");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "RAG query failed.");
    } finally {
      setQueryLoading(false);
    }
  }

  async function runRerank(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQueryLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/rag/rerank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...pipelinePayload(),
          question,
          strategy,
          initialTopK: Number(initialTopK),
          finalTopK: Number(finalTopK),
          threshold: Number(threshold),
          useRewrite,
          generationMode,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Rerank query failed.");
      }
      setRerankResult(payload);
      setActiveStage("day23");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Rerank query failed.");
    } finally {
      setQueryLoading(false);
    }
  }

  async function runCitedAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQueryLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/rag/cited-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...pipelinePayload(),
          question,
          strategy,
          initialTopK: Number(initialTopK),
          finalTopK: Number(finalTopK),
          threshold: Number(threshold),
          minScore: Number(minScore),
          minLexicalOverlap: Number(minLexicalOverlap),
          useRewrite,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Cited answer failed.");
      }
      setCitedResult(payload);
      setActiveStage("day24");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Cited answer failed.");
    } finally {
      setQueryLoading(false);
    }
  }

  async function runChatTurn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQueryLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/rag/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...pipelinePayload(),
          sessionId,
          message: chatMessage,
          strategy,
          initialTopK: Number(initialTopK),
          finalTopK: Number(finalTopK),
          threshold: Number(threshold),
          minScore: Number(minScore),
          minLexicalOverlap: Number(minLexicalOverlap),
          useRewrite,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "RAG chat failed.");
      }
      setChatResult(payload);
      setChatMessage("");
      setActiveStage("day25");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "RAG chat failed.");
    } finally {
      setQueryLoading(false);
    }
  }

  const latest = result?.comparison ?? status?.manifest?.day21?.comparison ?? null;
  const latestSources = status?.manifest?.day21?.sourceSummaries ?? [];
  const latestWarnings = status?.manifest?.day21?.warnings ?? [];

  function pipelinePayload() {
    return {
      sourcesText,
      fixedTokens: Number(fixedTokens),
      overlapTokens: Number(overlapTokens),
      maxStructuralTokens: Number(maxStructuralTokens),
      embeddingMode,
      rebuildIndex,
      model: model.trim() || undefined,
      temperature: temperature.trim() ? Number(temperature) : undefined,
      maxTokens: maxTokens.trim() ? Number(maxTokens) : undefined,
    };
  }

  function renderPipelineControls(options: { allowRebuild: boolean }) {
    return (
      <details className="rag-pipeline" open>
        <summary>Pipeline parameters</summary>
        <label className="rag-textarea-label">
          Sources
          <textarea
            onChange={(event) => setSourcesText(event.target.value)}
            placeholder="One source per line: docs, README.md, C:\path\repo, https://example.com/page, https://github.com/owner/repo"
            rows={6}
            value={sourcesText}
          />
        </label>
        <div className="rag-control-grid">
          <label>
            Fixed chunk tokens
            <input
              inputMode="numeric"
              onChange={(event) => setFixedTokens(event.target.value)}
              value={fixedTokens}
            />
          </label>
          <label>
            Overlap tokens
            <input
              inputMode="numeric"
              onChange={(event) => setOverlapTokens(event.target.value)}
              value={overlapTokens}
            />
          </label>
          <label>
            Structural max tokens
            <input
              inputMode="numeric"
              onChange={(event) => setMaxStructuralTokens(event.target.value)}
              value={maxStructuralTokens}
            />
          </label>
          <label>
            Embeddings
            <select
              onChange={(event) => setEmbeddingMode(event.target.value)}
              value={embeddingMode}
            >
              <option value="local_hash">Local hash</option>
              <option value="api">API with fallback</option>
            </select>
          </label>
        </div>
        {options.allowRebuild && (
          <label className="rag-check">
            <input
              checked={rebuildIndex}
              onChange={(event) => setRebuildIndex(event.target.checked)}
              type="checkbox"
            />
            Rebuild index before running this stage
          </label>
        )}
        {latestSources.length > 0 && (
          <details className="rag-source-profile">
            <summary>Current index sources</summary>
            {latestSources.map((source) => (
              <div className="rag-source" key={`${source.type}-${source.input}`}>
                <strong>{source.type}</strong>
                <span>
                  {source.input} · {source.documentCount} document(s)
                  {source.warning ? ` · ${source.warning}` : ""}
                </span>
              </div>
            ))}
          </details>
        )}
        {latestWarnings.length > 0 && (
          <div className="rag-warning-list">
            {latestWarnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        )}
      </details>
    );
  }

  return (
    <main className="rag-shell">
      <section className="rag-toolbar">
        <div>
          <p className="eyebrow">RAG toolkit</p>
          <h1>Day 21-25 instruments</h1>
        </div>
        <Link className="rag-link" href="/">
          Assistant
        </Link>
      </section>

      <nav className="rag-tabs" aria-label="RAG week stages">
        <button
          className={activeStage === "day21" ? "active" : ""}
          onClick={() => setActiveStage("day21")}
          type="button"
        >
          Day 21 Indexer
        </button>
        <button
          className={activeStage === "day22" ? "active" : ""}
          onClick={() => setActiveStage("day22")}
          type="button"
        >
          Day 22 RAG
        </button>
        <button
          className={activeStage === "day23" ? "active" : ""}
          onClick={() => setActiveStage("day23")}
          type="button"
        >
          Day 23 Filter
        </button>
        <button
          className={activeStage === "day24" ? "active" : ""}
          onClick={() => setActiveStage("day24")}
          type="button"
        >
          Day 24 Citations
        </button>
        <button
          className={activeStage === "day25" ? "active" : ""}
          onClick={() => setActiveStage("day25")}
          type="button"
        >
          Day 25 Chat
        </button>
      </nav>

      {activeStage === "day21" && (
        <section className="rag-tool-grid">
          <form className="rag-panel" onSubmit={runIndexing}>
            <div className="card-head">
              <h2>Document indexer</h2>
              <span>{status?.manifest?.day21?.embeddingProvider ?? "not indexed"}</span>
            </div>
            {renderPipelineControls({ allowRebuild: false })}
            <button className="run" disabled={loading} type="submit">
              {loading ? "Indexing..." : "Build indexes"}
            </button>
            {error && <p className="rag-error">{error}</p>}
          </form>

          <section className="rag-panel">
            <div className="card-head">
              <h2>Index summary</h2>
              <span>{status?.manifest?.day21?.updatedAt ?? "pending"}</span>
            </div>
            {latest ? (
              <div className="rag-metrics">
                <article>
                  <strong>{latest.documentCount}</strong>
                  <span>documents</span>
                </article>
                <article>
                  <strong>{latest.fixedChunks}</strong>
                  <span>fixed chunks</span>
                </article>
                <article>
                  <strong>{latest.structuralChunks}</strong>
                  <span>structural chunks</span>
                </article>
                <article>
                  <strong>{latest.fixedAverageTokens}</strong>
                  <span>fixed avg tokens</span>
                </article>
                <article>
                  <strong>{latest.structuralAverageTokens}</strong>
                  <span>structural avg tokens</span>
                </article>
                <p>{latest.recommendation}</p>
                {result && <p>Report: {result.reportPath}</p>}
              </div>
            ) : (
              <div className="empty">No index has been built yet.</div>
            )}
          </section>
        </section>
      )}

      {activeStage === "day22" && (
        <section className="rag-tool-grid">
          <form className="rag-panel" onSubmit={runQuery}>
            <div className="card-head">
              <h2>RAG query</h2>
              <span>{strategy}</span>
            </div>
            {renderPipelineControls({ allowRebuild: true })}
            <label className="rag-textarea-label">
              Question
              <textarea
                onChange={(event) => setQuestion(event.target.value)}
                rows={4}
                value={question}
              />
            </label>
            <div className="rag-control-grid">
              <label>
                Strategy
                <select onChange={(event) => setStrategy(event.target.value)} value={strategy}>
                  <option value="structural">Structural</option>
                  <option value="fixed">Fixed</option>
                </select>
              </label>
              <label>
                top-K
                <input
                  inputMode="numeric"
                  onChange={(event) => setTopK(event.target.value)}
                  value={topK}
                />
              </label>
              <label>
                Generation
                <select
                  onChange={(event) => setGenerationMode(event.target.value)}
                  value={generationMode}
                >
                  <option value="local">Local extractive</option>
                  <option value="llm">LLM with fallback</option>
                </select>
              </label>
              <label>
                Model
                <input
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="env default"
                  value={model}
                />
              </label>
              <label>
                Temperature
                <input
                  inputMode="decimal"
                  onChange={(event) => setTemperature(event.target.value)}
                  value={temperature}
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
            </div>
            <button className="run" disabled={queryLoading} type="submit">
              {queryLoading ? "Searching..." : "Compare answers"}
            </button>
            {error && <p className="rag-error">{error}</p>}
          </form>

          <section className="rag-panel">
            <div className="card-head">
              <h2>Comparison</h2>
              <span>{queryResult ? `${queryResult.matches.length} chunks` : "pending"}</span>
            </div>
            {queryResult ? (
              <div className="rag-answer-grid">
                <article>
                  <h3>Without RAG</h3>
                  <pre>{queryResult.plain.answer}</pre>
                </article>
                <article>
                  <h3>With RAG</h3>
                  <pre>{queryResult.rag.answer}</pre>
                </article>
                <details open>
                  <summary>Retrieved chunks</summary>
                  {queryResult.matches.map((match) => (
                    <div className="rag-source" key={match.id}>
                      <strong>{match.score.toFixed(3)}</strong>
                      <span>
                        {match.metadata.source} · {match.metadata.section}
                      </span>
                    </div>
                  ))}
                </details>
              </div>
            ) : (
              <div className="empty">Run a question to compare both modes.</div>
            )}
          </section>
        </section>
      )}

      {activeStage === "day23" && (
        <section className="rag-tool-grid">
          <form className="rag-panel" onSubmit={runRerank}>
            <div className="card-head">
              <h2>Filter and rerank</h2>
              <span>{strategy}</span>
            </div>
            {renderPipelineControls({ allowRebuild: true })}
            <label className="rag-textarea-label">
              Question
              <textarea
                onChange={(event) => setQuestion(event.target.value)}
                rows={4}
                value={question}
              />
            </label>
            <div className="rag-control-grid">
              <label>
                Initial top-K
                <input
                  inputMode="numeric"
                  onChange={(event) => setInitialTopK(event.target.value)}
                  value={initialTopK}
                />
              </label>
              <label>
                Final top-K
                <input
                  inputMode="numeric"
                  onChange={(event) => setFinalTopK(event.target.value)}
                  value={finalTopK}
                />
              </label>
              <label>
                Threshold
                <input
                  inputMode="decimal"
                  onChange={(event) => setThreshold(event.target.value)}
                  value={threshold}
                />
              </label>
              <label>
                Strategy
                <select onChange={(event) => setStrategy(event.target.value)} value={strategy}>
                  <option value="structural">Structural</option>
                  <option value="fixed">Fixed</option>
                </select>
              </label>
              <label>
                Generation
                <select
                  onChange={(event) => setGenerationMode(event.target.value)}
                  value={generationMode}
                >
                  <option value="local">Local extractive</option>
                  <option value="llm">LLM with fallback</option>
                </select>
              </label>
              <label>
                Model
                <input
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="env default"
                  value={model}
                />
              </label>
              <label>
                Temperature
                <input
                  inputMode="decimal"
                  onChange={(event) => setTemperature(event.target.value)}
                  value={temperature}
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
            </div>
            <label className="rag-check">
              <input
                checked={useRewrite}
                onChange={(event) => setUseRewrite(event.target.checked)}
                type="checkbox"
              />
              Query rewrite
            </label>
            <button className="run" disabled={queryLoading} type="submit">
              {queryLoading ? "Reranking..." : "Run filter"}
            </button>
            {error && <p className="rag-error">{error}</p>}
          </form>

          <section className="rag-panel">
            <div className="card-head">
              <h2>Rerank result</h2>
              <span>{rerankResult ? `${rerankResult.reranked.length} final` : "pending"}</span>
            </div>
            {rerankResult ? (
              <div className="rag-answer-grid">
                <article>
                  <h3>Rewritten query</h3>
                  <pre>{rerankResult.rewrittenQuestion}</pre>
                </article>
                <div className="rag-metrics">
                  <article>
                    <strong>{rerankResult.baseline.length}</strong>
                    <span>baseline</span>
                  </article>
                  <article>
                    <strong>{rerankResult.filtered.length}</strong>
                    <span>after filter</span>
                  </article>
                  <article>
                    <strong>{rerankResult.reranked.length}</strong>
                    <span>after rerank</span>
                  </article>
                  <article>
                    <strong>{rerankResult.parameters.threshold}</strong>
                    <span>threshold</span>
                  </article>
                </div>
                <article>
                  <h3>Answer from reranked context</h3>
                  <pre>{rerankResult.answer.answer}</pre>
                </article>
                <details open>
                  <summary>Final chunks</summary>
                  {rerankResult.reranked.map((match) => (
                    <div className="rag-source" key={match.id}>
                      <strong>{match.score.toFixed(3)}</strong>
                      <span>
                        {match.metadata.source} · {match.metadata.section}
                      </span>
                    </div>
                  ))}
                </details>
              </div>
            ) : (
              <div className="empty">Run filtering to inspect reranked context.</div>
            )}
          </section>
        </section>
      )}

      {activeStage === "day24" && (
        <section className="rag-tool-grid">
          <form className="rag-panel" onSubmit={runCitedAnswer}>
            <div className="card-head">
              <h2>Cited answer</h2>
              <span>{strategy}</span>
            </div>
            {renderPipelineControls({ allowRebuild: true })}
            <label className="rag-textarea-label">
              Question
              <textarea
                onChange={(event) => setQuestion(event.target.value)}
                rows={4}
                value={question}
              />
            </label>
            <div className="rag-control-grid">
              <label>
                Strategy
                <select onChange={(event) => setStrategy(event.target.value)} value={strategy}>
                  <option value="structural">Structural</option>
                  <option value="fixed">Fixed</option>
                </select>
              </label>
              <label>
                Min score
                <input
                  inputMode="decimal"
                  onChange={(event) => setMinScore(event.target.value)}
                  value={minScore}
                />
              </label>
              <label>
                Threshold
                <input
                  inputMode="decimal"
                  onChange={(event) => setThreshold(event.target.value)}
                  value={threshold}
                />
              </label>
              <label>
                Lexical gate
                <input
                  inputMode="decimal"
                  onChange={(event) => setMinLexicalOverlap(event.target.value)}
                  value={minLexicalOverlap}
                />
              </label>
              <label>
                Initial top-K
                <input
                  inputMode="numeric"
                  onChange={(event) => setInitialTopK(event.target.value)}
                  value={initialTopK}
                />
              </label>
              <label>
                Final top-K
                <input
                  inputMode="numeric"
                  onChange={(event) => setFinalTopK(event.target.value)}
                  value={finalTopK}
                />
              </label>
            </div>
            <label className="rag-check">
              <input
                checked={useRewrite}
                onChange={(event) => setUseRewrite(event.target.checked)}
                type="checkbox"
              />
              Query rewrite
            </label>
            <button className="run" disabled={queryLoading} type="submit">
              {queryLoading ? "Answering..." : "Answer with citations"}
            </button>
            {error && <p className="rag-error">{error}</p>}
          </form>

          <section className="rag-panel">
            <div className="card-head">
              <h2>Grounded answer</h2>
              <span>{citedResult ? citedResult.status : "pending"}</span>
            </div>
            {citedResult ? (
              <div className="rag-answer-grid">
                <div className="rag-metrics">
                  <article>
                    <strong>{citedResult.topScore.toFixed(3)}</strong>
                    <span>top score</span>
                  </article>
                  <article>
                    <strong>{citedResult.minScore}</strong>
                    <span>min score</span>
                  </article>
                  <article>
                    <strong>{citedResult.minLexicalOverlap}</strong>
                    <span>lexical gate</span>
                  </article>
                  <article>
                    <strong>{citedResult.sources.length}</strong>
                    <span>sources</span>
                  </article>
                  <article>
                    <strong>{citedResult.citations.length}</strong>
                    <span>citations</span>
                  </article>
                </div>
                <article>
                  <h3>Answer</h3>
                  <pre>{citedResult.answer}</pre>
                </article>
                <details open>
                  <summary>Citations</summary>
                  {citedResult.citations.map((citation) => (
                    <div className="rag-citation" key={citation.id}>
                      <strong>
                        {citation.source} · {citation.section}
                      </strong>
                      <span>{citation.chunk_id}</span>
                      <p>{citation.quote}</p>
                    </div>
                  ))}
                </details>
              </div>
            ) : (
              <div className="empty">Run a cited answer to inspect grounding.</div>
            )}
          </section>
        </section>
      )}

      {activeStage === "day25" && (
        <section className="rag-tool-grid">
          <form className="rag-panel" onSubmit={runChatTurn}>
            <div className="card-head">
              <h2>RAG chat</h2>
              <span>{sessionId}</span>
            </div>
            {renderPipelineControls({ allowRebuild: true })}
            <div className="rag-control-grid">
              <label>
                Session
                <input
                  onChange={(event) => setSessionId(event.target.value)}
                  value={sessionId}
                />
              </label>
              <label>
                Strategy
                <select onChange={(event) => setStrategy(event.target.value)} value={strategy}>
                  <option value="structural">Structural</option>
                  <option value="fixed">Fixed</option>
                </select>
              </label>
              <label>
                Min score
                <input
                  inputMode="decimal"
                  onChange={(event) => setMinScore(event.target.value)}
                  value={minScore}
                />
              </label>
              <label>
                Threshold
                <input
                  inputMode="decimal"
                  onChange={(event) => setThreshold(event.target.value)}
                  value={threshold}
                />
              </label>
              <label>
                Lexical gate
                <input
                  inputMode="decimal"
                  onChange={(event) => setMinLexicalOverlap(event.target.value)}
                  value={minLexicalOverlap}
                />
              </label>
              <label>
                Initial top-K
                <input
                  inputMode="numeric"
                  onChange={(event) => setInitialTopK(event.target.value)}
                  value={initialTopK}
                />
              </label>
              <label>
                Final top-K
                <input
                  inputMode="numeric"
                  onChange={(event) => setFinalTopK(event.target.value)}
                  value={finalTopK}
                />
              </label>
            </div>
            <label className="rag-check">
              <input
                checked={useRewrite}
                onChange={(event) => setUseRewrite(event.target.checked)}
                type="checkbox"
              />
              Query rewrite
            </label>
            <label className="rag-textarea-label">
              Message
              <textarea
                onChange={(event) => setChatMessage(event.target.value)}
                rows={5}
                value={chatMessage}
              />
            </label>
            <button className="run" disabled={queryLoading || !chatMessage.trim()} type="submit">
              {queryLoading ? "Sending..." : "Send"}
            </button>
            {error && <p className="rag-error">{error}</p>}
          </form>

          <section className="rag-panel">
            <div className="card-head">
              <h2>Task memory</h2>
              <span>{chatResult ? `${chatResult.session.messages.length} messages` : "pending"}</span>
            </div>
            {chatResult ? (
              <div className="rag-answer-grid">
                <div className="rag-task-state">
                  <strong>Goal</strong>
                  <p>{chatResult.session.taskState.goal || "n/a"}</p>
                  <strong>Constraints</strong>
                  <p>{chatResult.session.taskState.constraints.join("; ") || "n/a"}</p>
                  <strong>Terms</strong>
                  <p>{chatResult.session.taskState.terms.join("; ") || "n/a"}</p>
                  <strong>Clarifications</strong>
                  <p>{chatResult.session.taskState.clarifications.join("; ") || "n/a"}</p>
                </div>
                <article>
                  <h3>Last answer</h3>
                  <pre>{chatResult.assistantMessage.content}</pre>
                </article>
                <div className="rag-metrics">
                  <article>
                    <strong>{chatResult.assistantMessage.sources.length}</strong>
                    <span>sources</span>
                  </article>
                  <article>
                    <strong>{chatResult.assistantMessage.citations.length}</strong>
                    <span>citations</span>
                  </article>
                  <article>
                    <strong>{chatResult.assistantMessage.status}</strong>
                    <span>status</span>
                  </article>
                </div>
                <details open>
                  <summary>Conversation</summary>
                  {chatResult.session.messages.map((message, index) => (
                    <div className="rag-chat-message" key={`${message.role}-${index}`}>
                      <strong>{message.role}</strong>
                      <pre>{message.content}</pre>
                    </div>
                  ))}
                </details>
              </div>
            ) : (
              <div className="empty">Send a message to start a RAG chat session.</div>
            )}
          </section>
        </section>
      )}
    </main>
  );
}
