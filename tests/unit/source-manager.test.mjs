import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "vitest";

import {
  MAX_UPLOAD_BYTES,
  saveUploadedFiles,
  validateAndNormalizeSourceRecord,
  validateUploadFile,
} from "../../lib/rag/source-manager.mjs";

const cleanupDirs = [];

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

function makeFile(name, content) {
  return new File([content], name, { type: "text/plain" });
}

test("source records infer and normalize supported source types", () => {
  const github = validateAndNormalizeSourceRecord({
    value: " https://github.com/openai/example ",
    enabled: "off",
    documentCount: "3.9",
    status: "surprise",
  });

  assert.equal(github.type, "github");
  assert.equal(github.value, "https://github.com/openai/example");
  assert.equal(github.enabled, false);
  assert.equal(github.documentCount, 3);
  assert.equal(github.status, "ready");
  assert.match(github.id, /^github-/);

  const site = validateAndNormalizeSourceRecord({
    type: "site",
    value: "https://docs.example.test/guide",
    label: " Docs Guide ",
  });

  assert.equal(site.type, "site");
  assert.equal(site.label, "Docs Guide");

  assert.throws(
    () => validateAndNormalizeSourceRecord({ type: "github", value: "https://gitlab.com/acme/repo" }),
    /GitHub source must point to github\.com/,
  );
  assert.throws(
    () => validateAndNormalizeSourceRecord({ type: "url", value: "docs/day-21.md" }),
    /url source must be an http\(s\) URL/,
  );
});

test("upload validation rejects unsupported extensions and oversized files", async () => {
  assert.deepEqual(validateUploadFile({ name: "notes.md", size: 42 }), {
    ok: true,
    name: "notes.md",
    extension: ".md",
  });

  assert.equal(validateUploadFile({ name: "archive.exe", size: 42 }).ok, false);
  assert.match(validateUploadFile({ name: "archive.exe", size: 42 }).reason, /Unsupported extension/);

  const tooLarge = validateUploadFile({ name: "large.md", size: MAX_UPLOAD_BYTES + 1 });
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.reason, "File is larger than 25MB.");

  const dataRoot = await makeTempDir("rag-upload-");
  const formData = new FormData();
  formData.set("batchId", "Batch 01");
  formData.append("files", makeFile("../notes.md", "alpha ".repeat(30)));
  formData.append("files", makeFile("notes.md", "beta ".repeat(30)));
  formData.append("files", makeFile("run.exe", "not accepted"));

  const result = await saveUploadedFiles({ dataRoot, formData });

  assert.equal(result.batchId, "Batch-01");
  assert.equal(result.uploaded.length, 2);
  assert.deepEqual(
    result.uploaded.map((source) => source.metadata.safeFileName),
    ["notes.md", "notes-2.md"],
  );
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].name, "run.exe");
  assert.match(result.rejected[0].reason, /Unsupported extension/);
});
