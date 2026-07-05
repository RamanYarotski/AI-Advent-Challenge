import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_DATA_ROOT = path.join(process.cwd(), ".data", "rag-week");
export const DEFAULT_FIXED_TOKENS = 900;
export const DEFAULT_OVERLAP_TOKENS = 120;
export const DEFAULT_STRUCTURAL_TOKENS = 1200;
export const VECTOR_DIMENSIONS = 256;

const SUPPORTED_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".htm",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".pdf",
  ".ts",
  ".tsx",
  ".txt",
]);

const EXCLUDED_DIRS = new Set([
  ".data",
  ".git",
  ".next",
  "coverage",
  "node_modules",
]);

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function tokenBudgetToChars(tokens) {
  return Math.max(200, Number(tokens || 0) * 4);
}

function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function relativeSource(filePath, root = process.cwd()) {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function extensionOf(filePath) {
  return path.extname(filePath).toLowerCase();
}

function formatOf(filePath) {
  const ext = extensionOf(filePath);
  return ext ? ext.slice(1) : "text";
}

function defaultCorpusRoots(root = process.cwd()) {
  return [
    path.join(root, "README.md"),
    path.join(root, "docs"),
    path.join(root, "lib"),
    path.join(root, "app", "api"),
    path.join(root, "mcp"),
    path.join(root, "docs", "rag-week-chat-notes.md"),
  ];
}

export function ragPaths(dataRoot = DEFAULT_DATA_ROOT) {
  return {
    dataRoot,
    indexesDir: path.join(dataRoot, "indexes"),
    reportsDir: path.join(dataRoot, "reports"),
    manifest: path.join(dataRoot, "manifest.json"),
    day21Report: path.join(dataRoot, "reports", "day-21-indexing.md"),
    fixedIndex: path.join(dataRoot, "indexes", "fixed.json"),
    structuralIndex: path.join(dataRoot, "indexes", "structural.json"),
  };
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function stripHtml(raw) {
  return String(raw)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function flattenJson(value, prefix = "") {
  if (value === null || value === undefined) {
    return [];
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [`${prefix}${value}`];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenJson(item, `${prefix}[${index}] `));
  }
  if (typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) =>
      flattenJson(item, `${prefix}${key}: `),
    );
  }
  return [];
}

function csvToText(raw) {
  return String(raw)
    .split(/\r?\n/)
    .map((line, index) => `row ${index + 1}: ${line.split(",").join(" | ")}`)
    .join("\n");
}

function extractPdfTextFallback(buffer) {
  const raw = buffer.toString("latin1");
  const parenthesized = [...raw.matchAll(/\(([^()]{8,})\)/g)].map((match) => match[1]);
  const printableRuns = raw.match(/[ -~А-Яа-яЁё]{24,}/g) ?? [];
  return [...parenthesized, ...printableRuns]
    .map((text) => text.replace(/\\[rn]/g, " "))
    .join("\n");
}

async function readDocument(filePath) {
  const ext = extensionOf(filePath);
  const buffer = await readFile(filePath);
  if (ext === ".pdf") {
    return extractPdfTextFallback(buffer);
  }
  const raw = buffer.toString("utf8");
  if (ext === ".json") {
    try {
      return flattenJson(JSON.parse(raw)).join("\n");
    } catch {
      return raw;
    }
  }
  if (ext === ".csv") {
    return csvToText(raw);
  }
  if (ext === ".html" || ext === ".htm") {
    return stripHtml(raw);
  }
  return raw;
}

async function discoverFiles(entryPath) {
  if (!existsSync(entryPath)) {
    return [];
  }
  const info = await stat(entryPath);
  if (info.isFile()) {
    return SUPPORTED_EXTENSIONS.has(extensionOf(entryPath)) ? [entryPath] : [];
  }
  if (!info.isDirectory()) {
    return [];
  }
  const entries = await readdir(entryPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) {
      continue;
    }
    files.push(...(await discoverFiles(path.join(entryPath, entry.name))));
  }
  return files;
}

