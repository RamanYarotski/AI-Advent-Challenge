import { expect, test } from "@playwright/test";
import path from "node:path";

type TestSource = {
  id: string;
  type: string;
  label: string;
  value: string;
};

function sourceState(sources: TestSource[]) {
  return {
    version: 1,
    sources: sources.map((source) => ({
      ...source,
      enabled: true,
      status: "ready",
      warning: null,
      error: null,
      documentCount: 0,
      lastIndexedAt: null,
      metadata: {},
      createdAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T00:00:00.000Z",
    })),
    updatedAt: "2026-07-06T00:00:00.000Z",
  };
}

test("Source Manager supports adding, uploading, and removing sources", async ({ page }) => {
  let sources: TestSource[] = [];
  let manifest: null | Record<string, unknown> = null;

  await page.route("**/api/rag/status**", async (route) => {
    await route.fulfill({ json: { manifest } });
  });

  await page.route(/\/api\/rag\/index\/?(?:\?.*)?$/, async (route) => {
    const comparison = {
      documentCount: 2,
      fixedChunks: 3,
      structuralChunks: 2,
      fixedAverageTokens: 100,
      structuralAverageTokens: 120,
      recommendation: "Structural chunks keep sections readable.",
    };
    manifest = {
      day21: {
        comparison,
        embeddingProvider: "local_hash",
        sourceSummaries: [
          { input: "https://docs.example.test/", type: "site", documentCount: 2 },
        ],
        warnings: [],
        updatedAt: "2026-07-06T00:00:00.000Z",
      },
    };
    await route.fulfill({
      json: {
        comparison,
        fixed: { elapsedMs: 1 },
        structural: { elapsedMs: 1 },
        reportPath: ".data/rag-week/reports/day-21-indexing.md",
      },
    });
  });

  await page.route(/\/api\/rag\/artifacts(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const key = url.searchParams.get("key") || "day21_report";
    await route.fulfill({
      json: {
        key,
        label: key === "day21_report" ? "Report" : key,
        fileName: `${key}.txt`,
        contentType: key.endsWith("index") || key === "manifest" ? "application/json" : "text/markdown",
        path: `.data/rag-week/${key}`,
        content: key === "day21_report" ? "# Day 21\nIndexed fixture report" : "{\"ok\":true}",
      },
    });
  });

  await page.route(/\/api\/rag\/reset\/?(?:\?.*)?$/, async (route) => {
    manifest = null;
    sources = [];
    await route.fulfill({ json: { state: sourceState(sources), resetAt: "2026-07-06T00:00:00.000Z" } });
  });

  await page.route(/\/api\/rag\/sources\/upload\/?(?:\?.*)?$/, async (route) => {
    sources = [
      ...sources,
      {
        id: "source-upload-policy",
        type: "upload",
        label: "upload-policy.md",
        value: ".data/rag-week/uploads/test/upload-policy.md",
      },
    ];
    await route.fulfill({
      status: 201,
      json: {
        batchId: "test",
        uploaded: [],
        rejected: [],
        state: sourceState(sources),
      },
    });
  });

  await page.route(/\/api\/rag\/sources\/?(?:\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({ json: sourceState(sources) });
      return;
    }
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      sources = [
        ...sources,
        {
          id: "source-added-site",
          type: body.type,
          label: body.label || body.value,
          value: body.value,
        },
      ];
      await route.fulfill({ status: 201, json: { state: sourceState(sources), duplicate: false } });
      return;
    }
    if (request.method() === "DELETE") {
      const body = request.postDataJSON();
      sources = sources.filter((source) => source.id !== body.id);
      await route.fulfill({ json: { state: sourceState(sources), deleted: true } });
      return;
    }
    await route.fulfill({ status: 405, json: { error: "Unexpected method" } });
  });

  await page.goto("/rag");

  await expect(page.getByText("Add source")).toBeVisible();
  await expect(page.getByText("Sources to index", { exact: true })).toBeVisible();
  await expect(page.getByText("Advanced multiline sources")).not.toBeVisible();
  await expect(page.locator(".rag-source-row", { hasText: "README.md" })).not.toBeVisible();
  await expect(page.locator(".rag-source-row", { hasText: "docs" })).not.toBeVisible();
  await expect(page.getByText("No sources to index yet. Upload files or add a URL, site, GitHub source, or local path.")).toBeVisible();
  await expect(page.locator(".rag-upload span")).toHaveText("Upload files");
  await expect(page.getByRole("textbox", { name: "Source URL", exact: true })).not.toBeVisible();

  await page.getByLabel("Type").selectOption("url");
  await expect(page.getByRole("textbox", { name: "Source URL", exact: true })).toBeVisible();
  await expect(page.getByText("Site max depth")).not.toBeVisible();

  await page.getByLabel("Type").selectOption("site");
  await expect(page.getByText("Site max depth")).toBeVisible();
  await expect(page.getByText("Site max pages")).toBeVisible();
  await expect(page.getByText("GitHub max files")).not.toBeVisible();
  await page.getByRole("textbox", { name: "Site URL", exact: true }).fill("https://docs.example.test/");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.locator(".rag-source-row", { hasText: "https://docs.example.test/" })).toBeVisible();
  await expect(page.locator(".rag-source-row", { hasText: "https://docs.example.test/" }).getByRole("button", { name: "Disable" })).toBeVisible();
  await expect(page.locator(".rag-source-row", { hasText: "https://docs.example.test/" }).getByRole("button", { name: "Remove" })).toBeVisible();

  await page.getByLabel("Type").selectOption("github");
  await expect(page.getByRole("textbox", { name: "GitHub URL", exact: true })).toBeVisible();
  await expect(page.getByText("GitHub max files")).toBeVisible();
  await expect(page.getByText("Site max depth")).not.toBeVisible();

  await page.getByLabel("Type").selectOption("local_path");
  await expect(page.getByRole("textbox", { name: "Server path", exact: true })).toBeVisible();
  await expect(page.getByText("Server paths are read by the running app process")).toBeVisible();

  await page.getByLabel("Type").selectOption("upload");
  const fixture = path.join(process.cwd(), "tests", "fixtures", "upload-policy.md");
  await page.locator(".rag-upload input[type='file']").setInputFiles(fixture);
  await expect(page.locator(".rag-source-row", { hasText: "upload-policy.md" })).toBeVisible();

  await page.locator(".rag-source-row", { hasText: "upload-policy.md" }).getByRole("button", { name: "Remove" }).click();
  await expect(page.locator(".rag-source-row", { hasText: "upload-policy.md" })).not.toBeVisible();

  await page.getByRole("button", { name: "Build indexes" }).click();
  await expect(page.getByText("Indexed sections")).toBeVisible();
  await expect(page.locator(".rag-indexed-section", { hasText: "https://docs.example.test/" })).toBeVisible();
  await expect(page.locator(".rag-indexed-section").getByRole("button", { name: "Remove" })).not.toBeVisible();
  await expect(page.getByText("Index artifacts")).toBeVisible();
  await page.getByText("Index artifacts").click();
  await page.locator(".rag-artifact-row", { hasText: "Report" }).getByRole("button", { name: "View" }).click();
  await expect(page.getByText("Indexed fixture report")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset RAG data" }).click();
  await expect(page.getByText("No index has been built yet.")).toBeVisible();
  await expect(page.getByText("No sources to index yet. Upload files or add a URL, site, GitHub source, or local path.")).toBeVisible();
  await expect(page.getByText("Indexed sections")).not.toBeVisible();
  await expect(page.locator(".rag-source-row", { hasText: "README.md" })).not.toBeVisible();
});
