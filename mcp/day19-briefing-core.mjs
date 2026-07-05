import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSchedulerStatus } from "./day18-scheduler-core.mjs";

const DEFAULT_MAX_MESSAGES = 120;
const DEFAULT_DIGEST_MESSAGE_LIMIT = 18;
const DAY_PATTERNS = ["day", "день", "дня", "задание"];
const DEFAULT_DIGEST_KEYWORDS = [
  "mcp",
  "tool",
  "scheduler",
  "pipeline",
  "orchestration",
  "digest",
  "summary",
  "report",
  "планиров",
  "распис",
  "цепоч",
  "инструмент",
  "сводк",
  "отчет",
  "итог",
];

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function normalizeList(value, fallback = []) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return fallback;
}

function normalizeTargetDays(value, fallback = [18, 19, 20]) {
  const days = normalizeList(value, fallback.map(String))
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isFinite(item) && item > 0 && item < 100);
  return Array.from(new Set(days.length ? days : fallback));
}

function dayRegex(day) {
  return new RegExp(
    `(?:${DAY_PATTERNS.join("|")})\\s*(?:#|№)?\\s*${day}\\b|\\b${day}\\s*(?:${DAY_PATTERNS.join("|")})\\b`,
    "iu",
  );
}

function textMatchesAny(text, values) {
  const lower = text.toLowerCase();
  return values.some((value) => value && lower.includes(value.toLowerCase()));
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
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

function day19Paths(storagePaths) {
  const dataRoot = path.dirname(path.dirname(storagePaths.messagesCache));
  return {
    ...storagePaths,
    extractionDir: path.join(dataRoot, "briefings", "extractions"),
    latestExtraction: path.join(dataRoot, "briefings", "latest-extraction.json"),
    latestDigestDraft: path.join(
      dataRoot,
      "briefings",
      "latest-digest-draft.json",
    ),
    digestIndex: path.join(dataRoot, "briefings", "digests", "index.json"),
  };
}

function safeMessageText(message) {
  return String(message?.text ?? "").replace(/\s+/g, " ").trim();
}

function normalizeCachedMessage(message) {
  const text = safeMessageText(message);
  return {
    id: String(message?.id ?? ""),
    numericId:
      typeof message?.numericId === "number"
        ? message.numericId
        : Number.parseInt(String(message?.id ?? "0"), 10) || 0,
    date: typeof message?.date === "string" ? message.date : "",
    author: typeof message?.author === "string" ? message.author : "",
    replyToMessageId:
      message?.replyToMessageId === undefined ||
      message?.replyToMessageId === null
        ? null
        : String(message.replyToMessageId),
    text,
    excerpt: text.slice(0, 420),
  };
}

function messageSignals(message, { targetDays, priorityAuthors, keywords }) {
  const author = message.author.toLowerCase();
  const text = message.text;
  const priorityAuthor = priorityAuthors.some(
    (item) => item.toLowerCase() === author,
  );
  const dayMarker = targetDays.some((day) => dayRegex(day).test(text));
  const keyword = textMatchesAny(text, keywords);
  const reply = Boolean(message.replyToMessageId);
  const question = /[?？]|(?:как|что|зачем|почему|where|what|why|how)\b/iu.test(
    text,
  );
  const score =
    (priorityAuthor ? 100 : 0) +
    (dayMarker ? 80 : 0) +
    (keyword ? 40 : 0) +
    (reply ? 15 : 0) +
    (question ? 10 : 0);

  return {
    priorityAuthor,
    dayMarker,
    keyword,
    reply,
    question,
    score,
  };
}

function inputSummaryForExtraction(input) {
  const days = normalizeTargetDays(input.targetDays).join(",");
  const maxMessages = clampInteger(
    input.maxMessages,
    DEFAULT_MAX_MESSAGES,
    10,
    500,
  );
  return `days=${days}; max=${maxMessages}; mode=${input.selectionMode ?? "cached_relevant"}`;
}

async function loadBriefingCache(input = {}) {
  const schedulerStatus = await getSchedulerStatus({ dataRoot: input.dataRoot });
  const paths = day19Paths(schedulerStatus.storagePaths);
  const cache = await readJsonFile(paths.messagesCache, {
    source: schedulerStatus.source,
    briefingProfile: schedulerStatus.briefingProfile,
    messages: [],
    watermark: null,
  });

  return {
    schedulerStatus,
    paths,
    cache,
  };
}

function comparablePath(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  const normalized = path.normalize(value.trim());
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function currentSourcePath(cache, schedulerStatus) {
  return (
    (typeof cache.source?.path === "string" && cache.source.path) ||
    (typeof schedulerStatus.source?.path === "string" && schedulerStatus.source.path) ||
    ""
  );
}

function normalizedDayList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((item) => Number.parseInt(String(item ?? ""), 10))
        .filter((item) => Number.isFinite(item) && item > 0 && item < 100),
    ),
  ).sort((left, right) => left - right);
}

