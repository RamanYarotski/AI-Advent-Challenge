import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "vitest";

import {
  isReadableExtractedText,
  runRagQuery,
  sanitizeExtractedText,
} from "../../lib/rag/core.mjs";

const cleanupDirs = [];

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

test("readability helper accepts normal Russian text and rejects PDF-like garbage", () => {
  const russianText =
    "Искусственный интеллект изучает методы решения задач, поиска, представления знаний и обработки естественного языка. ".repeat(
      3,
    );
  const garbageText =
    "%PDF-1.7 \u0000\u0001\u001f xref stream \u0081\u0099 ÿþ ö¢ ¯ q¡ R¨ÛÇvY[GìS¦¡dRw¹IÚ&ï5¼Yl{Ü ".repeat(
      5,
    );

  assert.equal(isReadableExtractedText(russianText), true);
  assert.equal(isReadableExtractedText(garbageText), false);
  assert.equal(sanitizeExtractedText("alpha\u0000 beta\uFFFD gamma"), "alpha beta gamma");
});

test("local extractive answer never prints unreadable indexed chunk text", async () => {
  const dataRoot = await makeTempDir("rag-garbage-answer-");
  const garbage =
    "%PDF-1.7 \u0000\u0001\u001f xref stream \u0081\u0099 ÿþ ö¢ ¯ q¡ R¨ÛÇvY[GìS¦¡dRw¹IÚ&ï5¼Yl{Ü ".repeat(
      8,
    );
  await mkdir(path.join(dataRoot, "indexes"), { recursive: true });
  const index = {
    strategy: "structural",
    embedding: { provider: "local_hash", dimensions: 256 },
    chunks: [
      {
        id: "bad-1",
        text: garbage,
        embedding: Array.from({ length: 256 }, (_, index) => (index === 0 ? 1 : 0)),
        estimatedTokens: 200,
        metadata: {
          source: "bad.pdf",
          title: "bad.pdf",
          section: "PDF stream",
          chunk_id: "bad-1",
          strategy: "structural",
        },
      },
    ],
  };
  await writeFile(path.join(dataRoot, "indexes", "structural.json"), JSON.stringify(index), "utf8");

  const result = await runRagQuery({
    question: "кто ввел термин ИИ?",
    dataRoot,
    strategy: "structural",
    topK: 1,
    generationMode: "local",
  });

  assert.match(result.rag.answer, /Без контекста/);
  assert.doesNotMatch(result.rag.answer, /xref stream/);
  assert.doesNotMatch(result.rag.answer, /ÛÇvY/);
});
