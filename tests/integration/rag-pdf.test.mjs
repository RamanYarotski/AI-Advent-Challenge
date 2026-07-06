import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "vitest";

import {
  extractPdfTextFromBuffer,
  isReadableExtractedText,
  loadDocuments,
  runDay21Indexing,
  runRagQuery,
} from "../../lib/rag/core.mjs";

const cleanupDirs = [];
const userRussianPdf = "C:/Users/Raman/Downloads/Искусственный_интеллект.pdf";

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

function simplePdfBuffer(text) {
  const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += object;
  }
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

test("extractPdfTextFromBuffer extracts readable text from a PDF fixture", async () => {
  const pdfText =
    "Artificial intelligence term was introduced by John McCarthy at the Dartmouth workshop. This PDF fixture has enough ordinary words for readability checks. ".repeat(
      3,
    );

  const text = await extractPdfTextFromBuffer(simplePdfBuffer(pdfText));

  assert.match(text, /John McCarthy/);
  assert.equal(isReadableExtractedText(text), true);
});

test.runIf(existsSync(userRussianPdf))(
  "extractPdfTextFromBuffer extracts readable Russian text from the user PDF",
  async () => {
    const text = await extractPdfTextFromBuffer(await readFile(userRussianPdf));

    assert.equal(isReadableExtractedText(text), true);
    assert.match(text, /искусствен/i);
    assert.doesNotMatch(text, /^%PDF|endobj|xref/);
  },
);

test.runIf(existsSync(userRussianPdf))(
  "Day 22 answers a known Russian PDF question with readable context",
  async () => {
    const dataRoot = await makeTempDir("rag-user-pdf-query-");
    await runDay21Indexing({
      dataRoot,
      useSourceManager: false,
      sourceInputs: [userRussianPdf],
    });

    const result = await runRagQuery({
      dataRoot,
      question: "кто ввел термин ИИ?",
      strategy: "structural",
      topK: 8,
      generationMode: "local",
    });

    assert.match(result.rag.answer, /Маккарти/i);
    assert.doesNotMatch(result.rag.answer, /^%PDF|endobj|xref/);
    assert.ok(result.matches.every((match) => isReadableExtractedText(match.text)));
  },
);

test("Day 21 indexes local PDF text without binary chunks", async () => {
  const root = await makeTempDir("rag-local-pdf-root-");
  const dataRoot = await makeTempDir("rag-local-pdf-data-");
  const pdfText =
    "Artificial intelligence term was introduced by John McCarthy at the Dartmouth workshop. This source proves PDF extraction can be indexed as readable text. ".repeat(
      4,
    );
  await writeFile(path.join(root, "ai.pdf"), simplePdfBuffer(pdfText));

  const result = await runDay21Indexing({
    root,
    dataRoot,
    useSourceManager: false,
    sourceInputs: ["ai.pdf"],
  });

  assert.equal(result.structural.documents.length, 1);
  const indexedText = result.structural.chunks.map((chunk) => chunk.text).join("\n");
  assert.match(indexedText, /John McCarthy/);
  assert.doesNotMatch(indexedText, /^%PDF|endobj|xref/);
  assert.deepEqual(result.structural.sourceSummaries, [
    {
      input: "ai.pdf",
      type: "local_path",
      documentCount: 1,
    },
  ]);
});

test("URL PDF ingestion reads arrayBuffer and extracts readable text", async () => {
  const originalFetch = globalThis.fetch;
  const pdfText =
    "Artificial intelligence term was introduced by John McCarthy at the Dartmouth workshop. The URL PDF fixture is fetched as bytes, not as response text. ".repeat(
      4,
    );
  const pdf = simplePdfBuffer(pdfText);

  globalThis.fetch = async () =>
    new Response(pdf, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-length": String(pdf.byteLength),
      },
    });

  try {
    const loaded = await loadDocuments({
      useSourceManager: false,
      sourceInputs: [{ input: "https://example.test/ai.pdf", type: "url" }],
    });

    assert.equal(loaded.documents.length, 1);
    assert.equal(loaded.documents[0].format, "pdf");
    assert.match(loaded.documents[0].text, /John McCarthy/);
    assert.deepEqual(loaded.warnings, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("site crawl can ingest a PDF URL without response.text garbage", async () => {
  const originalFetch = globalThis.fetch;
  const pdfText =
    "Artificial intelligence term was introduced by John McCarthy at the Dartmouth workshop. The site crawl fixture treats PDF pages as binary documents. ".repeat(
      4,
    );
  const pdf = simplePdfBuffer(pdfText);

  globalThis.fetch = async () =>
    new Response(pdf, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-length": String(pdf.byteLength),
      },
    });

  try {
    const loaded = await loadDocuments({
      useSourceManager: false,
      sourceInputs: [{ input: "https://example.test/ai.pdf", type: "site" }],
    });

    assert.equal(loaded.documents.length, 1);
    assert.equal(loaded.documents[0].format, "pdf");
    assert.match(loaded.documents[0].text, /John McCarthy/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unreadable PDF is reported as a warning and not indexed", async () => {
  const root = await makeTempDir("rag-bad-pdf-root-");
  await writeFile(path.join(root, "bad.pdf"), Buffer.from("%PDF-1.7\nstream\n\u0000\u0001bad\nendstream"));

  const loaded = await loadDocuments({
    root,
    useSourceManager: false,
    sourceInputs: ["bad.pdf"],
  });

  assert.deepEqual(loaded.documents, []);
  assert.equal(loaded.sourceSummaries[0].documentCount, 0);
  assert.match(loaded.sourceSummaries[0].warning, /bad\.pdf/);
  assert.match(loaded.warnings[0], /bad\.pdf/);
});
