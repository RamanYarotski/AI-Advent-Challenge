import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const DEFAULT_DATA_ROOT = path.join(process.cwd(), ".data", "mcp-workflows");
const INDEX_FILE = path.join(process.cwd(), ".data", "day-18", "scheduler-index.json");

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
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

function workflowPaths(dataRoot) {
  return {
    reportsDir: path.join(dataRoot, "reports"),
    reportIndex: path.join(dataRoot, "reports", "index.json"),
    latestJson: path.join(dataRoot, "reports", "latest-day20-orchestration.json"),
    latestMarkdown: path.join(dataRoot, "reports", "latest-day20-orchestration.md"),
  };
}

function safeText(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function summarizeDigest(digest, digestMarkdown) {
  if (isRecord(digest)) {
    return {
      id: safeText(digest.id, null),
      title: safeText(digest.title, "Challenge digest"),
      summary: safeText(digest.summary, "No digest summary returned."),
      sourcePath: safeText(digest.sourcePath, ""),
      generatedAt: safeText(digest.generatedAt, ""),
      savedAt: safeText(digest.savedAt, ""),
    };
  }

  const firstLine = safeText(digestMarkdown)
    .split(/\r?\n/)
    .find((line) => line.trim());

  return {
    id: null,
    title: firstLine?.replace(/^#\s*/, "") || "Challenge digest",
    summary: digestMarkdown
      ? digestMarkdown.replace(/\s+/g, " ").trim().slice(0, 360)
      : "No digest available.",
    sourcePath: "",
    generatedAt: "",
    savedAt: "",
  };
}

function renderStepLine(step) {
  return `- ${step.startedAt || "n/a"} | ${step.status || "unknown"} | ${step.serverId || "server"}/${step.toolName || "tool"} | ${step.durationMs ?? "n/a"} ms | ${step.outputSummary || step.error || "no details"}`;
}

function renderReportMarkdown(report) {
  const lines = [
    `# ${report.title}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Data root: ${report.dataRoot}`,
    "",
    "## Workflow",
    "",
    report.workflow?.summary || "No workflow summary.",
    "",
    "## Digest",
    "",
    `Title: ${report.digestSummary.title}`,
    "",
    report.digestSummary.summary,
    "",
    "## Git",
    "",
    `Branch: ${report.gitStatus?.branch || "unknown"}`,
    `Clean: ${report.gitStatus?.isClean === true ? "yes" : "no"}`,
    `Changed files: ${report.gitStatus?.changedFileCount ?? "n/a"}`,
    "",
    "## Next Branch",
    "",
    `Target: ${report.branchPlan?.targetBranch || "n/a"}`,
    `Status: ${report.branchPlan?.status || "n/a"}`,
    report.branchPlan?.message || "",
    "",
    "## MCP Step Trace",
    "",
    ...(report.steps.length ? report.steps.map(renderStepLine) : ["No steps recorded."]),
    "",
  ];

  if (report.digestMarkdownExcerpt) {
    lines.push("## Digest Excerpt", "", report.digestMarkdownExcerpt, "");
  }

  return lines.join("\n");
}

export async function saveOrchestrationReport(input = {}) {
  const dataRoot = await configuredDataRoot(input.dataRoot);
  const paths = workflowPaths(dataRoot);
  const generatedAt = nowIso();
  const digestMarkdown = safeText(input.digestMarkdown);
  const steps = asArray(input.steps).filter(isRecord);
  const report = {
    id: makeId("day20-orchestration"),
    title: "Day 20 MCP orchestration report",
    dataRoot,
    generatedAt,
    workflow: isRecord(input.workflow)
      ? input.workflow
      : {
          action: safeText(input.action, "run_workflow"),
          summary: "Day 20 workflow report.",
        },
    digestSummary: summarizeDigest(input.digest, digestMarkdown),
    digestMarkdownExcerpt: digestMarkdown.slice(0, 1800),
    gitStatus: isRecord(input.gitStatus) ? input.gitStatus : null,
    branchPlan: isRecord(input.branchPlan) ? input.branchPlan : null,
    steps,
    sourceArtifacts: asArray(input.sourceArtifacts).map(String),
    notes: asArray(input.notes).map(String),
    savedPaths: {},
  };
  const jsonPath = path.join(paths.reportsDir, `${report.id}.json`);
  const markdownPath = path.join(paths.reportsDir, `${report.id}.md`);
  const savedReport = {
    ...report,
    savedPaths: {
      json: jsonPath,
      markdown: markdownPath,
      latestJson: paths.latestJson,
      latestMarkdown: paths.latestMarkdown,
    },
  };
  const markdown = renderReportMarkdown(savedReport);

  await writeJsonFile(jsonPath, savedReport);
  await writeJsonFile(paths.latestJson, savedReport);
  await mkdir(paths.reportsDir, { recursive: true });
  await writeFile(markdownPath, markdown, "utf8");
  await writeFile(paths.latestMarkdown, markdown, "utf8");

  const index = await readJsonFile(paths.reportIndex, { reports: [] });
  const reports = asArray(index.reports);
  await writeJsonFile(paths.reportIndex, {
    reports: [
      {
        id: savedReport.id,
        title: savedReport.title,
        generatedAt: savedReport.generatedAt,
        jsonPath,
        markdownPath,
      },
      ...reports.filter((item) => item?.id !== savedReport.id),
    ].slice(0, 50),
    updatedAt: nowIso(),
  });

  return {
    step: "save_orchestration_report",
    message: `Day 20 orchestration report saved to ${paths.reportsDir}.`,
    report: savedReport,
    savedPaths: [
      jsonPath,
      markdownPath,
      paths.latestJson,
      paths.latestMarkdown,
      paths.reportIndex,
    ],
    storagePaths: paths,
    checkedAt: nowIso(),
  };
}

export async function getLatestOrchestrationReport(input = {}) {
  const dataRoot = await configuredDataRoot(input.dataRoot);
  const paths = workflowPaths(dataRoot);
  const report = await readJsonFile(paths.latestJson, null);

  return {
    step: "get_latest_orchestration_report",
    message: report
      ? "Latest Day 20 orchestration report loaded."
      : "No Day 20 orchestration report has been saved yet.",
    report,
    savedPaths: report?.savedPaths ? Object.values(report.savedPaths) : [],
    storagePaths: paths,
    checkedAt: nowIso(),
  };
}

async function git(args) {
  const repositoryRoot = process.cwd();
  const safeDirectory = repositoryRoot.replace(/\\/g, "/");
  const { stdout } = await execFileAsync(
    "git",
    ["-c", `safe.directory=${safeDirectory}`, "-C", repositoryRoot, ...args],
    {
      maxBuffer: 1024 * 1024,
      timeout: 10000,
      windowsHide: true,
    },
  );

  return stdout.trim();
}

async function currentBranch() {
  const branch = await git(["branch", "--show-current"]);
  if (branch) {
    return branch;
  }
  const hash = await git(["rev-parse", "--short", "HEAD"]);
  return `detached:${hash}`;
}

function nextDayFromBranch(branch, fallback = 21) {
  const match = /^Day_(\d+)$/i.exec(branch || "");
  if (!match) {
    return fallback;
  }
  return safeNumber(Number.parseInt(match[1], 10) + 1, fallback);
}

async function refExists(ref) {
  try {
    await git(["show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

async function statusLines() {
  const output = await git(["status", "--short"]);
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

export async function prepareNextDayBranch(input = {}) {
  const checkedAt = nowIso();
  const branch = await currentBranch();
  const nextDay = safeNumber(input.nextDay, nextDayFromBranch(branch));
  const targetBranch = safeText(input.branchName, `Day_${nextDay}`);
  const createBranch = input.createBranch === true;
  const allowDirty = input.allowDirty === true;
  const changedFiles = await statusLines();
  const localExists = await refExists(`refs/heads/${targetBranch}`);
  const remoteExists = await refExists(`refs/remotes/origin/${targetBranch}`);
  const isClean = changedFiles.length === 0;
  const basePlan = {
    currentBranch: branch,
    targetBranch,
    nextDay,
    createBranch,
    allowDirty,
    isClean,
    changedFileCount: changedFiles.length,
    localExists,
    remoteExists,
    checkedAt,
  };

  if (!createBranch) {
    const previewStatus =
      !isClean && !allowDirty
        ? "blocked"
        : localExists || remoteExists
          ? "exists"
          : "ready";
    const previewMessage =
      !isClean && !allowDirty
        ? `${targetBranch} can be created after the current work is clean.`
        : localExists
          ? `${targetBranch} already exists locally.`
          : remoteExists
            ? `${targetBranch} exists in origin tracking refs.`
            : `${targetBranch} can be created now.`;

    return {
      step: "prepare_next_day_branch",
      message: `Preview prepared for ${targetBranch}.`,
      branchPlan: {
        ...basePlan,
        status: previewStatus,
        message: previewMessage,
        changedFiles: changedFiles.slice(0, 20),
      },
      checkedAt,
    };
  }

  if (!isClean && !allowDirty) {
    return {
      step: "prepare_next_day_branch",
      message: `Branch creation blocked because the working tree has ${changedFiles.length} changed file(s).`,
      branchPlan: {
        ...basePlan,
        status: "blocked",
        message:
          "Commit or stash current changes before creating the next-day branch.",
        changedFiles: changedFiles.slice(0, 20),
      },
      checkedAt,
    };
  }

  if (branch === targetBranch) {
    return {
      step: "prepare_next_day_branch",
      message: `Already on ${targetBranch}.`,
      branchPlan: {
        ...basePlan,
        status: "already_current",
        message: `Current branch is already ${targetBranch}.`,
      },
      checkedAt,
    };
  }

  if (localExists) {
    await git(["switch", targetBranch]);
    return {
      step: "prepare_next_day_branch",
      message: `Switched to existing ${targetBranch}.`,
      branchPlan: {
        ...basePlan,
        status: "switched",
        message: `Switched to existing local branch ${targetBranch}.`,
      },
      checkedAt: nowIso(),
    };
  }

  await git(["switch", "-c", targetBranch]);
  return {
    step: "prepare_next_day_branch",
    message: `Created and switched to ${targetBranch}.`,
    branchPlan: {
      ...basePlan,
      status: "created",
      message: `Created local branch ${targetBranch} from ${branch}.`,
    },
    checkedAt: nowIso(),
  };
}
