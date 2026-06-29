#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const execFileAsync = promisify(execFile);
const repositoryRoot = process.argv[2] || process.cwd();
const safeDirectory = repositoryRoot.replace(/\\/g, "/");

async function git(args) {
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

function parseChangedFile(line) {
  const pathStart = line[2] === " " ? 3 : line[1] === " " ? 2 : 3;

  return {
    status: line.slice(0, 2).trim() || "untracked",
    path: line.slice(pathStart).trim(),
    raw: line,
  };
}

function parseRecentCommit(line) {
  const [hash, ...subjectParts] = line.split("\t");

  return {
    hash: hash || "",
    subject: subjectParts.join("\t") || "",
  };
}

async function currentBranch() {
  const branch = await git(["branch", "--show-current"]);
  if (branch) {
    return branch;
  }

  const hash = await git(["rev-parse", "--short", "HEAD"]);
  return `detached:${hash}`;
}

async function readRepositoryStatus({
  includeChangedFiles,
  includeRecentCommits,
}) {
  const [branch, statusOutput, commitsOutput] = await Promise.all([
    currentBranch(),
    git(["status", "--short"]),
    includeRecentCommits
      ? git(["log", "--pretty=format:%h%x09%s", "-5"])
      : Promise.resolve(""),
  ]);
  const statusLines = statusOutput
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const changedFiles = includeChangedFiles
    ? statusLines.map(parseChangedFile)
    : [];
  const recentCommits = commitsOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseRecentCommit);

  return {
    repositoryRoot,
    branch,
    isClean: statusLines.length === 0,
    changedFileCount: statusLines.length,
    changedFiles,
    recentCommits,
    checkedAt: new Date().toISOString(),
  };
}

const server = new McpServer({
  name: "ai-advent-day17-git",
  version: "1.0.0",
});

server.registerTool(
  "get_repository_status",
  {
    title: "Get repository status",
    description:
      "Read the current Git branch, working tree changes, and recent commits for the AI Advent Challenge project.",
    inputSchema: {
      includeChangedFiles: z
        .boolean()
        .optional()
        .describe("Whether to include changed file details."),
      includeRecentCommits: z
        .boolean()
        .optional()
        .describe("Whether to include the latest commits."),
    },
    outputSchema: {
      repositoryRoot: z.string(),
      branch: z.string(),
      isClean: z.boolean(),
      changedFileCount: z.number(),
      changedFiles: z.array(
        z.object({
          status: z.string(),
          path: z.string(),
          raw: z.string(),
        }),
      ),
      recentCommits: z.array(
        z.object({
          hash: z.string(),
          subject: z.string(),
        }),
      ),
      checkedAt: z.string(),
    },
  },
  async ({
    includeChangedFiles = true,
    includeRecentCommits = true,
  }) => {
    const structuredContent = await readRepositoryStatus({
      includeChangedFiles,
      includeRecentCommits,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(structuredContent, null, 2),
        },
      ],
      structuredContent,
    };
  },
);

const transport = new StdioServerTransport();

server.connect(transport).catch((error) => {
  console.error("Day 17 Git MCP server failed:", error);
  process.exit(1);
});
