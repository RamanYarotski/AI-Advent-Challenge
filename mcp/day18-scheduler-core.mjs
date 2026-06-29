import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_DATA_ROOT = path.join(process.cwd(), ".data", "mcp-workflows");
const INDEX_FILE = path.join(process.cwd(), ".data", "day-18", "scheduler-index.json");
const DEFAULT_SOURCE_PATH = path.join(
  os.homedir(),
  "Downloads",
  "Telegram Desktop",
  "ChatExport_2026-06-28",
  "result.json",
);
const DEFAULT_TASK_ID = "briefing-file-scan";
const DAY_PATTERNS = [
  "day",
  "день",
  "дня",
  "задание",
];
const DEFAULT_KEYWORDS = [
  "mcp",
  "tool",
  "scheduler",
  "pipeline",
  "orchestration",
  "планиров",
  "распис",
  "фонов",
  "пайплайн",
  "цепоч",
  "сервер",
  "инструмент",
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

function normalizeTargetDays(value) {
  const days = normalizeList(value, ["18", "19", "20"])
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isFinite(item) && item > 0 && item < 100);
  return Array.from(new Set(days.length ? days : [18, 19, 20]));
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function defaultBriefingProfile() {
  return {
    targetDays: [18, 19, 20],
    priorityAuthors: ["Алексей Гладков", "Mobile Developer Manager"],
    keywords: DEFAULT_KEYWORDS,
    replyDepth: 1,
    instructions:
      "Prioritize assignment posts and answers from priority authors. Keep clarifications from reply chains. Ignore obvious off-topic messages.",
  };
}

function defaultSource() {
  return {
    sourceType: "file",
    parserPreset: "message_export_json",
    path: DEFAULT_SOURCE_PATH,
  };
}

function defaultSchedule() {
  return {
    mode: "manual",
    intervalSeconds: 60,
    dailyTime: "09:00",
  };
}

function defaultTask() {
  return {
    id: DEFAULT_TASK_ID,
    title: "Briefing file scan",
    enabled: true,
    serverId: "briefing",
    toolName: "scan_message_file",
    args: {
      source: defaultSource(),
      briefingProfile: defaultBriefingProfile(),
    },
    schedule: defaultSchedule(),
    lastRunAt: null,
    nextRunAt: null,
    runCount: 0,
    lastResult: null,
    lastError: null,
    updatedAt: nowIso(),
  };
}

function defaultState(dataRoot = DEFAULT_DATA_ROOT) {
  const task = defaultTask();
  return {
    schedulerEnabled: false,
    dataRoot,
    source: task.args.source,
    briefingProfile: task.args.briefingProfile,
    tasks: [task],
    updatedAt: nowIso(),
  };
}

function schedulerPaths(dataRoot) {
  return {
    index: INDEX_FILE,
    tasks: path.join(dataRoot, "scheduler", "tasks.json"),
    runs: path.join(dataRoot, "scheduler", "runs.json"),
    messagesCache: path.join(dataRoot, "briefings", "messages-cache.json"),
    latestAggregate: path.join(dataRoot, "briefings", "latest-aggregate.json"),
    digests: path.join(dataRoot, "briefings", "digests"),
    reports: path.join(dataRoot, "reports"),
  };
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

async function configuredDataRoot(inputRoot) {
  if (typeof inputRoot === "string" && inputRoot.trim()) {
    return path.resolve(inputRoot.trim());
  }
  const index = await readJsonFile(INDEX_FILE, {});
  if (typeof index.dataRoot === "string" && index.dataRoot.trim()) {
    return path.resolve(index.dataRoot.trim());
  }
  return DEFAULT_DATA_ROOT;
}

async function saveConfiguredDataRoot(dataRoot) {
  await writeJsonFile(INDEX_FILE, {
    dataRoot,
    updatedAt: nowIso(),
  });
}

function normalizeSource(value) {
  const candidate = isRecord(value) ? value : {};
  return {
    sourceType: "file",
    parserPreset:
      typeof candidate.parserPreset === "string" && candidate.parserPreset.trim()
        ? candidate.parserPreset.trim()
        : "message_export_json",
    path:
      typeof candidate.path === "string" && candidate.path.trim()
        ? candidate.path.trim()
        : DEFAULT_SOURCE_PATH,
  };
}

function normalizeBriefingProfile(value) {
  const candidate = isRecord(value) ? value : {};
  const fallback = defaultBriefingProfile();
  return {
    targetDays: normalizeTargetDays(candidate.targetDays),
    priorityAuthors: normalizeList(
      candidate.priorityAuthors,
      fallback.priorityAuthors,
    ),
    keywords: normalizeList(candidate.keywords, fallback.keywords),
    replyDepth: clampInteger(candidate.replyDepth, fallback.replyDepth, 0, 3),
    instructions:
      typeof candidate.instructions === "string" && candidate.instructions.trim()
        ? candidate.instructions.trim()
        : fallback.instructions,
  };
}

function normalizeSchedule(value) {
  const candidate = isRecord(value) ? value : {};
  const mode =
    candidate.mode === "interval" || candidate.mode === "daily"
      ? candidate.mode
      : "manual";
  return {
    mode,
    intervalSeconds: clampInteger(candidate.intervalSeconds, 60, 10, 86400),
    dailyTime:
      typeof candidate.dailyTime === "string" &&
      /^\d{2}:\d{2}$/.test(candidate.dailyTime)
        ? candidate.dailyTime
        : "09:00",
  };
}

function normalizeTask(value) {
  const fallback = defaultTask();
  const candidate = isRecord(value) ? value : {};
  const source = normalizeSource(candidate.args?.source ?? candidate.source);
  const briefingProfile = normalizeBriefingProfile(
    candidate.args?.briefingProfile ?? candidate.briefingProfile,
  );
  return {
    id:
      typeof candidate.id === "string" && candidate.id.trim()
        ? candidate.id.trim()
        : fallback.id,
    title:
      typeof candidate.title === "string" && candidate.title.trim()
        ? candidate.title.trim()
        : fallback.title,
    enabled: candidate.enabled !== false,
    serverId:
      typeof candidate.serverId === "string" && candidate.serverId.trim()
        ? candidate.serverId.trim()
        : fallback.serverId,
    toolName:
      typeof candidate.toolName === "string" && candidate.toolName.trim()
        ? candidate.toolName.trim()
        : fallback.toolName,
    args: {
      source,
      briefingProfile,
    },
    schedule: normalizeSchedule(candidate.schedule),
    lastRunAt:
      typeof candidate.lastRunAt === "string" ? candidate.lastRunAt : null,
    nextRunAt:
      typeof candidate.nextRunAt === "string" ? candidate.nextRunAt : null,
    runCount:
      typeof candidate.runCount === "number" && Number.isFinite(candidate.runCount)
        ? Math.max(0, Math.round(candidate.runCount))
        : 0,
    lastResult: isRecord(candidate.lastResult) ? candidate.lastResult : null,
    lastError:
      typeof candidate.lastError === "string" ? candidate.lastError : null,
    updatedAt:
      typeof candidate.updatedAt === "string" && candidate.updatedAt
        ? candidate.updatedAt
        : nowIso(),
  };
}

function normalizeState(value, dataRoot) {
  const candidate = isRecord(value) ? value : {};
  const tasks = Array.isArray(candidate.tasks)
    ? candidate.tasks.map(normalizeTask)
    : [defaultTask()];
  const safeTasks = tasks.length ? tasks : [defaultTask()];
  const firstTask = safeTasks[0];
  return {
    schedulerEnabled: candidate.schedulerEnabled === true,
    dataRoot,
    source: normalizeSource(candidate.source ?? firstTask.args.source),
    briefingProfile: normalizeBriefingProfile(
      candidate.briefingProfile ?? firstTask.args.briefingProfile,
    ),
    tasks: safeTasks,
    updatedAt:
      typeof candidate.updatedAt === "string" && candidate.updatedAt
        ? candidate.updatedAt
        : nowIso(),
  };
}

async function readState(inputRoot) {
  const dataRoot = await configuredDataRoot(inputRoot);
  const paths = schedulerPaths(dataRoot);
  const raw = await readJsonFile(paths.tasks, null);
  const state = normalizeState(raw, dataRoot);
  return {
    state,
    paths,
  };
}

async function writeState(state) {
  await saveConfiguredDataRoot(state.dataRoot);
  const paths = schedulerPaths(state.dataRoot);
  await writeJsonFile(paths.tasks, state);
  return paths;
}

function nextDailyRunAt(dailyTime, now = new Date()) {
  const [hours, minutes] = dailyTime.split(":").map((item) => Number.parseInt(item, 10));
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

function nextRunAtFor(schedule, now = new Date()) {
  if (schedule.mode === "interval") {
    return new Date(now.getTime() + schedule.intervalSeconds * 1000).toISOString();
  }
  if (schedule.mode === "daily") {
    return nextDailyRunAt(schedule.dailyTime, now);
  }
  return null;
}

function isTaskDue(task, now = new Date()) {
  if (task.schedule.mode === "manual") {
    return false;
  }
  if (!task.nextRunAt) {
    return true;
  }
  return new Date(task.nextRunAt).getTime() <= now.getTime();
}

function textOfMessage(message) {
  const text = message?.text;
  if (Array.isArray(text)) {
    return text
      .map((part) =>
        typeof part === "string"
          ? part
          : isRecord(part) && typeof part.text === "string"
            ? part.text
            : "",
      )
      .join("");
  }
  return typeof text === "string" ? text : "";
}

function normalizeMessage(message) {
  if (!isRecord(message)) {
    return null;
  }
  const text = textOfMessage(message).trim();
  if (!text) {
    return null;
  }
  return {
    id: String(message.id ?? ""),
    numericId:
      typeof message.id === "number"
        ? message.id
        : Number.parseInt(String(message.id ?? "0"), 10) || 0,
    date: typeof message.date === "string" ? message.date : "",
    author:
      typeof message.from === "string"
        ? message.from
        : typeof message.actor === "string"
          ? message.actor
          : "",
    replyToMessageId:
      message.reply_to_message_id === undefined ||
      message.reply_to_message_id === null
        ? null
        : String(message.reply_to_message_id),
    text,
  };
}

function dayRegex(day) {
  return new RegExp(
    `(?:${DAY_PATTERNS.join("|")})\\s*(?:#|№)?\\s*${day}\\b|\\b${day}\\s*(?:${DAY_PATTERNS.join("|")})\\b`,
    "iu",
  );
}

function matchesAny(text, values) {
  const lower = text.toLowerCase();
  return values.some((value) => value && lower.includes(value.toLowerCase()));
}

function isRelevantMessage(message, profile) {
  const text = message.text;
  const dayMatch = profile.targetDays.some((day) => dayRegex(day).test(text));
  const keywordMatch = matchesAny(text, profile.keywords);
  const priorityAuthor = profile.priorityAuthors.some(
    (author) => author.toLowerCase() === message.author.toLowerCase(),
  );

  return dayMatch || keywordMatch || priorityAuthor;
}

function addReplyChain(seed, byId, profile) {
  const added = [];
  let current = seed;
  for (let depth = 0; depth < profile.replyDepth; depth += 1) {
    if (!current.replyToMessageId) {
      break;
    }
    const parent = byId.get(current.replyToMessageId);
    if (!parent) {
      break;
    }
    added.push(parent);
    current = parent;
  }
  return added;
}

function summarizeMessage(message) {
  const compact = message.text.replace(/\s+/g, " ").trim();
  return {
    id: message.id,
    date: message.date,
    author: message.author,
    replyToMessageId: message.replyToMessageId,
    text: compact,
    excerpt: compact.slice(0, 360),
  };
}

function stableJson(value) {
  return JSON.stringify(value);
}

function buildAggregate({
  cachedMessages,
  newRelevantMessages,
  profile,
  source,
  sourceFingerprint,
}) {
  const priorityAuthors = new Set(
    profile.priorityAuthors.map((author) => author.toLowerCase()),
  );
  const priorityMessages = cachedMessages.filter((message) =>
    priorityAuthors.has(message.author.toLowerCase()),
  );
  const assignmentMessages = cachedMessages.filter((message) =>
    profile.targetDays.some((day) => dayRegex(day).test(message.text)),
  );
  const latestMessages = [...cachedMessages]
    .sort((left, right) => right.numericId - left.numericId)
    .slice(0, 12)
    .map(summarizeMessage);
  const deltaSummary = newRelevantMessages.length
    ? `${newRelevantMessages.length} new relevant message(s) added in this run.`
    : "No new relevant messages since the previous scan.";

  return {
    sourceType: source.sourceType,
    sourcePath: source.path,
    parserPreset: source.parserPreset,
    targetDays: profile.targetDays,
    priorityAuthors: profile.priorityAuthors,
    instructions: profile.instructions,
    totalRelevantMessages: cachedMessages.length,
    newRelevantMessages: newRelevantMessages.length,
    assignmentMessages: assignmentMessages.length,
    priorityAuthorMessages: priorityMessages.length,
    latestMessageId:
      cachedMessages.reduce(
        (max, message) => Math.max(max, message.numericId),
        0,
      ) || null,
    latestMessageDate:
      cachedMessages
        .map((message) => message.date)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null,
    sourceFingerprint,
    summary: [
      `${cachedMessages.length} relevant message(s) cached.`,
      deltaSummary,
      `${priorityMessages.length} priority-author message(s).`,
      `${assignmentMessages.length} assignment/day marker message(s).`,
    ].join(" "),
    recentMessages: latestMessages,
    updatedAt: nowIso(),
  };
}

async function scanMessageFile(task, paths) {
  const source = normalizeSource(task.args.source);
  const profile = normalizeBriefingProfile(task.args.briefingProfile);
  if (!source.path || !existsSync(source.path)) {
    throw new Error(`File source not found: ${source.path || "empty path"}`);
  }

  const sourceStat = await stat(source.path);
  const sourceFingerprint = {
    size: sourceStat.size,
    mtimeMs: Math.round(sourceStat.mtimeMs),
  };
  const raw = await readFile(source.path, "utf8");
  const parsed = JSON.parse(raw);
  const rawMessages = Array.isArray(parsed?.messages)
    ? parsed.messages
    : Array.isArray(parsed)
      ? parsed
      : [];
  const normalizedMessages = rawMessages
    .map(normalizeMessage)
    .filter((message) => message !== null);
  const byId = new Map(normalizedMessages.map((message) => [message.id, message]));
  const previousCache = await readJsonFile(paths.messagesCache, {
    messages: [],
    watermark: {
      seenMessageIds: [],
      lastProcessedMessageId: null,
      lastProcessedDate: null,
      sourceFingerprint: null,
    },
  });
  const cacheMatchesSettings =
    previousCache.source?.path === source.path &&
    previousCache.source?.parserPreset === source.parserPreset &&
    stableJson(previousCache.briefingProfile) === stableJson(profile);
  const compatibleCache = cacheMatchesSettings
    ? previousCache
    : {
        messages: [],
        watermark: {
          seenMessageIds: [],
          lastProcessedMessageId: null,
          lastProcessedDate: null,
          sourceFingerprint: null,
        },
      };
  const cachedById = new Map(
    Array.isArray(compatibleCache.messages)
      ? compatibleCache.messages.map((message) => [String(message.id), message])
      : [],
  );
  const seenIds = new Set(
    Array.isArray(compatibleCache.watermark?.seenMessageIds)
      ? compatibleCache.watermark.seenMessageIds.map(String)
      : Array.from(cachedById.keys()),
  );
  const candidates = normalizedMessages.filter((message) => !seenIds.has(message.id));
  const newlyRelevant = [];

  for (const message of candidates) {
    if (!isRelevantMessage(message, profile)) {
      continue;
    }
    const chain = [message, ...addReplyChain(message, byId, profile)];
    for (const item of chain) {
      if (!cachedById.has(item.id)) {
        cachedById.set(item.id, item);
        newlyRelevant.push(item);
      }
    }
  }

  const cachedMessages = Array.from(cachedById.values()).sort(
    (left, right) => left.numericId - right.numericId,
  );
  const latestProcessed = normalizedMessages.at(-1) ?? null;
  const nextCache = {
    source,
    briefingProfile: profile,
    messages: cachedMessages,
    watermark: {
      seenMessageIds: normalizedMessages.map((message) => message.id),
      lastProcessedMessageId: latestProcessed?.id ?? null,
      lastProcessedDate: latestProcessed?.date ?? null,
      sourceFingerprint,
      updatedAt: nowIso(),
    },
  };
  const aggregate = buildAggregate({
    cachedMessages,
    newRelevantMessages: newlyRelevant,
    profile,
    source,
    sourceFingerprint,
  });

  await writeJsonFile(paths.messagesCache, nextCache);
  await writeJsonFile(paths.latestAggregate, aggregate);

  return {
    aggregate,
    cachePath: paths.messagesCache,
    aggregatePath: paths.latestAggregate,
  };
}

function outputSummaryFromResult(result) {
  if (result?.aggregate?.summary) {
    return result.aggregate.summary;
  }
  return "No aggregate returned.";
}

async function appendRun(paths, run) {
  const current = await readJsonFile(paths.runs, { runs: [] });
  const runs = Array.isArray(current.runs) ? current.runs : [];
  const next = {
    runs: [...runs, run].slice(-100),
    updatedAt: nowIso(),
  };
  await writeJsonFile(paths.runs, next);
  return next.runs;
}

async function runTask({ taskId = DEFAULT_TASK_ID, force = false, dataRoot, note }) {
  const { state, paths } = await readState(dataRoot);
  const task = state.tasks.find((item) => item.id === taskId) ?? state.tasks[0];
  const startedAt = Date.now();
  const run = {
    id: makeId("mcp-run"),
    taskId: task.id,
    title: task.title,
    serverId: task.serverId,
    toolName: task.toolName,
    status: "running",
    inputSummary: `${task.serverId}/${task.toolName} ${task.schedule.mode}`,
    outputSummary: "",
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: null,
    durationMs: null,
    savedPaths: [],
    error: null,
    note: note ?? "",
  };

  if (!force && (!state.schedulerEnabled || !task.enabled || !isTaskDue(task))) {
    run.status = "skipped";
    run.outputSummary = "Task is not due or scheduler/task is disabled.";
    run.finishedAt = nowIso();
    run.durationMs = Date.now() - startedAt;
    const runs = await appendRun(paths, run);
    return {
      state,
      paths,
      run,
      runs,
      aggregate: await readJsonFile(paths.latestAggregate, null),
      message: run.outputSummary,
    };
  }

  try {
    if (task.serverId !== "briefing" || task.toolName !== "scan_message_file") {
      throw new Error(`Unsupported scheduled tool: ${task.serverId}/${task.toolName}`);
    }
    const result = await scanMessageFile(task, paths);
    const finishedAt = nowIso();
    const nextTask = {
      ...task,
      lastRunAt: finishedAt,
      nextRunAt:
        state.schedulerEnabled && task.enabled
          ? nextRunAtFor(task.schedule)
          : null,
      runCount: task.runCount + 1,
      lastResult: result.aggregate,
      lastError: null,
      updatedAt: finishedAt,
    };
    const nextState = {
      ...state,
      tasks: state.tasks.map((item) => (item.id === task.id ? nextTask : item)),
      source: nextTask.args.source,
      briefingProfile: nextTask.args.briefingProfile,
      updatedAt: finishedAt,
    };
    await writeState(nextState);
    run.status = "success";
    run.outputSummary = outputSummaryFromResult(result);
    run.finishedAt = finishedAt;
    run.durationMs = Date.now() - startedAt;
    run.savedPaths = [result.cachePath, result.aggregatePath];
    const runs = await appendRun(paths, run);
    return {
      state: nextState,
      paths,
      run,
      runs,
      aggregate: result.aggregate,
      message: "Scheduled MCP task completed.",
    };
  } catch (error) {
    const finishedAt = nowIso();
    const nextTask = {
      ...task,
      lastError: error instanceof Error ? error.message : "Unknown task error.",
      updatedAt: finishedAt,
    };
    const nextState = {
      ...state,
      tasks: state.tasks.map((item) => (item.id === task.id ? nextTask : item)),
      updatedAt: finishedAt,
    };
    await writeState(nextState);
    run.status = "failed";
    run.outputSummary = "Task failed.";
    run.finishedAt = finishedAt;
    run.durationMs = Date.now() - startedAt;
    run.error = nextTask.lastError;
    const runs = await appendRun(paths, run);
    return {
      state: nextState,
      paths,
      run,
      runs,
      aggregate: await readJsonFile(paths.latestAggregate, null),
      message: run.error,
    };
  }
}

function publicStatePayload({ state, paths, runs = [], aggregate = null, message }) {
  const task = state.tasks[0];
  return {
    schedulerEnabled: state.schedulerEnabled,
    dataRoot: state.dataRoot,
    source: state.source,
    briefingProfile: state.briefingProfile,
    task,
    tasks: state.tasks,
    runs,
    latestAggregate: aggregate,
    storagePaths: paths,
    message,
    checkedAt: nowIso(),
  };
}

export async function getSchedulerStatus(input = {}) {
  const { state, paths } = await readState(input.dataRoot);
  const runsFile = await readJsonFile(paths.runs, { runs: [] });
  const aggregate = await readJsonFile(paths.latestAggregate, null);
  return publicStatePayload({
    state,
    paths,
    runs: Array.isArray(runsFile.runs) ? runsFile.runs : [],
    aggregate,
    message: "Scheduler status read.",
  });
}

export async function upsertScheduledTask(input = {}) {
  const dataRoot = await configuredDataRoot(input.dataRoot);
  const { state } = await readState(dataRoot);
  const schedulerEnabled =
    typeof input.schedulerEnabled === "boolean"
      ? input.schedulerEnabled
      : state.schedulerEnabled;
  const source = normalizeSource({
    ...state.source,
    path: input.sourcePath ?? input.source?.path ?? state.source.path,
  });
  const briefingProfile = normalizeBriefingProfile({
    ...state.briefingProfile,
    targetDays: input.targetDays ?? state.briefingProfile.targetDays,
    priorityAuthors:
      input.priorityAuthors ?? state.briefingProfile.priorityAuthors,
    keywords: input.keywords ?? state.briefingProfile.keywords,
    replyDepth: input.replyDepth ?? state.briefingProfile.replyDepth,
    instructions: input.instructions ?? state.briefingProfile.instructions,
  });
  const schedule = normalizeSchedule({
    mode: input.scheduleMode ?? input.schedule?.mode ?? state.tasks[0].schedule.mode,
    intervalSeconds:
      input.intervalSeconds ??
      input.schedule?.intervalSeconds ??
      state.tasks[0].schedule.intervalSeconds,
    dailyTime:
      input.dailyTime ?? input.schedule?.dailyTime ?? state.tasks[0].schedule.dailyTime,
  });
  const updatedAt = nowIso();
  const taskEnabled =
    typeof input.taskEnabled === "boolean"
      ? input.taskEnabled
      : state.tasks[0].enabled;
  const nextTask = {
    ...state.tasks[0],
    enabled: taskEnabled,
    args: {
      source,
      briefingProfile,
    },
    schedule,
    nextRunAt:
      schedulerEnabled && taskEnabled ? nextRunAtFor(schedule) : null,
    updatedAt,
  };
  const nextState = {
    ...state,
    schedulerEnabled,
    dataRoot,
    source,
    briefingProfile,
    tasks: [nextTask],
    updatedAt,
  };
  const paths = await writeState(nextState);
  const runsFile = await readJsonFile(paths.runs, { runs: [] });
  const aggregate = await readJsonFile(paths.latestAggregate, null);
  return publicStatePayload({
    state: nextState,
    paths,
    runs: Array.isArray(runsFile.runs) ? runsFile.runs : [],
    aggregate,
    message: "Scheduler settings saved.",
  });
}

export async function toggleScheduledTask(input = {}) {
  let dataRoot = input.dataRoot;
  if (hasTaskSettings(input)) {
    const saved = await upsertScheduledTask(input);
    dataRoot = saved.dataRoot;
  }

  const { state } = await readState(dataRoot);
  const updatedAt = nowIso();
  const task = state.tasks[0];
  const schedulerEnabled =
    typeof input.schedulerEnabled === "boolean"
      ? input.schedulerEnabled
      : state.schedulerEnabled;
  const taskEnabled =
    typeof input.taskEnabled === "boolean" ? input.taskEnabled : task.enabled;
  const nextTask = {
    ...task,
    enabled: taskEnabled,
    nextRunAt:
      schedulerEnabled && taskEnabled
        ? task.nextRunAt ?? nextRunAtFor(task.schedule)
        : null,
    updatedAt,
  };
  const nextState = {
    ...state,
    schedulerEnabled,
    tasks: [nextTask],
    updatedAt,
  };
  const paths = await writeState(nextState);
  const runsFile = await readJsonFile(paths.runs, { runs: [] });
  const aggregate = await readJsonFile(paths.latestAggregate, null);
  return publicStatePayload({
    state: nextState,
    paths,
    runs: Array.isArray(runsFile.runs) ? runsFile.runs : [],
    aggregate,
    message: "Scheduler toggles saved.",
  });
}

function hasTaskSettings(input = {}) {
  return [
    "sourcePath",
    "source",
    "targetDays",
    "priorityAuthors",
    "keywords",
    "replyDepth",
    "instructions",
    "schedulerEnabled",
    "taskEnabled",
    "scheduleMode",
    "schedule",
    "intervalSeconds",
    "dailyTime",
  ].some((key) => Object.hasOwn(input, key));
}

export async function runScheduledTask(input = {}) {
  let dataRoot = input.dataRoot;
  if (hasTaskSettings(input)) {
    const saved = await upsertScheduledTask(input);
    dataRoot = saved.dataRoot;
  }

  const result = await runTask({
    dataRoot,
    taskId: input.taskId ?? DEFAULT_TASK_ID,
    force: input.force === true,
    note: input.note,
  });
  return publicStatePayload({
    state: result.state,
    paths: result.paths,
    runs: result.runs,
    aggregate: result.aggregate,
    message: result.message,
  });
}

export async function resetScheduler(input = {}) {
  const dataRoot = await configuredDataRoot(input.dataRoot);
  const state = defaultState(dataRoot);
  const paths = await writeState(state);
  await writeJsonFile(paths.runs, { runs: [], updatedAt: nowIso() });
  await writeJsonFile(paths.messagesCache, {
    messages: [],
    watermark: {
      seenMessageIds: [],
      updatedAt: nowIso(),
    },
  });
  await writeJsonFile(paths.latestAggregate, null);
  return publicStatePayload({
    state,
    paths,
    runs: [],
    aggregate: null,
    message: "Scheduler reset.",
  });
}

export async function runDueTasks(input = {}) {
  const { state } = await readState(input.dataRoot);
  if (!state.schedulerEnabled) {
    return getSchedulerStatus(input);
  }
  const task = state.tasks[0];
  if (!task.enabled || !isTaskDue(task)) {
    return getSchedulerStatus(input);
  }
  return runScheduledTask({
    dataRoot: state.dataRoot,
    taskId: task.id,
    force: false,
    note: "worker due tick",
  });
}