function sameTargetDays(left, right) {
  const leftDays = normalizedDayList(left);
  const rightDays = normalizedDayList(right);
  return (
    leftDays.length === rightDays.length &&
    leftDays.every((day, index) => day === rightDays[index])
  );
}

function targetDaysFromDigest(digest) {
  const directDays = normalizedDayList(digest?.targetDays);
  if (directDays.length) {
    return directDays;
  }
  const title = typeof digest?.title === "string" ? digest.title : "";
  return normalizedDayList(title.match(/\d{1,3}/g) ?? []);
}

function extractionMatchesCurrent(extraction, cache, schedulerStatus, settings) {
  return (
    isRecord(extraction) &&
    comparablePath(extraction.sourcePath) ===
      comparablePath(currentSourcePath(cache, schedulerStatus)) &&
    sameTargetDays(extraction.targetDays, settings.targetDays)
  );
}

function digestMatchesCurrent(digest, cache, schedulerStatus, settings) {
  return (
    isRecord(digest) &&
    comparablePath(digest.sourcePath) ===
      comparablePath(currentSourcePath(cache, schedulerStatus)) &&
    sameTargetDays(targetDaysFromDigest(digest), settings.targetDays)
  );
}

function extractionSettings(input, cache, schedulerStatus) {
  const cachedProfile = isRecord(cache.briefingProfile)
    ? cache.briefingProfile
    : {};
  const schedulerProfile = isRecord(schedulerStatus.briefingProfile)
    ? schedulerStatus.briefingProfile
    : {};
  const targetDays = normalizeTargetDays(
    input.targetDays ?? cachedProfile.targetDays ?? schedulerProfile.targetDays,
  );
  const priorityAuthors = normalizeList(
    input.priorityAuthors,
    normalizeList(
      cachedProfile.priorityAuthors,
      normalizeList(schedulerProfile.priorityAuthors, []),
    ),
  );
  const keywords = normalizeList(
    input.keywords,
    normalizeList(cachedProfile.keywords, DEFAULT_DIGEST_KEYWORDS),
  );
  const finalKeywords = keywords.length ? keywords : DEFAULT_DIGEST_KEYWORDS;

  return {
    targetDays,
    priorityAuthors,
    keywords: finalKeywords,
    maxMessages: clampInteger(
      input.maxMessages,
      DEFAULT_MAX_MESSAGES,
      10,
      500,
    ),
    selectionMode:
      input.selectionMode === "focused" ? "focused" : "cached_relevant",
  };
}

function countSignals(messages) {
  return messages.reduce(
    (counts, message) => ({
      priorityAuthorMessages:
        counts.priorityAuthorMessages +
        (message.signals.priorityAuthor ? 1 : 0),
      dayMarkerMessages:
        counts.dayMarkerMessages + (message.signals.dayMarker ? 1 : 0),
      keywordMessages:
        counts.keywordMessages + (message.signals.keyword ? 1 : 0),
      replyMessages: counts.replyMessages + (message.signals.reply ? 1 : 0),
      questionMessages:
        counts.questionMessages + (message.signals.question ? 1 : 0),
    }),
    {
      priorityAuthorMessages: 0,
      dayMarkerMessages: 0,
      keywordMessages: 0,
      replyMessages: 0,
      questionMessages: 0,
    },
  );
}

