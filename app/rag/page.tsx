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

export default function RagWeekPage() {
  const [status, setStatus] = useState<RagStatus | null>(null);
  const [result, setResult] = useState<IndexResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fixedTokens, setFixedTokens] = useState("900");
  const [overlapTokens, setOverlapTokens] = useState("120");
  const [maxStructuralTokens, setMaxStructuralTokens] = useState("1200");
  const [embeddingMode, setEmbeddingMode] = useState("local_hash");

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
        <button className="active" type="button">
          Day 21 Indexer
        </button>
        <button disabled type="button">
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
    </main>
  );
}
