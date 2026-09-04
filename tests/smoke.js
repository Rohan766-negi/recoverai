const { generateTransactions } = require("../evaluation/syntheticData");
const { runEvaluation } = require("../evaluation/evaluator");

(async () => {
  const a = generateTransactions(100, 42);
  const b = generateTransactions(100, 42);
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error("Synthetic data is not deterministic");

  const x = await runEvaluation({count:100,seed:42});
  const y = await runEvaluation({count:100,seed:42});
  if (x.recoverAI.recoveredRevenue !== y.recoverAI.recoveredRevenue) throw new Error("Evaluation is not deterministic");

  console.log("Smoke tests passed.");
  console.log(JSON.stringify(x, null, 2));
})();