export async function extractBriefingMessages(input = {}) {
  const { schedulerStatus, paths, cache } = await loadBriefingCache(input);
  const settings = extractionSettings(input, cache, schedulerStatus);
  const cachedMessages = Array.isArray(cache.messages)
    ? cache.messages.map(normalizeCachedMessage).filter((item) => item.text)
    : [];
  const scoredMessages = cachedMessages.map((message) => {
    const signals = messageSignals(message, settings);
    return {
      ...message,
      signals,
      score: signals.score,
    };
  });
  const filteredMessages = scoredMessages.filter((message) =>
    settings.selectionMode === "cached_relevant" ? true : message.score > 0,
  );
  const selectedMessages = filteredMessages
    .sort(
      (left, right) =>
        right.score - left.score || right.numericId - left.numericId,
    )
    .slice(0, settings.maxMessages)
    .sort((left, right) => left.numericId - right.numericId);
  const extraction = {
    id: makeId("briefing-extraction"),
    dataRoot: schedulerStatus.dataRoot,
    sourcePath: cache.source?.path ?? schedulerStatus.source.path,
    parserPreset: cache.source?.parserPreset ?? schedulerStatus.source.parserPreset,
    targetDays: settings.targetDays,
    priorityAuthors: settings.priorityAuthors,
    keywords: settings.keywords,
    selectionMode: settings.selectionMode,
    totalCachedMessages: cachedMessages.length,
    selectedMessageCount: selectedMessages.length,
    counts: countSignals(selectedMessages),
    aggregateSummary:
      schedulerStatus.latestAggregate?.summary ??
      "No scheduler aggregate is available yet.",
    messages: selectedMessages,
    createdAt: nowIso(),
  };
  const extractionPath = path.join(paths.extractionDir, `${extraction.id}.json`);
  const nextPayload = {
    step: "extract_briefing_messages",
    message: `${extraction.selectedMessageCount} briefing message(s) extracted from ${extraction.totalCachedMessages} cached message(s).`,
    inputSummary: inputSummaryForExtraction(input),
    extraction,
    dataRoot: schedulerStatus.dataRoot,
    storagePaths: {
      extractionPath,
      latestExtraction: paths.latestExtraction,
      messagesCache: paths.messagesCache,
      latestAggregate: paths.latestAggregate,
    },
    checkedAt: nowIso(),
  };

  await writeJsonFile(extractionPath, extraction);
  await writeJsonFile(paths.latestExtraction, extraction);
  return nextPayload;
}

async function loadExtraction(input = {}) {
  if (isRecord(input.extraction)) {
    return input.extraction;
  }
  const { schedulerStatus, paths, cache } = await loadBriefingCache(input);
  if (typeof input.extractionPath === "string" && input.extractionPath.trim()) {
    return readJsonFile(input.extractionPath, null);
  }
  if (existsSync(paths.latestExtraction)) {
    const extraction = await readJsonFile(paths.latestExtraction, null);
    const settings = extractionSettings(input, cache, schedulerStatus);
    if (extractionMatchesCurrent(extraction, cache, schedulerStatus, settings)) {
      return extraction;
    }
  }
  const extracted = await extractBriefingMessages(input);
  return extracted.extraction;
}

function messageLine(message) {
  const date = message.date || "unknown date";
  const author = message.author || "unknown author";
  return `${date} | ${author}: ${message.excerpt}`;
}

function topMessages(messages, predicate, limit) {
  return messages
    .filter(predicate)
    .sort((left, right) => right.score - left.score || right.numericId - left.numericId)
    .slice(0, limit)
    .map((message) => ({
      id: message.id,
      date: message.date,
      author: message.author,
      excerpt: message.excerpt,
      score: message.score,
      signals: message.signals,
    }));
}

