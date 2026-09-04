const express = require("express");
const cors = require("cors");

const {
  store,
  auditLogger,
  pipeline,
  seedIfEmpty
} = require("./appContext");

const { runEvaluation } = require("./evaluation/evaluator");

const app = express();
const PORT = Number(process.env.PORT || 5000);

app.use(cors());
app.use(express.json());

/* -------------------------------------------------------
   HEALTH CHECK
------------------------------------------------------- */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "RecoverAI",
    status: "running",
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

/* -------------------------------------------------------
   TRANSACTIONS
------------------------------------------------------- */

app.get("/api/transactions", (req, res) => {
  try {
    seedIfEmpty();

    const transactions = store.getAllTransactions();

    res.json(transactions);
  } catch (error) {
    console.error("GET /api/transactions error:", error);

    res.status(500).json({
      error: error.message
    });
  }
});

/* -------------------------------------------------------
   TRANSACTION DETAIL
------------------------------------------------------- */

app.get("/api/transactions/:id", (req, res) => {
  try {
    const transaction = store.getTransaction(req.params.id);

    if (!transaction) {
      return res.status(404).json({
        error: "Transaction not found"
      });
    }

    res.json(transaction);
  } catch (error) {
    console.error("GET transaction error:", error);

    res.status(500).json({
      error: error.message
    });
  }
});

/* -------------------------------------------------------
   RECOVERY EXECUTION
------------------------------------------------------- */

app.post("/api/recovery/execute", async (req, res) => {
  try {
    const {
      transactionId,
      seed = 424242
    } = req.body || {};

    if (!transactionId) {
      return res.status(400).json({
        error: "transactionId is required"
      });
    }

    const idempotencyKey =
      req.headers["idempotency-key"] ||
      req.body?.idempotencyKey ||
      `recovery_${transactionId}`;

    const result = await pipeline.runForTransaction({
      transactionId,
      seed,
      eventId: idempotencyKey
    });

    res.json(result);
  } catch (error) {
    console.error("Recovery execution error:", error);

    res.status(500).json({
      error: error.message
    });
  }
});

/* -------------------------------------------------------
   RUN AI EVALUATION BENCHMARK
------------------------------------------------------- */

app.post("/api/evaluate/run", async (req, res) => {
  try {
    const batchSize = Number(req.body?.batchSize || 100);
    const seed = Number(req.body?.seed || 42);

    if (!Number.isFinite(batchSize) || batchSize < 1) {
      return res.status(400).json({
        error: "batchSize must be a positive number"
      });
    }

    const report = await runEvaluation({
      count: Math.min(Math.floor(batchSize), 5000),
      seed
    });

    res.json(report);
  } catch (error) {
    console.error("Evaluation error:", error);

    res.status(500).json({
      error: error.message
    });
  }
});

/* -------------------------------------------------------
   AUDIT LOGS
------------------------------------------------------- */

app.get("/api/audit-logs", (req, res) => {
  try {
    res.json(auditLogger.getAll());
  } catch (error) {
    console.error("Audit log error:", error);

    res.status(500).json({
      error: error.message
    });
  }
});

/* -------------------------------------------------------
   AUDIT LOGS FOR TRANSACTION
------------------------------------------------------- */

app.get("/api/transactions/:id/audit", (req, res) => {
  try {
    const events = auditLogger.getByTransaction(req.params.id);

    res.json(events);
  } catch (error) {
    console.error("Transaction audit error:", error);

    res.status(500).json({
      error: error.message
    });
  }
});

/* -------------------------------------------------------
   DASHBOARD SUMMARY
------------------------------------------------------- */

app.get("/api/dashboard/summary", (req, res) => {
  try {
    seedIfEmpty();

    const transactions = store.getAllTransactions();

    const failed = transactions.filter(
      (t) => t.paymentStatus === "failed"
    );

    const recovered = transactions.filter(
      (t) =>
        t.paymentStatus === "success" &&
        t.recoveryStatus === "RECOVERED"
    );

    const escalated = transactions.filter(
      (t) => t.recoveryStatus === "ESCALATED"
    );

    const revenueAtRisk = failed.reduce(
      (sum, t) => sum + Number(t.amountRupees || 0),
      0
    );

    const recoveredRevenue = recovered.reduce(
      (sum, t) => sum + Number(t.amountRupees || 0),
      0
    );

    const recoveryRate =
      failed.length > 0
        ? recovered.length / failed.length
        : 0;

    const aiConfidences = transactions
      .map((t) => Number(t.aiConfidence))
      .filter((x) => Number.isFinite(x));

    const aiConfidence =
      aiConfidences.length > 0
        ? aiConfidences.reduce((a, b) => a + b, 0) /
          aiConfidences.length
        : 0;

    const policyBlocks = auditLogger
      .getAll()
      .filter(
        (event) => event.eventType === "POLICY_BLOCKED"
      ).length;

    res.json({
      transactions: transactions.length,
      failed: failed.length,
      recovered: recovered.length,
      escalated: escalated.length,
      revenueAtRisk: Math.round(revenueAtRisk * 100) / 100,
      recoveredRevenue: Math.round(recoveredRevenue * 100) / 100,
      recoveryRate,
      aiConfidence,
      policyBlocks
    });
  } catch (error) {
    console.error("Dashboard summary error:", error);

    res.status(500).json({
      error: error.message
    });
  }
});

/* -------------------------------------------------------
   START SERVER
------------------------------------------------------- */

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(
      `RecoverAI Backend server running on port ${PORT}`
    );
  });
}

module.exports = app;