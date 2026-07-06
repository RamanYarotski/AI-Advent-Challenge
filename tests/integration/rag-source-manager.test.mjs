import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "vitest";

import { loadDocuments, runDay21Indexing } from "../../lib/rag/core.mjs";
import { readRagArtifact } from "../../lib/rag/artifacts.mjs";
import { readSourceState, resetRagData, writeSourceState } from "../../lib/rag/source-manager.mjs";

const cleanupDirs = [];

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

test("local source discovery reports missing and empty source warnings", async () => {
  const root = await makeTempDir("rag-local-");
  await mkdir(path.join(root, "empty"), { recursive: true });

  const loaded = await loadDocuments({
    root,
    useSourceManager: false,
    sourceInputs: ["missing", "empty"],
  });

  assert.deepEqual(loaded.documents, []);
  assert.deepEqual(loaded.sourceSummaries, [
    {
      input: "missing",
      type: "local_path",
      documentCount: 0,
      warning: "Path not found.",
    },
    {
      input: "empty",
      type: "local_path",
      documentCount: 0,
      warning: "No supported documents found.",
    },
  ]);
  assert.deepEqual(loaded.warnings, [
    "missing: Path not found.",
    "empty: No supported documents found.",
  ]);
});

test("sourcesText remains supported by the backend", async () => {
  const root = await makeTempDir("rag-sources-text-");
  await writeFile(
    path.join(root, "notes.md"),
    "sourcesText compatibility fixture is intentionally long enough for document loading.".repeat(2),
    "utf8",
  );

  const loaded = await loadDocuments({
    root,
    useSourceManager: false,
    sourcesText: "notes.md",
  });

  assert.deepEqual(loaded.sourceInputs, ["notes.md"]);
  assert.equal(loaded.documents.length, 1);
});

test("empty source manager state does not materialize demo rows but CLI fallback still works", async () => {
  const root = await makeTempDir("rag-default-fallback-root-");
  const dataRoot = await makeTempDir("rag-default-fallback-data-");
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(
    path.join(root, "README.md"),
    "Default fallback README fixture is intentionally long enough to become an indexed document.".repeat(2),
    "utf8",
  );
  await writeFile(
    path.join(root, "docs", "guide.md"),
    "Default fallback docs fixture is intentionally long enough to become an indexed document.".repeat(2),
    "utf8",
  );

  const state = await readSourceState(dataRoot);
  assert.deepEqual(state.sources, []);

  const loaded = await loadDocuments({
    root,
    dataRoot,
    useSourceManager: false,
  });

  assert.deepEqual(loaded.sourceInputs, [
    "README.md",
    "docs",
    "lib",
    "app/api",
    "mcp",
    "docs/rag-week-chat-notes.md",
  ]);
  assert.equal(loaded.documents.length, 2);
});

test("legacy default source rows are hidden from source manager state", async () => {
  const dataRoot = await makeTempDir("rag-legacy-default-sources-");
  await writeSourceState(dataRoot, [
    {
      id: "default-README-md",
      type: "local_path",
      label: "README.md",
      value: "README.md",
      metadata: { default: true },
    },
    {
      id: "source-user-doc",
      type: "local_path",
      label: "User doc",
      value: "user-doc.md",
    },
  ]);

  const state = await readSourceState(dataRoot);

  assert.deepEqual(
    state.sources.map((source) => source.value),
    ["user-doc.md"],
  );
});