function buildSection(title, messages, fallback) {
  return {
    title,
    summary: messages.length
      ? messages.slice(0, 4).map(messageLine).join("\n")
      : fallback,
    messages,
  };
}

export async function buildChallengeDigest(input = {}) {
  const extraction = await loadExtraction(input);
  if (!isRecord(extraction)) {
    throw new Error("No briefing extraction is available. Run extract first.");
  }

  const messages = Array.isArray(extraction.messages) ? extraction.messages : [];
  const messageLimit = clampInteger(
    input.messageLimit,
    DEFAULT_DIGEST_MESSAGE_LIMIT,
    5,
    80,
  );
  const priorityMessages = topMessages(
    messages,
    (message) => message.signals?.priorityAuthor,
    messageLimit,
  );
  const assignmentMessages = topMessages(
    messages,
    (message) => message.signals?.dayMarker,
    messageLimit,
  );
  const toolMessages = topMessages(
    messages,
    (message) => message.signals?.keyword,
    messageLimit,
  );
  const questionMessages = topMessages(
    messages,
    (message) => message.signals?.question,
    Math.min(messageLimit, 12),
  );
  const keyMessages = [...messages]
    .sort(
      (left, right) =>
        right.score - left.score || right.numericId - left.numericId,
    )
    .slice(0, messageLimit)
    .map((message) => ({
      id: message.id,
      date: message.date,
      author: message.author,
      excerpt: message.excerpt,
      score: message.score,
      signals: message.signals,
    }));
  const digest = {
    id: makeId("challenge-digest"),
    title: `Challenge briefing digest for day(s) ${extraction.targetDays.join(", ")}`,
    sourceExtractionId: extraction.id,
    dataRoot: extraction.dataRoot,
    sourcePath: extraction.sourcePath,
    parserPreset: extraction.parserPreset,
    targetDays: extraction.targetDays,
    generatedAt: nowIso(),
    totals: {
      totalCachedMessages: extraction.totalCachedMessages,
      selectedMessageCount: extraction.selectedMessageCount,
      ...extraction.counts,
    },
    summary: [
      `${extraction.selectedMessageCount} selected briefing message(s).`,
      `${extraction.counts?.priorityAuthorMessages ?? 0} priority-author message(s).`,
      `${extraction.counts?.dayMarkerMessages ?? 0} assignment/day marker message(s).`,
      `${extraction.counts?.keywordMessages ?? 0} tool or workflow signal message(s).`,
    ].join(" "),
    sections: [
      buildSection(
        "Assignment and day markers",
        assignmentMessages,
        "No explicit assignment/day marker messages were selected.",
      ),
      buildSection(
        "Priority author guidance",
        priorityMessages,
        "No priority-author messages were selected.",
      ),
      buildSection(
        "MCP tool-chain signals",
        toolMessages,
        "No explicit MCP/tool-chain messages were selected.",
      ),
      buildSection(
        "Open questions and clarifications",
        questionMessages,
        "No question-like clarification messages were selected.",
      ),
    ],
    recommendations: [
      "Keep Day 19 as one Briefing MCP server with multiple tools, not three separate MCP servers.",
      "Use the Day 18 scheduler cache as the source of truth for extracted briefing messages.",
      "Persist both JSON and Markdown digests so Day 20 can orchestrate them with other MCP servers.",
      "Let the assistant interpret the digest; the MCP tools should provide deterministic structured data.",
    ],
    keyMessages,
  };
  const { paths } = await loadBriefingCache({
    dataRoot: extraction.dataRoot ?? input.dataRoot,
  });
  const result = {
    step: "build_challenge_digest",
    message: `Digest built from ${extraction.selectedMessageCount} extracted message(s).`,
    digest,
    dataRoot: extraction.dataRoot,
    storagePaths: {
      latestDigestDraft: paths.latestDigestDraft,
      latestExtraction: paths.latestExtraction,
    },
    checkedAt: nowIso(),
  };

  await writeJsonFile(paths.latestDigestDraft, digest);
  return result;
}

