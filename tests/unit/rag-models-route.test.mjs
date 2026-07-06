import assert from "node:assert/strict";
import { afterEach, test } from "vitest";

import { GET } from "../../app/api/rag/models/route.js";

const keys = [
  "DEFAULT_MODEL",
  "MODEL_WEAK",
  "MODEL_MEDIUM",
  "MODEL_STRONG",
  "OPENAI_COMPATIBLE_API_KEY",
];
const originalEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
});

test("/api/rag/models returns model ids but no provider secrets", async () => {
  process.env.DEFAULT_MODEL = "openai/gpt-4o";
  process.env.MODEL_WEAK = "openai/gpt-4o-mini";
  process.env.MODEL_MEDIUM = "openai/gpt-4o-mini";
  process.env.MODEL_STRONG = "qwen/qwen3-32b";
  process.env.OPENAI_COMPATIBLE_API_KEY = "secret-key";

  const response = await GET();
  const payload = await response.json();

  assert.deepEqual(
    payload.models.map((model) => model.id),
    ["openai/gpt-4o", "openai/gpt-4o-mini", "qwen/qwen3-32b"],
  );
  assert.deepEqual(
    payload.models.map((model) => model.envKey),
    ["DEFAULT_MODEL", "MODEL_WEAK", "MODEL_STRONG"],
  );
  assert.doesNotMatch(JSON.stringify(payload), /secret-key/);
});
