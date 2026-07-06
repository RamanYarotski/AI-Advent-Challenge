import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const SUPPORTED_SOURCE_TYPES = new Set(["upload", "url", "site", "github", "local_path"]);
export const SUPPORTED_SOURCE_EXTENSIONS = new Set([
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
export const MAX_UPLOAD_FILES = 20;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const DEFAULT_SOURCE_MANAGER_DATA_ROOT = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  ".data",
  "rag-week",
);
export const SUPPORTED_RAG_EXTENSIONS = [...SUPPORTED_SOURCE_EXTENSIONS];
export const SOURCE_TYPES = [...SUPPORTED_SOURCE_TYPES];
export const SOURCE_STATUSES = ["pending", "ready", "indexed", "warning", "error", "disabled"];
export const SOURCE_MANAGER_UPLOAD_LIMITS = {
  maxFiles: MAX_UPLOAD_FILES,
  maxFileBytes: MAX_UPLOAD_BYTES,
};

const LEGACY_DEFAULT_SOURCE_VALUES = new Set([
  "README.md",
  "docs",
  "lib",
  "app/api",
  "mcp",
  "docs/rag-week-chat-notes.md",
]);

function defaultDataRoot() {
  return DEFAULT_SOURCE_MANAGER_DATA_ROOT;
}

function resolveDataRoot(value) {
  return path.resolve(/*turbopackIgnore: true*/ value || defaultDataRoot());
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix = "source") {
  return `${prefix}-${randomUUID()}`;
}

function extensionOf(filePath) {
  return path.extname(filePath).toLowerCase();
}

function normalizeEnabled(value, fallback = true) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function safeFileName(value) {
  const parsed = path.basename(String(value || "upload.txt"));
  const safe = parsed.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || `upload-${Date.now()}.txt`;
}

function uniqueSafeFileName(value, usedNames) {
  const requested = safeFileName(value);
  const extension = path.extname(requested);
  const stem = path.basename(requested, extension);
  let candidate = requested;
  let index = 2;
  while (usedNames.has(candidate)) {
    candidate = `${stem}-${index}${extension}`;
    index += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function isGithubUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase() === "github.com";
  } catch {
    return false;
  }
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

export function sourceManagerPaths(dataRoot) {
  const resolvedDataRoot = resolveDataRoot(dataRoot);
  return {
    dataRoot: resolvedDataRoot,
    sourcesFile: path.join(resolvedDataRoot, "sources.json"),
    uploadsDir: path.join(resolvedDataRoot, "uploads"),
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

function normalizeSourceRecord(input = {}, existing = {}) {
  const value = String(input.value ?? existing.value ?? "").trim();
  const type = String(input.type ?? existing.type ?? inferSourceType(value)).trim().toLowerCase();
  if (!SUPPORTED_SOURCE_TYPES.has(type)) {
    throw new Error(`Unsupported source type: ${type}`);
  }
  if (!value) {
    throw new Error("Source value is required.");
  }
  if ((type === "url" || type === "site" || type === "github") && !isHttpUrl(value)) {
    throw new Error(`${type} source must be an http(s) URL.`);
  }
  if (type === "github" && !isGithubUrl(value)) {
    throw new Error("GitHub source must point to github.com.");
  }
  const now = nowIso();
  const status = String(input.status ?? existing.status ?? "ready").trim().toLowerCase() || "ready";
  const documentCount = Number(input.documentCount ?? existing.documentCount ?? 0);
  const preserveUpdatedAt = input === existing;
  return {
    id: existing.id || input.id || makeId(type),
    type,
    label: String(input.label ?? existing.label ?? path.basename(value) ?? value).trim() || value,
    value,
    enabled: normalizeEnabled(input.enabled, normalizeEnabled(existing.enabled, true)),
    status: SOURCE_STATUSES.includes(status) ? status : "ready",
    warning: input.warning ?? existing.warning ?? null,
    error: input.error ?? existing.error ?? null,
    documentCount: Number.isFinite(documentCount) ? Math.max(0, Math.floor(documentCount)) : 0,
    lastIndexedAt: input.lastIndexedAt ?? existing.lastIndexedAt ?? null,
    metadata: {
      ...(existing.metadata || {}),
      ...(input.metadata || {}),
    },
    createdAt: existing.createdAt || input.createdAt || now,
    updatedAt: preserveUpdatedAt ? existing.updatedAt || input.updatedAt || now : now,
  };
}

function isLegacyDefaultSource(source) {
  return (
    source?.metadata?.default === true &&
    source.type === "local_path" &&
    LEGACY_DEFAULT_SOURCE_VALUES.has(source.value)
  );
}

export async function readSourceState(dataRoot, options = {}) {
  const paths = sourceManagerPaths(dataRoot);
  const state = await readJsonFile(paths.sourcesFile, null);
  if (state?.sources) {
    const normalizedSources = state.sources.map((source) => normalizeSourceRecord(source, source));
    const sources = normalizedSources.filter((source) => !isLegacyDefaultSource(source));
    if (sources.length !== normalizedSources.length && options.persistLegacyCleanup !== false) {
      await writeSourceState(dataRoot, sources);
    }
    return {
      version: 1,
      sources,
      updatedAt: state.updatedAt || nowIso(),
    };
  }
  const initial = {
    version: 1,
    sources: [],
    updatedAt: nowIso(),
  };
  if (options.persistEmpty) {
    await writeSourceState(dataRoot, initial.sources);
  }
  return initial;
}

export async function writeSourceState(dataRoot, sources) {
  const paths = sourceManagerPaths(dataRoot);
  const state = {
    version: 1,
    sources: sources.map((source) => normalizeSourceRecord(source, source)),
    updatedAt: nowIso(),
  };
  await writeJsonFile(paths.sourcesFile, state);
  return state;
}

export async function listRagSources(input = {}) {
  const dataRoot = resolveDataRoot(input.dataRoot);
  return readSourceState(dataRoot);
}

export async function addRagSource(input = {}) {
  const dataRoot = resolveDataRoot(input.dataRoot);
  const state = await readSourceState(dataRoot);
  const nextSource = normalizeSourceRecord(input);
  const duplicates = state.sources.some(
    (source) => source.value === nextSource.value && source.type === nextSource.type,
  );
  const sources = duplicates ? state.sources : [...state.sources, nextSource];
  return {
    state: await writeSourceState(dataRoot, sources),
    source: duplicates
      ? state.sources.find((source) => source.value === nextSource.value && source.type === nextSource.type)
      : nextSource,
    duplicate: duplicates,
  };
}

export async function updateRagSource(input = {}) {
  const dataRoot = resolveDataRoot(input.dataRoot);
  const state = await readSourceState(dataRoot);
  const id = String(input.id || "");
  const found = state.sources.find((source) => source.id === id);
  if (!found) {
    throw new Error(`Source not found: ${id}`);
  }
  const updated = normalizeSourceRecord({ ...found, ...(input.patch || {}) }, found);
  const sources = state.sources.map((source) => (source.id === id ? updated : source));
  return {
    state: await writeSourceState(dataRoot, sources),
    source: updated,
  };
}

export async function deleteRagSource(input = {}) {
  const dataRoot = resolveDataRoot(input.dataRoot);
  const state = await readSourceState(dataRoot);
  const id = String(input.id || "");
  const source = state.sources.find((item) => item.id === id) || null;
  const sources = state.sources.filter((source) => source.id !== id);
  return {
    state: await writeSourceState(dataRoot, sources),
    deleted: sources.length !== state.sources.length,
    source,
  };
}

export function sourceRecordsToEntries(sources) {
  return sources
    .filter((source) => source.enabled !== false)
    .map((source) => ({
      input: source.value,
      value: source.value,
      type: source.type,
      id: source.id,
      label: source.label,
    }));
}

export async function enabledSourceEntries(input = {}) {
  const dataRoot = resolveDataRoot(input.dataRoot);
  const state = await readSourceState(dataRoot);
  return sourceRecordsToEntries(state.sources);
}

export async function markSourcesIndexed(input = {}) {
  const dataRoot = resolveDataRoot(input.dataRoot);
  const summaries = Array.isArray(input.sourceSummaries) ? input.sourceSummaries : [];
  const state = await readSourceState(dataRoot, { withoutDefaults: true });
  if (!state.sources.length) {
    return state;
  }
  const updatedAt = nowIso();
  const sources = state.sources.map((source) => {
    const summary = summaries.find(
      (item) =>
        item.input === source.value ||
        item.input === source.metadata?.relativeValue ||
        String(item.input || "").startsWith(`${source.value}#`),
    );
    if (!summary) {
      return source;
    }
    return normalizeSourceRecord(
      {
        ...source,
        status: summary.error ? "error" : summary.warning ? "warning" : "indexed",
        warning: summary.warning || null,
        error: summary.error || null,
        documentCount: summary.documentCount,
        lastIndexedAt: updatedAt,
      },
      source,
    );
  });
  return writeSourceState(dataRoot, sources);
}

export function validateUploadFile(file) {
  const name = safeFileName(file?.name || "");
  const extension = extensionOf(name);
  if (!SUPPORTED_SOURCE_EXTENSIONS.has(extension)) {
    return { ok: false, name, reason: `Unsupported extension: ${extension || "none"}` };
  }
  if (Number(file?.size || 0) > MAX_UPLOAD_BYTES) {
    return { ok: false, name, reason: "File is larger than 25MB." };
  }
  return { ok: true, name, extension };
}

export async function saveUploadedFiles(input = {}) {
  const dataRoot = resolveDataRoot(input.dataRoot);
  const formData = input.formData;
  if (!formData) {
    throw new Error("Multipart form data is required.");
  }
  const files = [...formData.getAll("files"), ...formData.getAll("file")].filter(Boolean);
  if (!files.length) {
    throw new Error("At least one file is required.");
  }
  const limited = files.slice(0, MAX_UPLOAD_FILES);
  const rejected = files
    .slice(MAX_UPLOAD_FILES)
    .map((file) => ({
      name: file.name || "file",
      size: Number(file.size || 0),
      reason: "Upload batch is limited to 20 files.",
    }));
  const paths = sourceManagerPaths(dataRoot);
  const requestedBatchId = String(formData.get("batchId") || "").trim();
  const batchId = requestedBatchId
    ? safeFileName(requestedBatchId)
    : `batch-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const batchDir = path.join(paths.uploadsDir, batchId);
  await mkdir(batchDir, { recursive: true });

  const uploaded = [];
  const usedNames = new Set();
  for (const file of limited) {
    const validation = validateUploadFile(file);
    if (!validation.ok) {
      rejected.push({ name: validation.name, size: Number(file.size || 0), reason: validation.reason });
      continue;
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const storedFileName = uniqueSafeFileName(validation.name, usedNames);
    const filePath = path.join(batchDir, storedFileName);
    await writeFile(filePath, bytes);
    const relativeValue = path
      .relative(/*turbopackIgnore: true*/ process.cwd(), filePath)
      .replace(/\\/g, "/");
    const source = normalizeSourceRecord({
      type: "upload",
      label: storedFileName,
      value: relativeValue,
      metadata: {
        batchId,
        originalName: file.name || validation.name,
        safeFileName: storedFileName,
        size: bytes.length,
        extension: validation.extension,
        relativeValue,
      },
    });
    uploaded.push(source);
  }

  const state = await readSourceState(dataRoot);
  const existingKeys = new Set(state.sources.map((source) => `${source.type}:${source.value}`));
  const nextSources = [
    ...state.sources,
    ...uploaded.filter((source) => !existingKeys.has(`${source.type}:${source.value}`)),
  ];
  const nextState = await writeSourceState(dataRoot, nextSources);

  return {
    batchId,
    uploaded,
    rejected,
    state: nextState,
  };
}

export async function describeLocalSource(value) {
  try {
    const info = await stat(path.resolve(/*turbopackIgnore: true*/ process.cwd(), value));
    return {
      exists: true,
      kind: info.isDirectory() ? "directory" : info.isFile() ? "file" : "other",
      size: info.size,
    };
  } catch {
    return { exists: false, kind: "missing", size: 0 };
  }
}

export function validateAndNormalizeSourceRecord(input = {}, existing = {}) {
  return normalizeSourceRecord(input, existing);
}

export async function listEnabledSourceValues(input = {}) {
  const entries = await enabledSourceEntries(input);
  return entries.map((entry) => ({
    id: entry.id,
    type: entry.type,
    label: entry.label,
    value: entry.value || entry.input,
  }));
}

export async function listEnabledSourceInputs(input = {}) {
  return (await listEnabledSourceValues(input)).map((source) => source.value);
}

export async function updateIndexedSourceSummaries(sourceSummariesOrInput = [], options = {}) {
  const sourceSummaries = Array.isArray(sourceSummariesOrInput)
    ? sourceSummariesOrInput
    : sourceSummariesOrInput.sourceSummaries || [];
  return markSourcesIndexed({
    dataRoot: options.dataRoot || sourceSummariesOrInput.dataRoot,
    sourceSummaries,
  });
}

export async function getSourceCatalogStatus(input = {}) {
  const dataRoot = resolveDataRoot(input.dataRoot);
  const state = await readSourceState(dataRoot);
  const byType = Object.fromEntries(SOURCE_TYPES.map((type) => [type, 0]));
  const byStatus = Object.fromEntries(SOURCE_STATUSES.map((status) => [status, 0]));

  for (const source of state.sources) {
    byType[source.type] = (byType[source.type] || 0) + 1;
    byStatus[source.status] = (byStatus[source.status] || 0) + 1;
  }

  return {
    dataRoot,
    paths: sourceManagerPaths(dataRoot),
    summary: {
      count: state.sources.length,
      enabledCount: state.sources.filter((source) => source.enabled !== false).length,
      disabledCount: state.sources.filter((source) => source.enabled === false).length,
      byType,
      byStatus,
    },
    supportedExtensions: SUPPORTED_RAG_EXTENSIONS,
    uploadLimits: SOURCE_MANAGER_UPLOAD_LIMITS,
    checkedAt: nowIso(),
  };
}

export async function resetRagData(input = {}) {
  const dataRoot = resolveDataRoot(input.dataRoot);
  await rm(dataRoot, { recursive: true, force: true });
  const state = await readSourceState(dataRoot);
  return {
    dataRoot,
    state,
    resetAt: nowIso(),
  };
}
