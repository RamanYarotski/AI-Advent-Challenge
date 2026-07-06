import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { enabledSourceEntries, markSourcesIndexed } from "./source-manager.mjs";

export const DEFAULT_DATA_ROOT = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  ".data",
  "rag-week",
);
export const DEFAULT_FIXED_TOKENS = 900;
export const DEFAULT_OVERLAP_TOKENS = 120;
export const DEFAULT_STRUCTURAL_TOKENS = 1200;
export const DEFAULT_RAG_TOP_K = 8;
export const DEFAULT_RERANK_INITIAL_TOP_K = 15;
export const DEFAULT_RERANK_FINAL_TOP_K = 5;
export const DEFAULT_LOCAL_THRESHOLD = 0.24;
export const DEFAULT_ANSWER_THRESHOLD = 0.24;
export const DEFAULT_MIN_LEXICAL_OVERLAP = 0.08;
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
  ".mdx",
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

export function sanitizeExtractedText(text) {
  return String(text || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, " ")
    .replace(/\uFFFD/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isReadableExtractedText(text) {
  const normalized = normalizeWhitespace(sanitizeExtractedText(text));
  if (normalized.length < 80) {
    return false;
  }
  if (/^%PDF-\d/.test(normalized)) {
    return false;
  }
  const chars = [...normalized];
  const readableChars = chars.filter((char) => /[\p{L}\p{N}\p{P}\p{Zs}\s]/u.test(char)).length;
  const expectedChars = chars.filter((char) =>
    /[\p{Script=Latin}\p{Script=Cyrillic}\p{N}\s.,:;!?'"`“”«»()[\]{}<>/@#%&+=*$~_^|\\-]/u.test(
      char,
    ),
  ).length;
  const unusualChars = chars.filter((char) => !/[\x09\x0A\x0D\x20-\x7EА-Яа-яЁё“”«»№–—]/u.test(char)).length;
  const words = normalized.match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  const spaces = normalized.match(/\s/g)?.length ?? 0;
  const readableRatio = readableChars / Math.max(1, chars.length);
  const expectedRatio = expectedChars / Math.max(1, chars.length);
  const unusualRatio = unusualChars / Math.max(1, chars.length);
  const spaceRatio = spaces / Math.max(1, chars.length);
  return (
    readableRatio >= 0.92 &&
    expectedRatio >= 0.75 &&
    unusualRatio <= 0.08 &&
    words.length >= 12 &&
    spaceRatio >= 0.03
  );
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function relativeSource(filePath, root = /*turbopackIgnore: true*/ process.cwd()) {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function extensionOf(filePath) {
  return path.extname(filePath).toLowerCase();
}

function formatOf(filePath) {
  const ext = extensionOf(filePath);
  return ext ? ext.slice(1) : "text";
}

function defaultCorpusRoots(root = /*turbopackIgnore: true*/ process.cwd()) {
  return [
    path.join(root, "README.md"),
    path.join(root, "docs"),
    path.join(root, "lib"),
    path.join(root, "app", "api"),
    path.join(root, "mcp"),
    path.join(root, "docs", "rag-week-chat-notes.md"),
  ];
}

function defaultSourceInputs(root = /*turbopackIgnore: true*/ process.cwd()) {
  return defaultCorpusRoots(root).map((item) => relativeSource(item, root));
}

function manualSourceEntriesFrom(input, root = /*turbopackIgnore: true*/ process.cwd()) {
  const toEntry = (item) => {
    if (typeof item === "object" && item?.input) {
      return {
        input: String(item.input).trim(),
        type: item.type ? String(item.type).trim() : inferSourceType(item.input),
      };
    }
    if (typeof item === "object" && item?.value) {
      return {
        input: String(item.value).trim(),
        type: item.type ? String(item.type).trim() : inferSourceType(item.value),
      };
    }
    const value = String(item).trim();
    return { input: value, type: inferSourceType(value) };
  };
  if (Array.isArray(input.sourceInputs) && input.sourceInputs.length) {
    return input.sourceInputs.map(toEntry).filter((entry) => entry.input);
  }
  if (typeof input.sourcesText === "string" && input.sourcesText.trim()) {
    return input.sourcesText
      .split(/\r?\n/)
      .map(toEntry)
      .filter((entry) => entry.input);
  }
  if (Array.isArray(input.corpusRoots) && input.corpusRoots.length) {
    return input.corpusRoots.map(toEntry).filter((entry) => entry.input);
  }
  return [];
}

function inferSourceType(value) {
  if (isGithubUrl(value)) {
    return "github";
  }
  if (isHttpUrl(value)) {
    return "url";
  }
  return "local_path";
}

async function sourceEntriesFrom(input, root = /*turbopackIgnore: true*/ process.cwd()) {
  const manualEntries = manualSourceEntriesFrom(input, root);
  const managedEntries =
    input.useSourceManager === false
      ? []
      : await enabledSourceEntries({
          dataRoot: path.resolve(input.dataRoot || DEFAULT_DATA_ROOT),
        }).catch(() => []);
  const entries = [...managedEntries, ...manualEntries].filter((entry) => entry.input);
  const unique = [];
  const seen = new Set();
  for (const entry of entries) {
    const key = `${entry.type || inferSourceType(entry.input)}:${entry.input}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push({
      input: entry.input,
      type: entry.type || inferSourceType(entry.input),
      id: entry.id || null,
      label: entry.label || entry.input,
    });
  }
  if (unique.length) {
    return unique;
  }
  return defaultSourceInputs(root).map((value) => ({ input: value, type: inferSourceType(value) }));
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function isGithubUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname.toLowerCase() === "github.com";
  } catch {
    return false;
  }
}

function normalizeGithubUrl(value) {
  const url = new URL(value);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`GitHub URL must include owner and repo: ${value}`);
  }
  const [owner, repo, mode, branch, ...rest] = parts;
  return {
    owner,
    repo: repo.replace(/\.git$/i, ""),
    mode: mode || "repo",
    branch: branch || null,
    path: rest.join("/"),
    original: value,
  };
}

export function ragPaths(dataRoot = DEFAULT_DATA_ROOT) {
  return {
    dataRoot,
    indexesDir: path.join(dataRoot, "indexes"),
    reportsDir: path.join(dataRoot, "reports"),
    manifest: path.join(dataRoot, "manifest.json"),
    day21Report: path.join(dataRoot, "reports", "day-21-indexing.md"),
    day22Report: path.join(dataRoot, "reports", "day-22-rag-query.md"),
    day23Report: path.join(dataRoot, "reports", "day-23-rerank-filter.md"),
    day24Report: path.join(dataRoot, "reports", "day-24-citations.md"),
    day25Report: path.join(dataRoot, "reports", "day-25-rag-chat.md"),
    day22Evaluation: path.join(dataRoot, "evaluations", "day-22.json"),
    day23Evaluation: path.join(dataRoot, "evaluations", "day-23.json"),
    day24Evaluation: path.join(dataRoot, "evaluations", "day-24.json"),
    day25Evaluation: path.join(dataRoot, "evaluations", "day-25.json"),
    chatsDir: path.join(dataRoot, "chats"),
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

function titleFromHtml(raw, fallback) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(raw));
  return normalizeWhitespace(match?.[1] || fallback);
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

export async function extractPdfTextFromBuffer(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const text = sanitizeExtractedText(result.text || "");
    if (!isReadableExtractedText(text)) {
      throw new Error("PDF text extraction produced unreadable text.");
    }
    return text;
  } catch (error) {
    const fallbackText = sanitizeExtractedText(extractPdfTextFallback(buffer));
    const diagnostic = isReadableExtractedText(fallbackText)
      ? " Legacy fallback looked readable but is disabled."
      : "";
    throw new Error(`${error.message}${diagnostic}`);
  } finally {
    await parser.destroy();
  }
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
    return extractPdfTextFromBuffer(buffer);
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

function virtualFormatFromUrl(sourceUrl, contentType = "") {
  const ext = extensionOf(new URL(sourceUrl).pathname);
  if (SUPPORTED_EXTENSIONS.has(ext)) {
    return ext.slice(1);
  }
  if (contentType.includes("html")) {
    return "html";
  }
  if (contentType.includes("json")) {
    return "json";
  }
  if (contentType.includes("csv")) {
    return "csv";
  }
  if (contentType.includes("pdf")) {
    return "pdf";
  }
  return "txt";
}

function normalizeVirtualText(raw, format) {
  if (format === "html" || format === "htm") {
    return stripHtml(raw);
  }
  if (format === "json") {
    try {
      return flattenJson(JSON.parse(raw)).join("\n");
    } catch {
      return raw;
    }
  }
  if (format === "csv") {
    return csvToText(raw);
  }
  return raw;
}

async function fetchTextDocument(sourceUrl, sourceType = "url", options = {}) {
  const response = await fetch(sourceUrl, {
    headers: {
      Accept: "application/pdf,text/html,text/plain,application/json,text/csv,*/*",
      "User-Agent": "AI-Advent-RAG-Toolkit",
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const contentType = response.headers.get("content-type") || "";
  const maxBytes = Number(options.maxBytes || 0);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (maxBytes && contentLength > maxBytes) {
    throw new Error(`Document is larger than ${maxBytes} bytes.`);
  }
  const format = virtualFormatFromUrl(sourceUrl, contentType);
  if (format === "pdf") {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (maxBytes && buffer.byteLength > maxBytes) {
      throw new Error(`Document is larger than ${maxBytes} bytes.`);
    }
    const text = normalizeWhitespace(await extractPdfTextFromBuffer(buffer));
    return {
      id: sourceUrl,
      source: sourceUrl,
      sourceType,
      title: path.basename(new URL(sourceUrl).pathname) || sourceUrl,
      format,
      text,
      charCount: text.length,
      estimatedTokens: Math.ceil(text.length / 4),
    };
  }
  const rawBody = await response.text();
  const raw = maxBytes && rawBody.length > maxBytes ? rawBody.slice(0, maxBytes) : rawBody;
  const text = normalizeWhitespace(normalizeVirtualText(raw, format));
  const title =
    format === "html"
      ? titleFromHtml(raw, new URL(sourceUrl).pathname)
      : path.basename(new URL(sourceUrl).pathname) || sourceUrl;
  return {
    id: sourceUrl,
    source: sourceUrl,
    sourceType,
    title,
    format,
    text,
    charCount: text.length,
    estimatedTokens: Math.ceil(text.length / 4),
  };
}

function linksFromHtml(raw, baseUrl) {
  const links = [];
  for (const match of String(raw).matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const next = new URL(match[1], baseUrl);
      next.hash = "";
      if (next.protocol === "http:" || next.protocol === "https:") {
        links.push(next.toString());
      }
    } catch {
      // Ignore malformed page links.
    }
  }
  return [...new Set(links)];
}

async function fetchSiteDocuments(sourceUrl, options = {}) {
  const maxDepth = Math.max(0, Math.min(2, Number(options.siteMaxDepth ?? 1)));
  const maxPages = Math.max(1, Math.min(50, Number(options.siteMaxPages ?? 20)));
  const maxBytesPerPage = Math.max(10_000, Number(options.siteMaxBytesPerPage ?? 1_000_000));
  const origin = new URL(sourceUrl).origin;
  const queue = [{ url: sourceUrl, depth: 0 }];
  const seen = new Set();
  const documents = [];

  while (queue.length && documents.length < maxPages) {
    const current = queue.shift();
    if (!current || seen.has(current.url)) {
      continue;
    }
    seen.add(current.url);
    const response = await fetch(current.url, {
      headers: {
        Accept: "application/pdf,text/html,text/plain,application/json,text/csv,*/*",
        "User-Agent": "AI-Advent-RAG-Toolkit",
      },
    });
    if (!response.ok) {
      continue;
    }
    const contentType = response.headers.get("content-type") || "";
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > maxBytesPerPage) {
      continue;
    }
    const format = virtualFormatFromUrl(current.url, contentType);
    if (format === "pdf") {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > maxBytesPerPage) {
        continue;
      }
      const text = normalizeWhitespace(await extractPdfTextFromBuffer(buffer));
      if (isReadableExtractedText(text)) {
        documents.push({
          id: current.url,
          source: current.url,
          sourceType: "site",
          title: path.basename(new URL(current.url).pathname) || current.url,
          format,
          text,
          charCount: text.length,
          estimatedTokens: Math.ceil(text.length / 4),
        });
      }
      continue;
    }
    const rawBody = await response.text();
    const raw = rawBody.length > maxBytesPerPage ? rawBody.slice(0, maxBytesPerPage) : rawBody;
    const text = normalizeWhitespace(normalizeVirtualText(raw, format));
    if (isReadableExtractedText(text)) {
      documents.push({
        id: current.url,
        source: current.url,
        sourceType: "site",
        title: format === "html" ? titleFromHtml(raw, new URL(current.url).pathname) : current.url,
        format,
        text,
        charCount: text.length,
        estimatedTokens: Math.ceil(text.length / 4),
      });
    }
    if (current.depth >= maxDepth || !contentType.includes("html")) {
      continue;
    }
    for (const link of linksFromHtml(raw, current.url)) {
      if (new URL(link).origin === origin && !seen.has(link) && queue.length < maxPages * 2) {
        queue.push({ url: link, depth: current.depth + 1 });
      }
    }
  }

  return documents;
}

function rawGithubUrl({ owner, repo, branch, path: repoPath }) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${repoPath}`;
}

async function fetchGithubDefaultBranch(owner, repo) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "AI-Advent-RAG-Toolkit",
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  return payload.default_branch || "main";
}

async function fetchGithubTree(owner, repo, branch) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "AI-Advent-RAG-Toolkit",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  return Array.isArray(payload.tree) ? payload.tree : [];
}

async function fetchGithubDocuments(sourceInput, options = {}) {
  const github = normalizeGithubUrl(sourceInput);
  const branch = github.branch || (await fetchGithubDefaultBranch(github.owner, github.repo));
  if (github.mode === "blob") {
    const rawUrl = rawGithubUrl({ ...github, branch });
    const document = await fetchTextDocument(rawUrl, "github_raw");
    return [
      {
        ...document,
        id: `${github.owner}/${github.repo}/${branch}/${github.path}`,
        source: sourceInput,
        title: github.path ? path.basename(github.path) : document.title,
      },
    ];
  }

  const prefix = github.mode === "tree" && github.path ? `${github.path.replace(/\/$/, "")}/` : "";
  const tree = await fetchGithubTree(github.owner, github.repo, branch);
  const maxFiles = Math.max(1, Math.min(500, Number(options.githubMaxFiles ?? options.maxFiles ?? 120)));
  const files = tree
    .filter((item) => item.type === "blob")
    .map((item) => item.path)
    .filter((repoPath) => (!prefix || repoPath.startsWith(prefix)) && SUPPORTED_EXTENSIONS.has(extensionOf(repoPath)))
    .slice(0, maxFiles);

  const documents = [];
  for (const repoPath of files) {
    try {
      const rawUrl = rawGithubUrl({
        owner: github.owner,
        repo: github.repo,
        branch,
        path: repoPath,
      });
      const document = await fetchTextDocument(rawUrl, "github_raw");
      if (document.text.length >= 80) {
        documents.push({
          ...document,
          id: `${github.owner}/${github.repo}/${branch}/${repoPath}`,
          source: `${sourceInput}#${repoPath}`,
          title: repoPath,
        });
      }
    } catch {
      // Per-file GitHub fetch failures should not make the whole source unusable.
    }
  }
  return documents;
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
  const root = path.resolve(input.root || /*turbopackIgnore: true*/ process.cwd());
  const sourceEntries = await sourceEntriesFrom(input, root);
  const sourceInputs = sourceEntries.map((entry) => entry.input);
  const corpusRoots = sourceEntries
    .filter((entry) => !isHttpUrl(entry.input))
    .map((entry) => ({
      entry,
      rootPath: path.resolve(root, entry.input),
    }));
  const filesBySourceType = new Map();
  const filesBySourceInput = new Map();
  const sourceSummaryByInput = new Map();
  const discoveredCountByInput = new Map();
  const sourceSummaries = [];
  const warnings = [];
  for (const source of corpusRoots) {
    const corpusRoot = source.rootPath;
    const exists = existsSync(corpusRoot);
    const discovered = await discoverFiles(corpusRoot);
    const warning = !exists
      ? "Path not found."
      : discovered.length === 0
        ? "No supported documents found."
        : undefined;
    if (warning) {
      warnings.push(`${source.entry.input}: ${warning}`);
    }
    const summary = {
      input: source.entry.input,
      type: source.entry.type === "upload" ? "upload" : "local_path",
      documentCount: 0,
      ...(warning ? { warning } : {}),
    };
    sourceSummaries.push(summary);
    sourceSummaryByInput.set(source.entry.input, summary);
    discoveredCountByInput.set(source.entry.input, discovered.length);
    for (const filePath of discovered) {
      if (!filesBySourceType.has(filePath)) {
        filesBySourceType.set(filePath, source.entry.type === "upload" ? "upload" : "local_path");
        filesBySourceInput.set(filePath, source.entry.input);
      }
    }
  }

  const uniqueFiles = [...filesBySourceType.keys()].sort((a, b) => a.localeCompare(b));
  const documents = [];
  for (const filePath of uniqueFiles) {
    const sourceInput = filesBySourceInput.get(filePath) || relativeSource(filePath, root);
    let rawText = "";
    try {
      rawText = await readDocument(filePath);
    } catch (error) {
      const warning = `${relativeSource(filePath, root)}: ${error.message}`;
      warnings.push(`${sourceInput}: ${warning}`);
      const summary = sourceSummaryByInput.get(sourceInput);
      if (summary && !summary.warning) {
        summary.warning = warning;
      }
      continue;
    }
    const text = normalizeWhitespace(rawText);
    if (!isReadableExtractedText(text)) {
      const warning = `${relativeSource(filePath, root)}: Unreadable extracted text.`;
      warnings.push(`${sourceInput}: ${warning}`);
      const summary = sourceSummaryByInput.get(sourceInput);
      if (summary && !summary.warning) {
        summary.warning = warning;
      }
      continue;
    }
    const summary = sourceSummaryByInput.get(sourceInput);
    if (summary) {
      summary.documentCount += 1;
    }
    documents.push({
      id: relativeSource(filePath, root),
      source: relativeSource(filePath, root),
      sourceType: filesBySourceType.get(filePath) || "local_path",
      title: path.basename(filePath),
      format: formatOf(filePath),
      text,
      charCount: text.length,
      estimatedTokens: Math.ceil(text.length / 4),
    });
  }
  for (const [sourceInput, discoveredCount] of discoveredCountByInput) {
    const summary = sourceSummaryByInput.get(sourceInput);
    if (summary && discoveredCount > 0 && summary.documentCount === 0 && !summary.warning) {
      const warning = "No readable text extracted.";
      summary.warning = warning;
      warnings.push(`${sourceInput}: ${warning}`);
    }
  }

  for (const sourceEntry of sourceEntries.filter((entry) => isHttpUrl(entry.input))) {
    const sourceInput = sourceEntry.input;
    const sourceType = sourceEntry.type || inferSourceType(sourceInput);
    try {
      const fetchedDocuments =
        sourceType === "github" || isGithubUrl(sourceInput)
          ? await fetchGithubDocuments(sourceInput, input)
          : sourceType === "site"
            ? await fetchSiteDocuments(sourceInput, input)
            : [await fetchTextDocument(sourceInput, sourceType)];
      const usableDocuments = fetchedDocuments.filter((document) => isReadableExtractedText(document.text));
      const warning = usableDocuments.length ? undefined : "No readable documents found.";
      if (warning) {
        warnings.push(`${sourceInput}: ${warning}`);
      }
      sourceSummaries.push({
        input: sourceInput,
        type: sourceType === "github" || isGithubUrl(sourceInput) ? "github" : sourceType,
        documentCount: usableDocuments.length,
        ...(warning ? { warning } : {}),
      });
      documents.push(...usableDocuments);
    } catch (error) {
      warnings.push(`${sourceInput}: ${error.message}`);
      sourceSummaries.push({
        input: sourceInput,
        type: sourceType === "github" || isGithubUrl(sourceInput) ? "github" : sourceType,
        documentCount: 0,
        warning: error.message,
      });
    }
  }

  return {
    root,
    sourceInputs,
    sourceSummaries,
    warnings,
    corpusRoots: corpusRoots.map((item) => relativeSource(item.rootPath, root)),
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
    .replace(/ё/g, "е")
    .match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "and",
  "are",
  "for",
  "from",
  "how",
  "the",
  "what",
  "when",
  "where",
  "which",
  "with",
  "или",
  "без",
  "где",
  "для",
  "как",
  "какая",
  "какие",
  "какой",
  "кто",
  "над",
  "при",
  "про",
  "что",
  "это",
]);

function meaningfulTokens(text) {
  return tokenize(text).filter((token) => !STOP_WORDS.has(token) && (token.length > 2 || token === "ии"));
}

function stemToken(token) {
  if (token === "ии" || token.length <= 4) {
    return token;
  }
  return token.replace(
    /(иями|ями|ами|ого|его|ому|ему|ыми|ими|ией|иям|ием|иях|ая|яя|ое|ее|ые|ие|ый|ий|ой|ую|юю|ых|их|ам|ям|ах|ях|ом|ем|ия|ие|а|я|ы|и|у|ю|е|о|й|ь)$/u,
    "",
  );
}

function tokenVariants(token) {
  const variants = new Set([token, stemToken(token)]);
  if (token === "ии" || token === "ai") {
    variants.add("искусственн");
    variants.add("интеллект");
    variants.add("artificial");
    variants.add("intelligence");
  }
  if (["ввел", "ввели", "введен", "введена", "введено", "введены"].includes(token)) {
    variants.add("введ");
    variants.add("предлож");
    variants.add("основан");
  }
  return [...variants].filter(Boolean);
}

function lexicalOverlap(question, text) {
  const questionTokens = [...new Set(meaningfulTokens(question))];
  if (!questionTokens.length) {
    return 0;
  }
  const textTokens = new Set(meaningfulTokens(text).flatMap(tokenVariants));
  const overlap = questionTokens.filter((token) =>
    tokenVariants(token).some((variant) => textTokens.has(variant)),
  ).length;
  return overlap / questionTokens.length;
}

function hasPersonLikeName(text) {
  return /[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}/u.test(
    text,
  );
}

function isWhoQuestion(question) {
  return /\bwho\b|(^|\s)кто(\s|$)/iu.test(question);
}

function looksLikeReferenceText(text) {
  const urls = text.match(/https?:\/\//g)?.length ?? 0;
  const referenceMarkers = text.match(/ISBN|Архивировано|Дата обращения|archive\.org|Retrieved/giu)?.length ?? 0;
  return urls >= 2 || (urls >= 1 && referenceMarkers >= 1) || referenceMarkers >= 3;
}

function subtopicPenalty(question, text) {
  const query = question.toLowerCase().replace(/ё/g, "е");
  const haystack = text.toLowerCase().replace(/ё/g, "е");
  let penalty = 0;
  if (
    !/\bstrong\b|сильн/u.test(query) &&
    /сильн[\p{L}\p{N}_-]*\s+искусственн|strong\s+artificial/u.test(haystack)
  ) {
    penalty += 0.16;
  }
  if (
    !/\bweak\b|слаб/u.test(query) &&
    /слаб[\p{L}\p{N}_-]*\s+искусственн|weak\s+artificial/u.test(haystack)
  ) {
    penalty += 0.12;
  }
  return penalty;
}

function hybridRetrievalScore(question, chunk, semanticScore) {
  const searchText = `${chunk.metadata?.title || ""} ${chunk.metadata?.section || ""} ${chunk.text}`;
  const lexicalScore = lexicalOverlap(
    question,
    searchText,
  );
  const whoNameBonus = isWhoQuestion(question) && hasPersonLikeName(searchText) ? 0.08 : 0;
  const penalty = subtopicPenalty(question, searchText);
  return {
    lexicalScore,
    score: Math.max(0, Math.min(1, semanticScore * 0.7 + lexicalScore * 0.3 + whoNameBonus - penalty)),
  };
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

export function cosineSimilarity(a, b) {
  const length = Math.min(a?.length ?? 0, b?.length ?? 0);
  if (!length) {
    return 0;
  }
  let dot = 0;
  let aMagnitude = 0;
  let bMagnitude = 0;
  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    aMagnitude += a[index] * a[index];
    bMagnitude += b[index] * b[index];
  }
  const denominator = Math.sqrt(aMagnitude) * Math.sqrt(bMagnitude);
  return denominator ? dot / denominator : 0;
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
    sourceInputs: loaded.sourceInputs,
    sourceSummaries: loaded.sourceSummaries,
    warnings: loaded.warnings,
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
  const warnings = [
    fixed.embedding.warning,
    structural.embedding.warning,
    ...(fixed.warnings || []),
    ...(structural.warnings || []),
  ].filter(Boolean);
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
    "## Sources",
    "",
    ...fixed.sourceSummaries.map(
      (source) =>
        `- ${source.type}: ${source.input} (${source.documentCount} document(s)${
          source.warning ? `; warning: ${source.warning}` : ""
        })`,
    ),
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
      sourceInputs: fixed.sourceInputs,
      sourceSummaries: fixed.sourceSummaries,
      warnings: [...new Set([...(fixed.warnings || []), ...(structural.warnings || [])])],
      updatedAt: nowIso(),
    },
  };
  await writeJsonFile(paths.manifest, manifest);
  await markSourcesIndexed({
    dataRoot,
    sourceSummaries: fixed.sourceSummaries,
  }).catch(() => {});
  return {
    fixed,
    structural,
    comparison,
    reportPath: paths.day21Report,
    manifestPath: paths.manifest,
  };
}

export async function loadRagIndex(input = {}) {
  const dataRoot = path.resolve(input.dataRoot || DEFAULT_DATA_ROOT);
  const paths = ragPaths(dataRoot);
  const strategy = input.strategy === "fixed" ? "fixed" : "structural";
  const filePath = strategy === "fixed" ? paths.fixedIndex : paths.structuralIndex;
  const index = await readJsonFile(filePath, null);
  if (!index) {
    await runDay21Indexing({ ...input, dataRoot });
    return readJsonFile(filePath, null);
  }
  return index;
}

export async function searchRelevantChunks(input = {}) {
  const question = normalizeWhitespace(input.question);
  if (!question) {
    throw new Error("Question is required.");
  }
  if (input.rebuildIndex === true) {
    await runDay21Indexing(input);
  }
  const index = await loadRagIndex(input);
  const queryVector = embedTextLocal(question);
  const topK = Math.max(1, Math.min(50, Number(input.topK ?? DEFAULT_RAG_TOP_K)));
  const matches = index.chunks
    .map((chunk) => {
      const semanticScore = cosineSimilarity(queryVector, chunk.embedding);
      const { lexicalScore, score } = hybridRetrievalScore(question, chunk, semanticScore);
      return {
        id: chunk.id,
        text: chunk.text,
        metadata: chunk.metadata,
        score,
        semanticScore,
        lexicalScore,
        estimatedTokens: chunk.estimatedTokens,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return {
    question,
    strategy: index.strategy,
    topK,
    embeddingProvider: index.embedding.provider,
    matches,
    searchedAt: nowIso(),
  };
}

function renderContext(matches) {
  return matches
    .map((match) => ({ match, text: readableMatchText(match) }))
    .filter((item) => item.text)
    .map(
      ({ match, text }, index) =>
        `[${index + 1}] source=${match.metadata.source} section=${match.metadata.section} chunk=${match.metadata.chunk_id} score=${match.score.toFixed(3)}\n${text}`,
    )
    .join("\n\n");
}

function loadDotEnv(root = /*turbopackIgnore: true*/ process.cwd()) {
  const envPath = path.join(root, ".env.local");
  if (!existsSync(envPath)) {
    return;
  }
  const raw = existsSync(envPath) ? readFile(envPath, "utf8") : null;
  return raw
    .then((content) => {
      for (const line of content.split(/\r?\n/)) {
        const match = /^([A-Z0-9_]+)=(.*)$/i.exec(line.trim());
        if (match && !process.env[match[1]]) {
          process.env[match[1]] = match[2];
        }
      }
    })
    .catch(() => undefined);
}

async function callChatCompletion(input = {}) {
  await loadDotEnv();
  const apiKey = process.env.OPENAI_COMPATIBLE_API_KEY;
  const baseUrl =
    process.env.OPENAI_COMPATIBLE_BASE_URL?.replace(/\/$/, "") ||
    "https://openrouter.ai/api/v1";
  const model = input.model || process.env.DEFAULT_MODEL;
  if (!apiKey || !model) {
    throw new Error("LLM provider is not configured.");
  }
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "AI Advent RAG Toolkit",
    },
    body: JSON.stringify({
      model,
      messages: input.messages,
      temperature: input.temperature ?? 0.2,
      max_tokens: input.maxTokens ?? 700,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `LLM provider returned ${response.status}.`);
  }
  return {
    answer: payload.choices?.[0]?.message?.content || payload.choices?.[0]?.text || "",
    model,
    elapsedMs: Math.round(performance.now() - startedAt),
    usage: payload.usage ?? null,
  };
}

function readableMatchText(match) {
  const text = normalizeWhitespace(sanitizeExtractedText(match?.text || ""));
  return isReadableExtractedText(text) ? text : null;
}

function excerptWindows(text, maxChars = 700, stride = 350) {
  if (text.length <= maxChars) {
    return [{ start: 0, text }];
  }
  const windows = [];
  for (let start = 0; start < text.length; start += stride) {
    const previousSpace = text.lastIndexOf(" ", start);
    const adjustedStart = start === 0 || previousSpace < start - 80 ? start : previousSpace + 1;
    windows.push({
      start: adjustedStart,
      text: text.slice(adjustedStart, adjustedStart + maxChars),
    });
    if (start + maxChars >= text.length) {
      break;
    }
  }
  return windows;
}

function selectExtractiveLead(question, readableMatches) {
  let best = {
    match: readableMatches[0].match,
    text: readableMatches[0].text.slice(0, 700),
    score: Number.NEGATIVE_INFINITY,
  };
  const whoQuestion = isWhoQuestion(question);
  readableMatches.forEach((item, matchIndex) => {
    for (const window of excerptWindows(item.text)) {
      let score = lexicalOverlap(question, window.text);
      if (whoQuestion && hasPersonLikeName(window.text)) {
        score += 0.25;
      }
      if (looksLikeReferenceText(window.text)) {
        score -= 0.35;
      }
      score -= subtopicPenalty(question, window.text);
      score += Math.max(0, 0.05 - matchIndex * 0.005);
      if (score > best.score) {
        best = {
          match: item.match,
          text: window.text.trim(),
          score,
        };
      }
    }
  });
  return best;
}

function localAnswer(question, matches) {
  const readableMatches = matches
    .map((match) => ({ match, text: readableMatchText(match) }))
    .filter((item) => item.text);
  if (!readableMatches.length) {
    return "Без контекста из индекса ответ не может быть проверен.";
  }
  const lead = selectExtractiveLead(question, readableMatches);
  const citationItems = [
    lead,
    ...readableMatches.filter((item) => item.match.id !== lead.match.id),
  ].slice(0, 3);
  const citations = citationItems.map(({ match, text }, index) => {
    const excerpt = text.slice(0, 260);
    return `${index + 1}. ${match.metadata.source} (${match.metadata.section}): ${excerpt}`;
  });
  return [
    `Вопрос: ${question}`,
    "",
    "Ответ на основе найденных чанков:",
    lead.text.slice(0, 700),
    "",
    "Опорные фрагменты:",
    ...citations,
  ].join("\n");
}

async function answerQuestion(input = {}) {
  const generationMode = input.generationMode || "local";
  const question = normalizeWhitespace(input.question);
  const matches = ensureArray(input.matches);
  if (generationMode !== "llm") {
    return {
      answer: localAnswer(question, matches),
      mode: "local",
      model: "local-extractive",
      elapsedMs: 0,
      usage: null,
      warning: null,
    };
  }

  try {
    const context = renderContext(matches);
    const result = await callChatCompletion({
      ...input,
      messages: [
        {
          role: "system",
          content:
            "You are a RAG assistant. Answer only from the provided context. Mention relevant sources when possible.",
        },
        {
          role: "user",
          content: context
            ? `Question:\n${question}\n\nContext:\n${context}`
            : `Question:\n${question}`,
        },
      ],
    });
    return {
      ...result,
      mode: "llm",
      warning: null,
    };
  } catch (error) {
    return {
      answer: localAnswer(question, matches),
      mode: "local",
      model: "local-extractive",
      elapsedMs: 0,
      usage: null,
      warning: `LLM answer failed (${error.message}); used local extractive answer.`,
    };
  }
}

export async function runRagQuery(input = {}) {
  const question = normalizeWhitespace(input.question);
  const search = await searchRelevantChunks(input);
  const ragAnswer = await answerQuestion({
    ...input,
    question,
    matches: search.matches,
  });
  const plainAnswer = await answerQuestion({
    ...input,
    question,
    matches: [],
    generationMode: input.generationMode === "llm" ? "llm" : "local",
  });
  return {
    question,
    strategy: search.strategy,
    topK: search.topK,
    plain: plainAnswer,
    rag: ragAnswer,
    matches: search.matches,
    comparedAt: nowIso(),
  };
}

export const DAY22_CONTROL_QUESTIONS = [
  {
    question: "Какие две стратегии chunking реализованы для Day 21?",
    expected: "fixed-size chunking and structural chunking",
    expectedSources: ["docs/day-21.md", "docs/rag-week-chat-notes.md"],
  },
  {
    question: "Какие metadata поля должен иметь каждый chunk?",
    expected: "source, title/file, section, chunk_id and strategy",
    expectedSources: ["docs/day-21.md"],
  },
  {
    question: "Что должен делать RAG ассистент при слабом контексте?",
    expected: "say не знаю instead of falling back to a general answer",
    expectedSources: ["docs/rag-week-chat-notes.md"],
  },
  {
    question: "Какая задача Day 22 поверх индекса?",
    expected: "question -> relevant chunks -> prompt with context -> answer",
    expectedSources: ["docs/rag-week-chat-notes.md"],
  },
  {
    question: "Какая задача Day 25 связана с памятью?",
    expected: "history and task state memory with goal, constraints, terms and clarifications",
    expectedSources: ["docs/rag-week-chat-notes.md"],
  },
  {
    question: "Где сохраняется fixed index?",
    expected: ".data/rag-week/indexes/fixed.json",
    expectedSources: ["docs/day-21.md"],
  },
  {
    question: "Какой default top-K используется для первого RAG-запроса?",
    expected: "8",
    expectedSources: ["docs/day-22.md"],
  },
  {
    question: "Почему выбран отдельный RAG project вместо продолжения грязного Day 20?",
    expected: "to avoid mixing unfinished Day 20 changes with RAG week work",
    expectedSources: ["docs/rag-week-chat-notes.md"],
  },
  {
    question: "Какие форматы документов поддерживает indexer?",
    expected: "Markdown, text, JSON, CSV, HTML, code and PDF fallback",
    expectedSources: ["docs/day-21.md"],
  },
  {
    question: "Какие источники используются в корпусе по умолчанию?",
    expected: "project docs/code plus curated chat notes",
    expectedSources: ["docs/day-21.md"],
  },
];

function renderDay22Report(evaluation) {
  return [
    "# Day 22. First RAG Query",
    "",
    "## Result",
    "",
    `- Questions: ${evaluation.results.length}`,
    `- Strategy: ${evaluation.strategy}`,
    `- topK: ${evaluation.topK}`,
    `- Generation mode: ${evaluation.generationMode}`,
    "",
    "## Comparison",
    "",
    "Each control question stores a plain answer without retrieved context and a RAG answer grounded in retrieved chunks.",
    "",
    "## Control Questions",
    "",
    ...evaluation.results.flatMap((item, index) => [
      `### ${index + 1}. ${item.question}`,
      "",
      `Expected: ${item.expected}`,
      "",
      `Top source: ${item.matches[0]?.metadata?.source ?? "n/a"}`,
      `Top score: ${item.matches[0]?.score?.toFixed(3) ?? "n/a"}`,
      "",
      "Plain answer:",
      "",
      item.plain.answer.slice(0, 700),
      "",
      "RAG answer:",
      "",
      item.rag.answer.slice(0, 900),
      "",
    ]),
  ].join("\n");
}

export async function runDay22Evaluation(input = {}) {
  const dataRoot = path.resolve(input.dataRoot || DEFAULT_DATA_ROOT);
  const paths = ragPaths(dataRoot);
  await loadRagIndex({ ...input, dataRoot });
  const topK = Math.max(1, Math.min(50, Number(input.topK ?? DEFAULT_RAG_TOP_K)));
  const strategy = input.strategy === "fixed" ? "fixed" : "structural";
  const generationMode = input.generationMode || "local";
  const results = [];
  for (const item of DAY22_CONTROL_QUESTIONS) {
    const result = await runRagQuery({
      ...input,
      dataRoot,
      strategy,
      topK,
      generationMode,
      question: item.question,
    });
    results.push({
      ...item,
      ...result,
    });
  }
  const evaluation = {
    id: makeId("day22-eval"),
    strategy,
    topK,
    generationMode,
    results,
    savedAt: nowIso(),
  };
  await mkdir(path.dirname(paths.day22Evaluation), { recursive: true });
  await writeJsonFile(paths.day22Evaluation, evaluation);
  await mkdir(paths.reportsDir, { recursive: true });
  await writeFile(paths.day22Report, renderDay22Report(evaluation), "utf8");

  const manifest = await readJsonFile(paths.manifest, { dataRoot });
  manifest.latestReports = {
    ...(manifest.latestReports || {}),
    day22: paths.day22Report,
  };
  manifest.day22 = {
    strategy,
    topK,
    generationMode,
    questionCount: results.length,
    reportPath: paths.day22Report,
    evaluationPath: paths.day22Evaluation,
    updatedAt: nowIso(),
  };
  await writeJsonFile(paths.manifest, manifest);

  return {
    evaluation,
    reportPath: paths.day22Report,
    evaluationPath: paths.day22Evaluation,
  };
}

export function rewriteQuery(question) {
  const normalized = normalizeWhitespace(question);
  const lower = normalized.toLowerCase();
  const expansions = [];
  if (
    /раг|rag|индекс|эмбед|embedding|retrieval|поиск|релевант/i.test(normalized)
  ) {
    expansions.push("source metadata chunk section index embeddings retrieval");
  }
  if (lower.includes("стратег") || lower.includes("strategy")) {
    expansions.push("strategy fixed structural chunking");
  }
  if (lower.includes("источник") || lower.includes("source")) {
    expansions.push("sources citations source metadata section chunk_id");
  }
  if (lower.includes("памят") || lower.includes("memory")) {
    expansions.push("history task state goal constraints clarifications terms");
  }
  if (lower.includes("chunk") || lower.includes("чанк")) {
    expansions.push("fixed structural chunking overlap tokens");
  }
  if (lower.includes("threshold") || lower.includes("порог") || lower.includes("слаб")) {
    expansions.push("threshold relevance score не знаю weak context");
  }
  return [...new Set([normalized, ...expansions].filter(Boolean))].join(" ");
}

function chunkVector(match) {
  return embedTextLocal(
    `${match.metadata?.source ?? ""} ${match.metadata?.section ?? ""} ${match.text ?? ""}`,
  );
}

function mmrRerank(question, matches, finalTopK, diversity = 0.32) {
  const queryVector = embedTextLocal(question);
  const candidates = matches.map((match) => ({
    ...match,
    vector: chunkVector(match),
  }));
  const selected = [];
  const remaining = [...candidates];
  while (selected.length < finalTopK && remaining.length) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const relevance = cosineSimilarity(queryVector, candidate.vector);
      const redundancy = selected.length
        ? Math.max(
            ...selected.map((selectedItem) =>
              cosineSimilarity(candidate.vector, selectedItem.vector),
            ),
          )
        : 0;
      const rerankScore = (1 - diversity) * relevance - diversity * redundancy;
      if (rerankScore > bestScore) {
        bestScore = rerankScore;
        bestIndex = index;
      }
    }
    const [next] = remaining.splice(bestIndex, 1);
    selected.push({
      ...next,
      rerankScore: Number(bestScore.toFixed(6)),
      vector: undefined,
    });
  }
  return selected;
}

export async function runRerankQuery(input = {}) {
  const question = normalizeWhitespace(input.question);
  if (!question) {
    throw new Error("Question is required.");
  }
  const useRewrite = input.useRewrite !== false;
  const rewrittenQuestion = useRewrite ? rewriteQuery(question) : question;
  const initialTopK = Math.max(
    1,
    Math.min(50, Number(input.initialTopK ?? DEFAULT_RERANK_INITIAL_TOP_K)),
  );
  const finalTopK = Math.max(
    1,
    Math.min(initialTopK, Number(input.finalTopK ?? DEFAULT_RERANK_FINAL_TOP_K)),
  );
  const threshold = Number(input.threshold ?? DEFAULT_LOCAL_THRESHOLD);
  const initial = await searchRelevantChunks({
    ...input,
    question: rewrittenQuestion,
    topK: initialTopK,
  });
  const filtered = initial.matches.filter((match) => match.score >= threshold);
  const reranked = mmrRerank(rewrittenQuestion, filtered, finalTopK);
  const baseline = initial.matches.slice(0, finalTopK);
  const answer = await answerQuestion({
    ...input,
    question,
    matches: reranked,
    generationMode: input.generationMode || "local",
  });
  return {
    question,
    rewrittenQuestion,
    useRewrite,
    strategy: initial.strategy,
    parameters: {
      initialTopK,
      finalTopK,
      threshold,
    },
    baseline,
    filtered,
    reranked,
    answer,
    comparedAt: nowIso(),
  };
}

function renderDay23Report(evaluation) {
  return [
    "# Day 23. Reranking and Filtering",
    "",
    "## Result",
    "",
    `- Questions: ${evaluation.results.length}`,
    `- Strategy: ${evaluation.strategy}`,
    `- Initial top-K: ${evaluation.initialTopK}`,
    `- Final top-K: ${evaluation.finalTopK}`,
    `- Threshold: ${evaluation.threshold}`,
    `- Query rewrite: ${evaluation.useRewrite ? "on" : "off"}`,
    "",
    "## Comparison",
    "",
    "Each result stores baseline top-K, threshold-filtered chunks, and the final MMR-reranked context.",
    "",
    ...evaluation.results.flatMap((item, index) => [
      `### ${index + 1}. ${item.question}`,
      "",
      `Baseline chunks: ${item.baseline.length}`,
      `After filter: ${item.filtered.length}`,
      `After rerank: ${item.reranked.length}`,
      `Top reranked source: ${item.reranked[0]?.metadata?.source ?? "n/a"}`,
      `Top reranked score: ${item.reranked[0]?.score?.toFixed(3) ?? "n/a"}`,
      "",
    ]),
  ].join("\n");
}

export async function runDay23Evaluation(input = {}) {
  const dataRoot = path.resolve(input.dataRoot || DEFAULT_DATA_ROOT);
  const paths = ragPaths(dataRoot);
  await loadRagIndex({ ...input, dataRoot });
  const strategy = input.strategy === "fixed" ? "fixed" : "structural";
  const initialTopK = Math.max(
    1,
    Math.min(50, Number(input.initialTopK ?? DEFAULT_RERANK_INITIAL_TOP_K)),
  );
  const finalTopK = Math.max(
    1,
    Math.min(initialTopK, Number(input.finalTopK ?? DEFAULT_RERANK_FINAL_TOP_K)),
  );
  const threshold = Number(input.threshold ?? DEFAULT_LOCAL_THRESHOLD);
  const useRewrite = input.useRewrite !== false;
  const results = [];
  for (const item of DAY22_CONTROL_QUESTIONS) {
    const result = await runRerankQuery({
      ...input,
      dataRoot,
      strategy,
      initialTopK,
      finalTopK,
      threshold,
      useRewrite,
      question: item.question,
      generationMode: input.generationMode || "local",
    });
    results.push({
      ...item,
      ...result,
    });
  }
  const evaluation = {
    id: makeId("day23-eval"),
    strategy,
    initialTopK,
    finalTopK,
    threshold,
    useRewrite,
    results,
    savedAt: nowIso(),
  };
  await mkdir(path.dirname(paths.day23Evaluation), { recursive: true });
  await writeJsonFile(paths.day23Evaluation, evaluation);
  await mkdir(paths.reportsDir, { recursive: true });
  await writeFile(paths.day23Report, renderDay23Report(evaluation), "utf8");

  const manifest = await readJsonFile(paths.manifest, { dataRoot });
  manifest.latestReports = {
    ...(manifest.latestReports || {}),
    day23: paths.day23Report,
  };
  manifest.day23 = {
    strategy,
    initialTopK,
    finalTopK,
    threshold,
    useRewrite,
    questionCount: results.length,
    reportPath: paths.day23Report,
    evaluationPath: paths.day23Evaluation,
    updatedAt: nowIso(),
  };
  await writeJsonFile(paths.manifest, manifest);

  return {
    evaluation,
    reportPath: paths.day23Report,
    evaluationPath: paths.day23Evaluation,
  };
}

function citationFromMatch(match, index) {
  const quote = normalizeWhitespace(match.text).slice(0, 360);
  return {
    id: `citation-${index + 1}`,
    source: match.metadata.source,
    section: match.metadata.section,
    chunk_id: match.metadata.chunk_id,
    score: Number(match.score.toFixed(6)),
    quote,
  };
}

function renderCitedLocalAnswer(question, citations) {
  if (!citations.length) {
    return "не знаю. В индексе нет достаточно релевантного контекста; уточните вопрос или добавьте источник.";
  }
  return [
    `На основе найденных источников: ${question}`,
    "",
    citations[0].quote,
    "",
    "Источники:",
    ...citations.map(
      (citation, index) =>
        `[${index + 1}] ${citation.source} / ${citation.section} / ${citation.chunk_id}`,
    ),
  ].join("\n");
}

export async function runCitedAnswer(input = {}) {
  const minScore = Number(input.minScore ?? DEFAULT_ANSWER_THRESHOLD);
  const minLexicalOverlap = Number(input.minLexicalOverlap ?? DEFAULT_MIN_LEXICAL_OVERLAP);
  const result = await runRerankQuery({
    ...input,
    threshold: Number(input.threshold ?? minScore),
    finalTopK: Number(input.finalTopK ?? DEFAULT_RERANK_FINAL_TOP_K),
    generationMode: "local",
  });
  const supportedMatches = result.reranked
    .map((match) => ({
      ...match,
      lexicalOverlap: lexicalOverlap(
        result.question,
        `${match.metadata.source} ${match.metadata.section} ${match.text}`,
      ),
    }))
    .filter((match) => match.score >= minScore && match.lexicalOverlap >= minLexicalOverlap);
  const topScore = result.reranked[0]?.score ?? 0;
  const hasContext = supportedMatches.length > 0;
  if (!hasContext) {
    return {
      question: result.question,
      status: "unknown",
      answer:
        "не знаю. В индексе нет достаточно релевантного контекста; уточните вопрос или добавьте источник.",
      sources: [],
      citations: [],
      topScore,
      minScore,
      minLexicalOverlap,
      retrieval: result,
      answeredAt: nowIso(),
    };
  }
  const citations = supportedMatches.map(citationFromMatch);
  const sources = citations.map((citation) => ({
    source: citation.source,
    section: citation.section,
    chunk_id: citation.chunk_id,
    score: citation.score,
  }));
  return {
    question: result.question,
    status: "answered",
    answer: renderCitedLocalAnswer(result.question, citations),
    sources,
    citations,
    topScore,
    minScore,
    minLexicalOverlap,
    retrieval: result,
    answeredAt: nowIso(),
  };
}

function renderDay24Report(evaluation) {
  return [
    "# Day 24. Citations, Sources, and Anti-Hallucination",
    "",
    "## Result",
    "",
    `- Questions: ${evaluation.results.length}`,
    `- Minimum relevance score: ${evaluation.minScore}`,
    `- Minimum lexical overlap: ${evaluation.minLexicalOverlap}`,
    `- Answers with citations: ${
      evaluation.results.filter((item) => item.status === "answered").length
    }`,
    `- Unknown answers: ${evaluation.results.filter((item) => item.status === "unknown").length}`,
    "",
    "## Checks",
    "",
    "- Every answered item contains sources.",
    "- Every answered item contains citations.",
    "- Weak context returns `не знаю` instead of a general model fallback.",
    "",
    ...evaluation.results.flatMap((item, index) => [
      `### ${index + 1}. ${item.question}`,
      "",
      `Status: ${item.status}`,
      `Top score: ${item.topScore.toFixed(3)}`,
      `Sources: ${item.sources.length}`,
      `Citations: ${item.citations.length}`,
      "",
      item.answer.slice(0, 900),
      "",
    ]),
  ].join("\n");
}

export async function runDay24Evaluation(input = {}) {
  const dataRoot = path.resolve(input.dataRoot || DEFAULT_DATA_ROOT);
  const paths = ragPaths(dataRoot);
  await loadRagIndex({ ...input, dataRoot });
  const minScore = Number(input.minScore ?? DEFAULT_ANSWER_THRESHOLD);
  const minLexicalOverlap = Number(input.minLexicalOverlap ?? DEFAULT_MIN_LEXICAL_OVERLAP);
  const questions = DAY22_CONTROL_QUESTIONS.map((item) => item.question);
  const negativeQuestion = "Как зовут домашних питомцев пользователя и сколько им лет?";
  const results = [];
  for (const question of questions) {
    results.push(
      await runCitedAnswer({
        ...input,
        dataRoot,
        question,
        minScore,
        minLexicalOverlap,
      }),
    );
  }
  const negative = await runCitedAnswer({
    ...input,
    dataRoot,
    question: negativeQuestion,
    minScore,
    minLexicalOverlap,
  });
  const evaluation = {
    id: makeId("day24-eval"),
    minScore,
    minLexicalOverlap,
    results,
    negative,
    savedAt: nowIso(),
  };
  await mkdir(path.dirname(paths.day24Evaluation), { recursive: true });
  await writeJsonFile(paths.day24Evaluation, evaluation);
  await mkdir(paths.reportsDir, { recursive: true });
  await writeFile(
    paths.day24Report,
    renderDay24Report({
      ...evaluation,
      results: [...results, negative],
    }),
    "utf8",
  );

  const manifest = await readJsonFile(paths.manifest, { dataRoot });
  manifest.latestReports = {
    ...(manifest.latestReports || {}),
    day24: paths.day24Report,
  };
  manifest.day24 = {
    minScore,
    minLexicalOverlap,
    questionCount: results.length,
    negativeStatus: negative.status,
    reportPath: paths.day24Report,
    evaluationPath: paths.day24Evaluation,
    updatedAt: nowIso(),
  };
  await writeJsonFile(paths.manifest, manifest);

  return {
    evaluation,
    reportPath: paths.day24Report,
    evaluationPath: paths.day24Evaluation,
  };
}

function safeSessionId(value) {
  return String(value || "default")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "default";
}

function uniqueAppend(items, value, limit = 12) {
  const text = normalizeWhitespace(value);
  if (!text) {
    return items;
  }
  return [text, ...items.filter((item) => item !== text)].slice(0, limit);
}

function extractQuotedTerms(text) {
  const quoted = [...String(text).matchAll(/["«`]([^"»`]{2,80})["»`]/g)].map(
    (match) => match[1],
  );
  const explicit = [...String(text).matchAll(/термин(?:ы|ом)?[:\s]+([^.;\n]{2,120})/gi)].map(
    (match) => match[1],
  );
  return [...quoted, ...explicit].map(normalizeWhitespace).filter(Boolean);
}

function updateTaskState(taskState, userMessage) {
  const next = {
    goal: taskState.goal || "",
    constraints: ensureArray(taskState.constraints),
    terms: ensureArray(taskState.terms),
    clarifications: ensureArray(taskState.clarifications),
  };
  const message = normalizeWhitespace(userMessage);
  const explicitGoal = /^(?:цель|goal)\s*[:：-]\s*(.+)$/i.exec(message);
  if (explicitGoal) {
    next.goal = message;
  } else if (!next.goal && /^(?:хочу|нужно|надо|задача)\b/i.test(message)) {
    next.goal = message;
  }
  if (/огранич|constraint|только|без |нельзя|обязательно|должен|must|should/i.test(message)) {
    next.constraints = uniqueAppend(next.constraints, message);
  }
  if (/уточн|то есть|значит|пусть|считай|важно/i.test(message)) {
    next.clarifications = uniqueAppend(next.clarifications, message);
  }
  for (const term of extractQuotedTerms(message)) {
    next.terms = uniqueAppend(next.terms, term);
  }
  return next;
}

function taskStateToRetrievalText(taskState, userMessage) {
  return [
    taskState.goal ? `Goal: ${taskState.goal}` : "",
    taskState.constraints.length ? `Constraints: ${taskState.constraints.join("; ")}` : "",
    taskState.terms.length ? `Terms: ${taskState.terms.join("; ")}` : "",
    taskState.clarifications.length
      ? `Clarifications: ${taskState.clarifications.join("; ")}`
      : "",
    userMessage,
  ]
    .filter(Boolean)
    .join("\n");
}

async function readChatSession(dataRoot, sessionId) {
  const paths = ragPaths(dataRoot);
  const id = safeSessionId(sessionId);
  const filePath = path.join(paths.chatsDir, `${id}.json`);
  const session = await readJsonFile(filePath, null);
  if (session) {
    return { ...session, filePath };
  }
  return {
    id,
    title: id,
    messages: [],
    taskState: {
      goal: "",
      constraints: [],
      terms: [],
      clarifications: [],
    },
    createdAt: nowIso(),
    updatedAt: nowIso(),
    filePath,
  };
}

async function writeChatSession(session) {
  await writeJsonFile(session.filePath, {
    id: session.id,
    title: session.title,
    messages: session.messages,
    taskState: session.taskState,
    createdAt: session.createdAt,
    updatedAt: nowIso(),
  });
}

export async function runRagChatTurn(input = {}) {
  const dataRoot = path.resolve(input.dataRoot || DEFAULT_DATA_ROOT);
  const userMessage = normalizeWhitespace(input.message || input.userMessage);
  if (!userMessage) {
    throw new Error("Chat message is required.");
  }
  const session = await readChatSession(dataRoot, input.sessionId || "default");
  const taskState = updateTaskState(session.taskState, userMessage);
  const retrievalQuestion = taskStateToRetrievalText(taskState, userMessage);
  const cited = await runCitedAnswer({
    ...input,
    dataRoot,
    question: retrievalQuestion,
  });
  const assistantMessage = {
    role: "assistant",
    content: cited.answer,
    sources: cited.sources,
    citations: cited.citations,
    status: cited.status,
    createdAt: nowIso(),
  };
  session.taskState = taskState;
  session.messages = [
    ...session.messages,
    {
      role: "user",
      content: userMessage,
      createdAt: nowIso(),
    },
    assistantMessage,
  ];
  session.updatedAt = nowIso();
  await writeChatSession(session);
  return {
    session,
    assistantMessage,
    retrieval: cited.retrieval,
    answeredAt: nowIso(),
  };
}

export const DAY25_SCENARIOS = [
  {
    id: "day25-submission-scenario",
    title: "Submission planning",
    messages: [
      "Цель: подготовить сдачу RAG недели Day 21-25.",
      "Ограничение: каждый ответ должен ссылаться на источники.",
      "Термин: \"чистый RAG\" означает отсутствие общего fallback ответа без базы.",
      "Какие две стратегии чанкинга используются в индексе?",
      "Что делает Day 22 поверх индекса?",
      "Как Day 23 улучшает retrieval?",
      "Что должен делать ассистент при слабом контексте?",
      "Какие поля цитаты должны выводиться?",
      "Уточнение: мне важны ручные параметры top-K и threshold.",
      "Собери краткий итог по текущей цели.",
    ],
  },
  {
    id: "day25-practical-toolkit-scenario",
    title: "Practical toolkit usage",
    messages: [
      "Цель: использовать toolkit для анализа разных форматов документов.",
      "Ограничение: дефолты должны быть оптимальными, но параметры можно менять руками.",
      "Термин: \"task state\" это цель, ограничения, термины и уточнения диалога.",
      "Какие форматы документов поддерживает индексатор?",
      "Где сохраняются индексы?",
      "Какой top-K стоит по умолчанию для первого RAG запроса?",
      "Что сравнивает Day 23 evaluation?",
      "Как антигаллюцинационный режим решает нерелевантный вопрос?",
      "Уточнение: UI должен быть одним toolkit с этапами.",
      "Проверь, что ты не потерял цель и ограничения.",
    ],
  },
];

function renderDay25Report(evaluation) {
  return [
    "# Day 25. Mini Chat with RAG and Task Memory",
    "",
    "## Result",
    "",
    `- Scenarios: ${evaluation.scenarios.length}`,
    `- Total user messages: ${evaluation.scenarios.reduce(
      (sum, scenario) => sum + scenario.userMessageCount,
      0,
    )}`,
    `- Assistant messages with source arrays: ${evaluation.scenarios.reduce(
      (sum, scenario) => sum + scenario.assistantMessagesWithSources,
      0,
    )}`,
    "",
    "## Scenarios",
    "",
    ...evaluation.scenarios.flatMap((scenario) => [
      `### ${scenario.title}`,
      "",
      `Session: ${scenario.sessionId}`,
      `User messages: ${scenario.userMessageCount}`,
      `Assistant messages: ${scenario.assistantMessageCount}`,
      `Task goal: ${scenario.taskState.goal || "n/a"}`,
      `Constraints: ${scenario.taskState.constraints.length}`,
      `Terms: ${scenario.taskState.terms.length}`,
      `Clarifications: ${scenario.taskState.clarifications.length}`,
      "",
    ]),
  ].join("\n");
}

export async function runDay25Evaluation(input = {}) {
  const dataRoot = path.resolve(input.dataRoot || DEFAULT_DATA_ROOT);
  const paths = ragPaths(dataRoot);
  await loadRagIndex({ ...input, dataRoot });
  const scenarios = [];
  for (const scenario of DAY25_SCENARIOS) {
    const sessionPath = path.join(paths.chatsDir, `${safeSessionId(scenario.id)}.json`);
    await writeJsonFile(sessionPath, {
      id: safeSessionId(scenario.id),
      title: scenario.title,
      messages: [],
      taskState: {
        goal: "",
        constraints: [],
        terms: [],
        clarifications: [],
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    let latest = null;
    for (const message of scenario.messages) {
      latest = await runRagChatTurn({
        ...input,
        dataRoot,
        sessionId: scenario.id,
        message,
      });
    }
    const session = latest.session;
    const assistantMessages = session.messages.filter((message) => message.role === "assistant");
    scenarios.push({
      sessionId: session.id,
      title: scenario.title,
      userMessageCount: scenario.messages.length,
      assistantMessageCount: assistantMessages.length,
      assistantMessagesWithSources: assistantMessages.filter((message) =>
        Array.isArray(message.sources),
      ).length,
      taskState: session.taskState,
      filePath: session.filePath,
    });
  }
  const evaluation = {
    id: makeId("day25-eval"),
    scenarios,
    savedAt: nowIso(),
  };
  await mkdir(path.dirname(paths.day25Evaluation), { recursive: true });
  await writeJsonFile(paths.day25Evaluation, evaluation);
  await mkdir(paths.reportsDir, { recursive: true });
  await writeFile(paths.day25Report, renderDay25Report(evaluation), "utf8");

  const manifest = await readJsonFile(paths.manifest, { dataRoot });
  manifest.latestReports = {
    ...(manifest.latestReports || {}),
    day25: paths.day25Report,
  };
  manifest.day25 = {
    scenarioCount: scenarios.length,
    reportPath: paths.day25Report,
    evaluationPath: paths.day25Evaluation,
    updatedAt: nowIso(),
  };
  await writeJsonFile(paths.manifest, manifest);

  return {
    evaluation,
    reportPath: paths.day25Report,
    evaluationPath: paths.day25Evaluation,
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