async function loadDigest(input = {}) {
  if (isRecord(input.digest)) {
    return input.digest;
  }
  const { schedulerStatus, paths, cache } = await loadBriefingCache(input);
  if (typeof input.digestPath === "string" && input.digestPath.trim()) {
    return readJsonFile(input.digestPath, null);
  }
  if (existsSync(paths.latestDigestDraft)) {
    const digest = await readJsonFile(paths.latestDigestDraft, null);
    const settings = extractionSettings(input, cache, schedulerStatus);
    if (digestMatchesCurrent(digest, cache, schedulerStatus, settings)) {
      return digest;
    }
  }
  const built = await buildChallengeDigest(input);
  return built.digest;
}

function renderDigestMarkdown(digest) {
  const lines = [
    `# ${digest.title}`,
    "",
    `Generated: ${digest.generatedAt}`,
    `Source: ${digest.sourcePath}`,
    "",
    "## Summary",
    "",
    digest.summary,
    "",
    "## Recommendations",
    "",
    ...digest.recommendations.map((item) => `- ${item}`),
    "",
  ];

  for (const section of digest.sections ?? []) {
    lines.push(`## ${section.title}`, "", section.summary || "No data.", "");
  }

  lines.push("## Key Messages", "");
  for (const message of digest.keyMessages ?? []) {
    lines.push(`- ${messageLine(message)}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function saveChallengeDigest(input = {}) {
  const digest = await loadDigest(input);
  if (!isRecord(digest)) {
    throw new Error("No challenge digest is available. Run build first.");
  }

  const { schedulerStatus, paths } = await loadBriefingCache({
    dataRoot: digest.dataRoot ?? input.dataRoot,
  });
  const fileSafeId = digest.id ?? makeId("challenge-digest");
  const jsonPath = path.join(paths.digests, `${fileSafeId}.json`);
  const markdownPath = path.join(paths.digests, `${fileSafeId}.md`);
  const latestJsonPath = path.join(paths.digests, "latest-challenge-digest.json");
  const latestMarkdownPath = path.join(paths.digests, "latest-challenge-digest.md");
  const savedDigest = {
    ...digest,
    savedAt: nowIso(),
    savedPaths: {
      json: jsonPath,
      markdown: markdownPath,
      latestJson: latestJsonPath,
      latestMarkdown: latestMarkdownPath,
    },
  };
  const markdown = renderDigestMarkdown(savedDigest);

  await writeJsonFile(jsonPath, savedDigest);
  await writeJsonFile(latestJsonPath, savedDigest);
  await mkdir(path.dirname(markdownPath), { recursive: true });
  await writeFile(markdownPath, markdown, "utf8");
  await writeFile(latestMarkdownPath, markdown, "utf8");
  const index = await readJsonFile(paths.digestIndex, { digests: [] });
  const digests = Array.isArray(index.digests) ? index.digests : [];
  await writeJsonFile(paths.digestIndex, {
    digests: [
      {
        id: savedDigest.id,
        title: savedDigest.title,
        generatedAt: savedDigest.generatedAt,
        savedAt: savedDigest.savedAt,
        jsonPath,
        markdownPath,
      },
      ...digests.filter((item) => item.id !== savedDigest.id),
    ].slice(0, 50),
    updatedAt: nowIso(),
  });

  return {
    step: "save_challenge_digest",
    message: `Digest saved as JSON and Markdown for ${schedulerStatus.dataRoot}.`,
    digest: savedDigest,
    dataRoot: schedulerStatus.dataRoot,
    savedPaths: [jsonPath, markdownPath, latestJsonPath, latestMarkdownPath],
    storagePaths: {
      digestIndex: paths.digestIndex,
      digests: paths.digests,
      latestJson: latestJsonPath,
      latestMarkdown: latestMarkdownPath,
    },
    checkedAt: nowIso(),
  };
}
