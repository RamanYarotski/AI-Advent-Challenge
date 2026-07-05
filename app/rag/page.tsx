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

export default function RagWeekPage() {
  const [activeStage, setActiveStage] = useState<"day21" | "day22">("day21");
  const [status, setStatus] = useState<RagStatus | null>(null);
  const [result, setResult] = useState<IndexResult | null>(null);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [queryLoading, setQueryLoading] = useState(false);
  const [fixedTokens, setFixedTokens] = useState("900");
  const [overlapTokens, setOverlapTokens] = useState("120");
  const [maxStructuralTokens, setMaxStructuralTokens] = useState("1200");
  const [embeddingMode, setEmbeddingMode] = useState("local_hash");
  const [question, setQuestion] = useState(
    "Что должен делать RAG ассистент при слабом контексте?",
  );
  const [strategy, setStrategy] = useState("structural");
  const [topK, setTopK] = useState("8");
  const [generationMode, setGenerationMode] = useState("local");

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

  const latest = result?.comparison ?? status?.manifest?.day21?.comparison ?? null;

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
        <button disabled type="button">
          Day 23 Filter
        </button>
        <button disabled type="button">
          Day 24 Citations
        </button>
        <button disabled type="button">
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
    </main>
  );
}
