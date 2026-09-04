const { InMemoryStore } = require("../store/inMemoryStore");
const { AuditLogger } = require("../auditLogger");
const { PolicyEngine } = require("../policy/policyEngine");
const { RevenueRecoveryAgent } = require("../ai/agent");
const { RazorpayAdapter } = require("../payment/razorpayAdapter");
const { RecoveryExecutor } = require("../recoveryExecutor");
const { RecoveryPipeline } = require("../recoveryPipeline");
const { generateTransactions } = require("./syntheticData");
const { seededRandom } = require("../utils/id");

function summarize(rows) {
  const atRisk = rows.filter(
    (t) => t.paymentStatus === "failed"
  );

  const recovered = rows.filter(
    (t) =>
      t.paymentStatus === "success" &&
      t.recoveryStatus === "RECOVERED"
  );

  const riskRevenue = atRisk.reduce(
    (sum, t) => sum + Number(t.amountRupees || 0),
    0
  );

  const recoveredRevenue = recovered.reduce(
    (sum, t) => sum + Number(t.amountRupees || 0),
    0
  );

  return {
    transactions: rows.length,

    failed: atRisk.length,

    revenueAtRisk:
      Math.round(riskRevenue * 100) / 100,

    recovered: recovered.length,

    recoveredRevenue:
      Math.round(recoveredRevenue * 100) / 100,

    recoveryRate:
      atRisk.length
        ? recovered.length / atRisk.length
        : 0,

    revenueRecoveryRate:
      riskRevenue
        ? recoveredRevenue / riskRevenue
        : 0
  };
}

function runBaseline(transactions, seed) {
  const rand = seededRandom(
    Number(seed) + 9999
  );

  return transactions.map((t) => {
    if (t.paymentStatus !== "failed") {
      return { ...t };
    }

    const probability = {
      network_failure: 0.55,
      temporary_bank_failure: 0.45,
      gateway_timeout: 0.40,
      insufficient_funds: 0.20,
      card_expired: 0.05,
      bank_decline: 0.08,
      fraud_suspected: 0.02,
      unknown: 0.25
    }[t.failureReason] ?? 0.25;

    const recovered = rand() < probability;

    return {
      ...t,

      paymentStatus:
        recovered ? "success" : "failed",

      recoveryStatus:
        recovered ? "RECOVERED" : "FAILED"
    };
  });
}

async function runEvaluation({
  count = 1000,
  seed = 42
}) {
  const transactions = generateTransactions(
    count,
    seed
  );

  const store = new InMemoryStore();

  const auditLogger = new AuditLogger();

  const policyEngine = new PolicyEngine();

  // Deterministic rules for benchmark reproducibility
  const aiAgent = new RevenueRecoveryAgent({
    forceRules: true
  });

  const adapter = new RazorpayAdapter();

  const executor = new RecoveryExecutor({
    paymentAdapter: adapter
  });

  const pipeline = new RecoveryPipeline({
    store,
    executor,
    auditLogger,
    aiAgent,
    policyEngine
  });

  store.loadTransactions(transactions);

  for (const tx of transactions) {
    if (tx.paymentStatus !== "failed") {
      continue;
    }

    await pipeline.runForTransaction({
      transactionId: tx.transactionId,
      seed,
      eventId:
        `evaluation_${seed}_${tx.transactionId}`
    });
  }

  const recoverAI = summarize(
    store.getAllTransactions()
  );

  const baseline = summarize(
    runBaseline(transactions, seed)
  );

  return {
    seed,

    count,

    recoverAI,

    baseline,

    uplift: {
      recoveredRevenue:
        Math.round(
          (
            recoverAI.recoveredRevenue -
            baseline.recoveredRevenue
          ) * 100
        ) / 100,

      recoveryRate:
        recoverAI.recoveryRate -
        baseline.recoveryRate,

      revenueRecoveryRate:
        recoverAI.revenueRecoveryRate -
        baseline.revenueRecoveryRate
    },

    guardrails: {
      escalated:
        store
          .getAllTransactions()
          .filter(
            (t) =>
              t.recoveryStatus === "ESCALATED"
          ).length,

      scheduled:
        store
          .getAllTransactions()
          .filter(
            (t) =>
              t.recoveryStatus === "SCHEDULED"
          ).length,

      blocked:
        auditLogger
          .getAll()
          .filter(
            (e) =>
              e.eventType === "POLICY_BLOCKED"
          ).length
    }
  };
}

module.exports = {
  runEvaluation
};