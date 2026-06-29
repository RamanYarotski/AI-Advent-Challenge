#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import {
  getSchedulerStatus,
  resetScheduler,
  runScheduledTask,
  toggleScheduledTask,
  upsertScheduledTask,
} from "./day18-scheduler-core.mjs";

const server = new McpServer({
  name: "ai-advent-day18-scheduler",
  version: "2.0.0",
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

const baseSettingsSchema = {
  dataRoot: z.string().optional(),
  sourcePath: z.string().optional(),
  targetDays: z.array(z.number()).optional(),
  priorityAuthors: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  replyDepth: z.number().int().min(0).max(3).optional(),
  instructions: z.string().optional(),
  schedulerEnabled: z.boolean().optional(),
  taskEnabled: z.boolean().optional(),
  scheduleMode: z.enum(["manual", "interval", "daily"]).optional(),
  intervalSeconds: z.number().int().min(10).max(86400).optional(),
  dailyTime: z.string().optional(),
};

server.registerTool(
  "get_scheduler_status",
  {
    title: "Get scheduler status",
    description:
      "Read the generic Day 18 scheduler settings, scheduled task state, latest briefing aggregate, and recent activity runs.",
    inputSchema: {
      dataRoot: z.string().optional(),
    },
  },
  async (input) => resultPayload(await getSchedulerStatus(input)),
);

server.registerTool(
  "upsert_scheduled_task",
  {
    title: "Upsert scheduled task",
    description:
      "Save scheduler settings for a generic MCP task that scans a message export file.",
    inputSchema: baseSettingsSchema,
  },
  async (input) => resultPayload(await upsertScheduledTask(input)),
);

server.registerTool(
  "toggle_scheduled_task",
  {
    title: "Toggle scheduled task",
    description:
      "Enable or disable the scheduler and its default briefing file scan task.",
    inputSchema: {
      ...baseSettingsSchema,
    },
  },
  async (input) => resultPayload(await toggleScheduledTask(input)),
);

server.registerTool(
  "run_scheduled_task",
  {
    title: "Run scheduled task",
    description:
      "Run the configured MCP scheduler task now or when it is due, persisting the result and activity trace.",
    inputSchema: {
      ...baseSettingsSchema,
      taskId: z.string().optional(),
      force: z.boolean().optional(),
      note: z.string().optional(),
    },
  },
  async (input) => resultPayload(await runScheduledTask(input)),
);

server.registerTool(
  "reset_scheduler",
  {
    title: "Reset scheduler",
    description:
      "Reset the Day 18 scheduler state, recent runs, and cached briefing messages.",
    inputSchema: {
      dataRoot: z.string().optional(),
    },
  },
  async (input) => resultPayload(await resetScheduler(input)),
);

const transport = new StdioServerTransport();

server.connect(transport).catch((error) => {
  console.error("Day 18 scheduler MCP server failed:", error);
  process.exit(1);
});
