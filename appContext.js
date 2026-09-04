const { InMemoryStore } = require("./store/inMemoryStore");
const { AuditLogger } = require("./auditLogger");
const { PolicyEngine } = require("./policy/policyEngine");
const { RevenueRecoveryAgent } = require("./ai/agent");
const { RazorpayAdapter } = require("./payment/razorpayAdapter");
const { RecoveryExecutor } = require("./recoveryExecutor");
const { RecoveryPipeline } = require("./recoveryPipeline");
const { generateTransactions } = require("./evaluation/syntheticData");

// Shared runtime for the live demo
const store = new InMemoryStore();

const auditLogger = new AuditLogger();

const policyEngine = new PolicyEngine();

const aiAgent = new RevenueRecoveryAgent();

const paymentAdapter = new RazorpayAdapter();

const executor = new RecoveryExecutor({
  paymentAdapter
});

const pipeline = new RecoveryPipeline({
  store,
  executor,
  auditLogger,
  aiAgent,
  policyEngine
});

const LIVE_DEMO_SEED = 424242;

/*
  Seed a small deterministic dataset for the live dashboard.
*/
function seedIfEmpty() {
  if (store.getAllTransactions().length > 0) {
    return;
  }

  const pool = generateTransactions(
    80,
    LIVE_DEMO_SEED
  );

  const atRisk = pool
    .filter(
      (transaction) =>
        transaction.paymentStatus === "failed"
    )
    .slice(0, 10);

  store.loadTransactions(atRisk);
}

module.exports = {
  store,
  auditLogger,
  policyEngine,
  aiAgent,
  paymentAdapter,
  executor,
  pipeline,
  seedIfEmpty,
  LIVE_DEMO_SEED
};