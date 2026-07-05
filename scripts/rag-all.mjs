import { runDay21Indexing, runDay22Evaluation } from "../lib/rag/core.mjs";

const stage = process.argv[2] || "day21";

async function main() {
  if (!["day21", "day22", "all"].includes(stage)) {
    throw new Error(`Unsupported RAG stage: ${stage}`);
  }
  const day21 = await runDay21Indexing({});
  const output = {
    day21: {
      comparison: day21.comparison,
      reportPath: day21.reportPath,
      manifestPath: day21.manifestPath,
    },
  };
  if (stage === "day22" || stage === "all") {
    const day22 = await runDay22Evaluation({ generationMode: "local" });
    output.day22 = {
      questionCount: day22.evaluation.results.length,
      reportPath: day22.reportPath,
      evaluationPath: day22.evaluationPath,
    };
  }
  console.log(JSON.stringify({ stage, ...output }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
