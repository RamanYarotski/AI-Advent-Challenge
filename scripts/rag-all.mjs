import {
  runDay21Indexing,
  runDay22Evaluation,
  runDay23Evaluation,
  runDay24Evaluation,
  runDay25Evaluation,
} from "../lib/rag/core.mjs";

const stage = process.argv[2] || "day21";

async function main() {
  if (!["day21", "day22", "day23", "day24", "day25", "all"].includes(stage)) {
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
  if (stage === "day23" || stage === "all") {
    const day23 = await runDay23Evaluation({ generationMode: "local" });
    output.day23 = {
      questionCount: day23.evaluation.results.length,
      reportPath: day23.reportPath,
      evaluationPath: day23.evaluationPath,
      initialTopK: day23.evaluation.initialTopK,
      finalTopK: day23.evaluation.finalTopK,
      threshold: day23.evaluation.threshold,
    };
  }
  if (stage === "day24" || stage === "all") {
    const day24 = await runDay24Evaluation({});
    output.day24 = {
      questionCount: day24.evaluation.results.length,
      negativeStatus: day24.evaluation.negative.status,
      reportPath: day24.reportPath,
      evaluationPath: day24.evaluationPath,
    };
  }
  if (stage === "day25" || stage === "all") {
    const day25 = await runDay25Evaluation({});
    output.day25 = {
      scenarioCount: day25.evaluation.scenarios.length,
      reportPath: day25.reportPath,
      evaluationPath: day25.evaluationPath,
    };
  }
  console.log(JSON.stringify({ stage, ...output }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
