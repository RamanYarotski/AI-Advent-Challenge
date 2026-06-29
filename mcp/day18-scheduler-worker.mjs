#!/usr/bin/env node
import { runDueTasks } from "./day18-scheduler-core.mjs";

const dataRoot = process.argv[2];
const pollMs = 5000;

async function loop() {
  while (true) {
    try {
      await runDueTasks({ dataRoot });
    } catch (error) {
      console.error(
        "Day 18 scheduler worker tick failed:",
        error instanceof Error ? error.message : error,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

loop().catch((error) => {
  console.error("Day 18 scheduler worker failed:", error);
  process.exit(1);
});
