#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import {
  buildChallengeDigest,
  extractBriefingMessages,
  saveChallengeDigest,
} from "./day19-briefing-core.mjs";

const server = new McpServer({
  name: "ai-advent-day19-briefing",
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

const briefingSelectionSchema = {
  dataRoot: z.string().optional(),
  targetDays: z.array(z.number()).optional(),
  priorityAuthors: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  maxMessages: z.number().int().min(10).max(500).optional(),
  selectionMode: z.enum(["cached_relevant", "focused"]).optional(),
};

server.registerTool(
  "extract_briefing_messages",
  {
    title: "Extract briefing messages",
    description:
      "Read the Day 18 briefing cache and extract a focused message set for a challenge digest.",
    inputSchema: briefingSelectionSchema,
  },
  async (input) => resultPayload(await extractBriefingMessages(input)),
);

server.registerTool(
  "build_challenge_digest",
  {
    title: "Build challenge digest",
    description:
      "Build a deterministic challenge briefing digest from extracted messages.",
    inputSchema: {
      ...briefingSelectionSchema,
      extraction: z.any().optional(),
      extractionPath: z.string().optional(),
      messageLimit: z.number().int().min(5).max(80).optional(),
    },
  },
  async (input) => resultPayload(await buildChallengeDigest(input)),
);

server.registerTool(
  "save_challenge_digest",
  {
    title: "Save challenge digest",
    description:
      "Persist a built challenge digest as JSON and Markdown for later MCP orchestration.",
    inputSchema: {
      dataRoot: z.string().optional(),
      digest: z.any().optional(),
      digestPath: z.string().optional(),
    },
  },
  async (input) => resultPayload(await saveChallengeDigest(input)),
);

const transport = new StdioServerTransport();

server.connect(transport).catch((error) => {
  console.error("Day 19 briefing MCP server failed:", error);
  process.exit(1);
});
