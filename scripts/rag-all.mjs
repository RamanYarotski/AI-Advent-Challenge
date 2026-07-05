import { runDay21Indexing } from "../lib/rag/core.mjs";

const stage = process.argv[2] || "day21";

async function main() {
  if (stage !== "day21" && stage !== "all") {
    throw new Error(`Unsupported RAG stage: ${stage}`);
  }
  const day21 = await runDay21Indexing({});
  console.log(
    JSON.stringify(
      {
        stage: "day21",
        comparison: day21.comparison,
        reportPath: day21.reportPath,
        manifestPath: day21.manifestPath,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