test("site crawl fetches only same-origin links when network is mocked", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const pageText = "same origin rag source content ".repeat(8);
  const pages = new Map([
    [
      "https://docs.example.test/",
      `<html><head><title>Home</title></head><body>${pageText}<a href="/guide">Guide</a><a href="https://outside.example.test/secret">External</a></body></html>`,
    ],
    [
      "https://docs.example.test/guide",
      `<html><head><title>Guide</title></head><body>${pageText}<a href="/">Home</a></body></html>`,
    ],
  ]);

  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    const body = pages.get(url);
    assert.ok(body, `unexpected fetch: ${url}`);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/html",
        "content-length": String(Buffer.byteLength(body)),
      },
    });
  };

  try {
    const loaded = await loadDocuments({
      useSourceManager: false,
      sourceInputs: [{ input: "https://docs.example.test/", type: "site" }],
      siteMaxDepth: 1,
      siteMaxPages: 10,
    });

    assert.deepEqual(calls, ["https://docs.example.test/", "https://docs.example.test/guide"]);
    assert.equal(loaded.documents.length, 2);
    assert.deepEqual(
      loaded.documents.map((document) => document.source),
      ["https://docs.example.test/", "https://docs.example.test/guide"],
    );
    assert.deepEqual(loaded.warnings, []);
    assert.deepEqual(loaded.sourceSummaries, [
      {
        input: "https://docs.example.test/",
        type: "site",
        documentCount: 2,
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub repo ingestion respects mocked API and githubMaxFiles", async () => {
  const originalFetch = globalThis.fetch;
  const rawFetches = [];
  const longText = "github source manager fixture content ".repeat(8);

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://api.github.com/repos/acme/rag") {
      return new Response(JSON.stringify({ default_branch: "main" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === "https://api.github.com/repos/acme/rag/git/trees/main?recursive=1") {
      return new Response(
        JSON.stringify({
          tree: [
            { type: "blob", path: "README.md" },
            { type: "blob", path: "docs/guide.md" },
            { type: "blob", path: "src/tool.ts" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.startsWith("https://raw.githubusercontent.com/acme/rag/main/")) {
      rawFetches.push(url);
      return new Response(longText, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    const loaded = await loadDocuments({
      useSourceManager: false,
      sourceInputs: [{ input: "https://github.com/acme/rag", type: "github" }],
      githubMaxFiles: 2,
    });

    assert.equal(rawFetches.length, 2);
    assert.equal(loaded.documents.length, 2);
    assert.deepEqual(loaded.sourceSummaries, [
      {
        input: "https://github.com/acme/rag",
        type: "github",
        documentCount: 2,
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runDay21Indexing uses managed sources with an isolated dataRoot", async () => {
  const root = await makeTempDir("rag-day21-root-");
  const dataRoot = await makeTempDir("rag-day21-data-");
  await mkdir(path.join(root, "content"), { recursive: true });
  await writeFile(
    path.join(root, "content", "guide.md"),
    [
      "# Managed Source",
      "",
      "This fixture document is intentionally long enough to be indexed by both chunking strategies.",
      "It describes source manager indexing, status updates, document counts, and local hash embeddings.",
      "The smoke test keeps the data root isolated from the developer workspace.",
    ].join("\n"),
    "utf8",
  );
  await writeSourceState(dataRoot, [
    {
      id: "source-content",
      type: "local_path",
      label: "Fixture content",
      value: "content",
    },
  ]);

  const result = await runDay21Indexing({
    root,
    dataRoot,
    fixedTokens: 30,
    overlapTokens: 5,
    maxStructuralTokens: 60,
    embeddingMode: "local_hash",
  });

  assert.equal(result.fixed.stats.documentCount, 1);
  assert.ok(result.fixed.stats.chunkCount > 0);
  assert.equal(result.structural.stats.documentCount, 1);
  assert.ok(result.structural.stats.chunkCount > 0);
  assert.deepEqual(result.fixed.sourceInputs, ["content"]);
  assert.deepEqual(result.fixed.sourceSummaries, [
    {
      input: "content",
      type: "local_path",
      documentCount: 1,
    },
  ]);

  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
  assert.equal(manifest.dataRoot, dataRoot);
  assert.equal(manifest.day21.comparison.documentCount, 1);
  assert.deepEqual(manifest.day21.warnings, []);

  const sourceState = await readSourceState(dataRoot, { withoutDefaults: true });
  assert.equal(sourceState.sources.length, 1);
  assert.equal(sourceState.sources[0].status, "indexed");
  assert.equal(sourceState.sources[0].documentCount, 1);
  assert.ok(sourceState.sources[0].lastIndexedAt);
});

test("artifact reader serves only allowlisted RAG files", async () => {
  const root = await makeTempDir("rag-artifact-root-");
  const dataRoot = await makeTempDir("rag-artifact-data-");
  await writeFile(
    path.join(root, "README.md"),
    "Artifact fixture content is long enough to become an indexed document for report checks.".repeat(2),
    "utf8",
  );

  await runDay21Indexing({
    root,
    dataRoot,
    useSourceManager: false,
    sourceInputs: ["README.md"],
    fixedTokens: 30,
    overlapTokens: 5,
    maxStructuralTokens: 60,
  });

  const report = await readRagArtifact({ dataRoot, key: "day21_report" });
  assert.equal(report.label, "Report");
  assert.match(report.content, /Day 21/);

  const fixed = await readRagArtifact({ dataRoot, key: "fixed_index" });
  assert.equal(fixed.fileName, "fixed-index.json");
  assert.equal(JSON.parse(fixed.content).strategy, "fixed");

  await assert.rejects(
    () => readRagArtifact({ dataRoot, key: "../manifest.json" }),
    /Unknown RAG artifact/,
  );
});

test("resetRagData clears generated data and leaves source manager empty", async () => {
  const dataRoot = await makeTempDir("rag-reset-");
  await mkdir(path.join(dataRoot, "indexes"), { recursive: true });
  await mkdir(path.join(dataRoot, "uploads", "batch"), { recursive: true });
  await writeFile(path.join(dataRoot, "manifest.json"), "{}", "utf8");
  await writeFile(path.join(dataRoot, "indexes", "fixed.json"), "{}", "utf8");
  await writeSourceState(dataRoot, [
    {
      id: "source-custom",
      type: "local_path",
      label: "Custom",
      value: "custom",
    },
  ]);

  const result = await resetRagData({ dataRoot });

  assert.deepEqual(result.state.sources, []);
  await assert.rejects(() => readFile(path.join(dataRoot, "manifest.json"), "utf8"));
  await assert.rejects(() => readFile(path.join(dataRoot, "indexes", "fixed.json"), "utf8"));
});
