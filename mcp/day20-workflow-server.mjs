#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import {
  getLatestOrchestrationReport,
  prepareNextDayBranch,
  saveOrchestrationReport,
} from "./day20-workflow-core.mjs";

const server = new McpServer({
  name: "ai-advent-day20-workflow",
  version: "1.0.0",
});

function resultPayload(structuredContent) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
  };
}

server.registerTool(
  "get_latest_orchestration_report",
  {
    title: "Get latest orchestration report",
    description:
      "Read the latest Day 20 MCP orchestration report from the configured data root.",
    inputSchema: {
      dataRoot: z.string().optional(),
    },
  },
  async (input) => resultPayload(await getLatestOrchestrationReport(input)),
);

server.registerTool(
  "save_orchestration_report",
  {
    title: "Save orchestration report",
    description:
      "Persist the Day 20 cross-MCP workflow report as JSON and Markdown.",
    inputSchema: {
      dataRoot: z.string().optional(),
      action: z.string().optional(),
      workflow: z.any().optional(),
      digest: z.any().optional(),
      digestMarkdown: z.string().optional(),
      gitStatus: z.any().optional(),
      branchPlan: z.any().optional(),
      steps: z.array(z.any()).optional(),
      sourceArtifacts: z.array(z.string()).optional(),
      notes: z.array(z.string()).optional(),
    },
  },
  async (input) => resultPayload(await saveOrchestrationReport(input)),
);

server.registerTool(
  "prepare_next_day_branch",
  {
    title: "Prepare next-day branch",
    description:
      "Preview or explicitly create a Git branch for the next challenge day.",
    inputSchema: {
      nextDay: z.number().int().min(1).max(100).optional(),
      branchName: z.string().optional(),
      createBranch: z.boolean().optional(),
      allowDirty: z.boolean().optional(),
    },
  },
  async (input) => resultPayload(await prepareNextDayBranch(input)),
);

const transport = new StdioServerTransport();

server.connect(transport).catch((error) => {
  console.error("Day 20 workflow MCP server failed:", error);
  process.exit(1);
});
