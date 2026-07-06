import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SOURCE_MANAGER_DATA_ROOT } from "./source-manager.mjs";

const ARTIFACTS = {
  day21_report: {
    label: "Report",
    relativePath: path.join("reports", "day-21-indexing.md"),
    contentType: "text/markdown; charset=utf-8",
    fileName: "day-21-indexing.md",
  },
  manifest: {
    label: "Manifest",
    relativePath: "manifest.json",
    contentType: "application/json; charset=utf-8",
    fileName: "manifest.json",
  },
  fixed_index: {
    label: "Fixed index JSON",
    relativePath: path.join("indexes", "fixed.json"),
    contentType: "application/json; charset=utf-8",
    fileName: "fixed-index.json",
  },
  structural_index: {
    label: "Structural index JSON",
    relativePath: path.join("indexes", "structural.json"),
    contentType: "application/json; charset=utf-8",
    fileName: "structural-index.json",
  },
};

function resolveDataRoot(value) {
  return path.resolve(/*turbopackIgnore: true*/ value || DEFAULT_SOURCE_MANAGER_DATA_ROOT);
}

export function listRagArtifacts(input = {}) {
  const dataRoot = resolveDataRoot(input.dataRoot);
  return Object.entries(ARTIFACTS).map(([key, artifact]) => ({
    key,
    label: artifact.label,
    fileName: artifact.fileName,
    contentType: artifact.contentType,
    path: path.join(dataRoot, artifact.relativePath),
  }));
}

export async function readRagArtifact(input = {}) {
  const key = String(input.key || "");
  const artifact = ARTIFACTS[key];
  if (!artifact) {
    throw new Error(`Unknown RAG artifact: ${key}`);
  }
  const dataRoot = resolveDataRoot(input.dataRoot);
  const filePath = path.join(dataRoot, artifact.relativePath);
  const content = await readFile(filePath, "utf8");
  return {
    key,
    label: artifact.label,
    fileName: artifact.fileName,
    contentType: artifact.contentType,
    path: filePath,
    content,
  };
}