export async function loadDocuments(input = {}) {
  const root = path.resolve(input.root || process.cwd());
  const corpusRoots = ensureArray(input.corpusRoots).length
    ? input.corpusRoots.map((item) => path.resolve(root, item))
    : defaultCorpusRoots(root);
  const files = [];
  for (const corpusRoot of corpusRoots) {
    files.push(...(await discoverFiles(corpusRoot)));
  }

  const uniqueFiles = [...new Set(files)].sort((a, b) => a.localeCompare(b));
  const documents = [];
  for (const filePath of uniqueFiles) {
    const rawText = await readDocument(filePath);
    const text = normalizeWhitespace(rawText);
    if (text.length < 80) {
      continue;
    }
    documents.push({
      id: relativeSource(filePath, root),
      source: relativeSource(filePath, root),
      title: path.basename(filePath),
      format: formatOf(filePath),
      text,
      charCount: text.length,
      estimatedTokens: Math.ceil(text.length / 4),
    });
  }

  return {
    root,
    corpusRoots: corpusRoots.map((item) => relativeSource(item, root)),
    documents,
  };
}

function sectionTitleFromMarkdown(line) {
  const match = /^(#{1,6})\s+(.+)$/.exec(line.trim());
  return match ? match[2].trim() : null;
}

function pushChunk(chunks, document, strategy, section, text, index) {
  const content = normalizeWhitespace(text);
  if (!content) {
    return index;
  }
  const chunkId = `${strategy}:${document.id}:${index}`;
  chunks.push({
    id: chunkId,
    text: content,
    metadata: {
      source: document.source,
      title: document.title,
      format: document.format,
      section: section || document.title,
      chunk_id: chunkId,
      strategy,
    },
    charCount: content.length,
    estimatedTokens: Math.ceil(content.length / 4),
  });
  return index + 1;
}

function fixedChunks(documents, options = {}) {
  const maxChars = tokenBudgetToChars(options.fixedTokens ?? DEFAULT_FIXED_TOKENS);
  const overlapChars = Math.min(
    Math.max(0, tokenBudgetToChars(options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS)),
    Math.floor(maxChars / 2),
  );
  const chunks = [];
  for (const document of documents) {
    let index = 0;
    let start = 0;
    while (start < document.text.length) {
      const end = Math.min(document.text.length, start + maxChars);
      index = pushChunk(
        chunks,
        document,
        "fixed",
        `${document.title} chars ${start}-${end}`,
        document.text.slice(start, end),
        index,
      );
      if (end >= document.text.length) {
        break;
      }
      start = Math.max(end - overlapChars, start + 1);
    }
  }
  return chunks;
}

function structuralChunks(documents, options = {}) {
  const maxChars = tokenBudgetToChars(options.maxStructuralTokens ?? DEFAULT_STRUCTURAL_TOKENS);
  const chunks = [];
  for (const document of documents) {
    const lines = document.text.split(/\n|\.\s+/);
    let section = document.title;
    let buffer = [];
    let index = 0;

    for (const line of lines) {
      const title = sectionTitleFromMarkdown(line);
      const candidate = normalizeWhitespace(line);
      if (title && buffer.length) {
        index = pushChunk(chunks, document, "structural", section, buffer.join(" "), index);
        buffer = [];
      }
      if (title) {
        section = title;
      }
      if (!candidate) {
        continue;
      }
      const next = normalizeWhitespace([...buffer, candidate].join(" "));
      if (next.length > maxChars && buffer.length) {
        index = pushChunk(chunks, document, "structural", section, buffer.join(" "), index);
        buffer = [candidate];
      } else {
        buffer.push(candidate);
      }
    }
    if (buffer.length) {
      pushChunk(chunks, document, "structural", section, buffer.join(" "), index);
    }
  }
  return chunks;
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
}

function hashWord(word) {
  let hash = 2166136261;
  for (let index = 0; index < word.length; index += 1) {
    hash ^= word.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function embedTextLocal(text) {
  const vector = Array.from({ length: VECTOR_DIMENSIONS }, () => 0);
  for (const token of tokenize(text)) {
    const hash = hashWord(token);
    const slot = hash % VECTOR_DIMENSIONS;
    vector[slot] += 1 + Math.min(token.length, 12) / 12;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

async function embedTexts(texts, options = {}) {
  const mode = options.embeddingMode || "local_hash";
  if (mode !== "api") {
    return {
      provider: "local_hash",
      dimensions: VECTOR_DIMENSIONS,
      vectors: texts.map(embedTextLocal),
      warning: null,
    };
  }

  const apiKey = process.env.OPENAI_COMPATIBLE_API_KEY;
  const baseUrl =
    process.env.OPENAI_COMPATIBLE_BASE_URL?.replace(/\/$/, "") ||
    "https://openrouter.ai/api/v1";
  const model = process.env.EMBEDDING_MODEL || "text-embedding-3-small";

  if (!apiKey) {
    return {
      provider: "local_hash",
      dimensions: VECTOR_DIMENSIONS,
      vectors: texts.map(embedTextLocal),
      warning: "OPENAI_COMPATIBLE_API_KEY is missing; used local hash embeddings.",
    };
  }

  try {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input: texts }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload.data)) {
      throw new Error(payload.error?.message || `Embedding API returned ${response.status}.`);
    }
    const vectors = payload.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
    return {
      provider: `api:${model}`,
      dimensions: vectors[0]?.length ?? 0,
      vectors,
      warning: null,
    };
  } catch (error) {
    return {
      provider: "local_hash",
      dimensions: VECTOR_DIMENSIONS,
      vectors: texts.map(embedTextLocal),
      warning: `Embedding API failed (${error.message}); used local hash embeddings.`,
    };
  }
}

export async function buildIndex(input = {}) {
  const startedAt = performance.now();
  const dataRoot = path.resolve(input.dataRoot || DEFAULT_DATA_ROOT);
  const strategy = input.strategy === "structural" ? "structural" : "fixed";
  const loaded = await loadDocuments(input);
  const chunks =
    strategy === "structural"
      ? structuralChunks(loaded.documents, input)
      : fixedChunks(loaded.documents, input);
  const embedding = await embedTexts(
    chunks.map((chunk) => `${chunk.metadata.title}\n${chunk.metadata.section}\n${chunk.text}`),
    input,
  );
  const index = {
    id: makeId(`day21-${strategy}`),
    strategy,
    root: loaded.root,
    corpusRoots: loaded.corpusRoots,
    embedding: {
      provider: embedding.provider,
      dimensions: embedding.dimensions,
      warning: embedding.warning,
    },
    parameters: {
      fixedTokens: Number(input.fixedTokens ?? DEFAULT_FIXED_TOKENS),
      overlapTokens: Number(input.overlapTokens ?? DEFAULT_OVERLAP_TOKENS),
      maxStructuralTokens: Number(input.maxStructuralTokens ?? DEFAULT_STRUCTURAL_TOKENS),
    },
    documents: loaded.documents.map(({ text, ...document }) => document),
    chunks: chunks.map((chunk, indexNumber) => ({
      ...chunk,
      embedding: embedding.vectors[indexNumber],
    })),
    stats: {
      documentCount: loaded.documents.length,
      chunkCount: chunks.length,
      totalDocumentTokens: loaded.documents.reduce(
        (sum, document) => sum + document.estimatedTokens,
        0,
      ),
      averageChunkTokens:
        chunks.length === 0
          ? 0
          : Math.round(
              chunks.reduce((sum, chunk) => sum + chunk.estimatedTokens, 0) / chunks.length,
            ),
      elapsedMs: Math.round(performance.now() - startedAt),
    },
    createdAt: nowIso(),
  };
  const paths = ragPaths(dataRoot);
  await mkdir(paths.indexesDir, { recursive: true });
  await writeJsonFile(strategy === "structural" ? paths.structuralIndex : paths.fixedIndex, index);
  return index;
}

function compareIndexes(fixed, structural) {
  return {
    fixedChunks: fixed.stats.chunkCount,
    structuralChunks: structural.stats.chunkCount,
    fixedAverageTokens: fixed.stats.averageChunkTokens,
    structuralAverageTokens: structural.stats.averageChunkTokens,
    documentCount: Math.max(fixed.stats.documentCount, structural.stats.documentCount),
    recommendation:
      structural.stats.chunkCount <= fixed.stats.chunkCount
        ? "Structural chunking keeps file and section boundaries cleaner for source-aware answers."
        : "Fixed chunking gives smaller, more uniform retrieval units for broad scans.",
  };
}

function renderDay21Report({ fixed, structural, comparison, paths }) {
  const warnings = [fixed.embedding.warning, structural.embedding.warning].filter(Boolean);
  return [
    "# Day 21. Document Indexing",
    "",
    "## Result",
    "",
    `- Documents indexed: ${comparison.documentCount}`,
    `- Fixed chunks: ${comparison.fixedChunks}`,
    `- Structural chunks: ${comparison.structuralChunks}`,
    `- Fixed average chunk tokens: ${comparison.fixedAverageTokens}`,
    `- Structural average chunk tokens: ${comparison.structuralAverageTokens}`,
    `- Embeddings: ${fixed.embedding.provider}`,
    `- Saved fixed index: ${paths.fixedIndex}`,
    `- Saved structural index: ${paths.structuralIndex}`,
    "",
    "## Chunking Comparison",
    "",
    comparison.recommendation,
    "",
    "## Formats",
    "",
    ...[...new Set(fixed.documents.map((document) => document.format))]
      .sort()
      .map((format) => `- ${format}`),
    "",
    "## Metadata",
    "",
    "Each chunk stores source, title/file, format, section, chunk_id, and strategy.",
    "",
    ...(warnings.length ? ["## Warnings", "", ...warnings.map((warning) => `- ${warning}`), ""] : []),
  ].join("\n");
}

export async function runDay21Indexing(input = {}) {
  const dataRoot = path.resolve(input.dataRoot || DEFAULT_DATA_ROOT);
  const paths = ragPaths(dataRoot);
  const fixed = await buildIndex({ ...input, dataRoot, strategy: "fixed" });
  const structural = await buildIndex({ ...input, dataRoot, strategy: "structural" });
  const comparison = compareIndexes(fixed, structural);
  const reportMarkdown = renderDay21Report({ fixed, structural, comparison, paths });
  await mkdir(paths.reportsDir, { recursive: true });
  await writeFile(paths.day21Report, reportMarkdown, "utf8");
  const manifest = {
    dataRoot,
    latestIndexes: {
      fixed: paths.fixedIndex,
      structural: paths.structuralIndex,
    },
    latestReports: {
      day21: paths.day21Report,
    },
    day21: {
      fixed: fixed.stats,
      structural: structural.stats,
      comparison,
      embeddingProvider: fixed.embedding.provider,
      updatedAt: nowIso(),
    },
  };
  await writeJsonFile(paths.manifest, manifest);
  return {
    fixed,
    structural,
    comparison,
    reportPath: paths.day21Report,
    manifestPath: paths.manifest,
  };
}

export async function getRagStatus(input = {}) {
  const dataRoot = path.resolve(input.dataRoot || DEFAULT_DATA_ROOT);
  const paths = ragPaths(dataRoot);
  return {
    dataRoot,
    paths,
    manifest: await readJsonFile(paths.manifest, null),
    checkedAt: nowIso(),
  };
}

