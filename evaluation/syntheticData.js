const { seededRandom } = require("../utils/id");

const FAILURE_REASONS = [
  "network_failure",
  "temporary_bank_failure",
  "insufficient_funds",
  "card_expired",
  "bank_decline",
  "fraud_suspected",
  "gateway_timeout",
  "unknown"
];

function pick(rand, list) {
  return list[Math.floor(rand() * list.length)];
}

function generateTransactions(count = 1000, seed = 42) {
  const rand = seededRandom(seed);
  const transactions = [];

  for (let i = 0; i < count; i++) {
    const amountRupees = Math.round((300 + rand() * 99700) * 100) / 100;
    const failed = rand() < 0.42;
    const reason = failed ? pick(rand, FAILURE_REASONS) : null;

    transactions.push({
      transactionId: `txn_${seed}_${String(i + 1).padStart(5, "0")}`,
      customerId: `cust_${1 + Math.floor(rand() * Math.max(50, count / 5))}`,
      customerName: `Customer ${i + 1}`,
      customerEmail: `customer${i + 1}@example.com`,
      customerPhone: `+9190000${String(i).padStart(5, "0")}`,
      amountRupees,
      currency: "INR",
      paymentStatus: failed ? "failed" : "success",
      failureReason: reason,
      customerOptedOut: rand() < 0.03,
      recoveryStatus: failed ? "AT_RISK" : "NONE",
      createdAt: new Date(Date.UTC(2026, 7, 1, 10, 0, i % 60)).toISOString(),
      recoveryAttempts: []
    });
  }

  return transactions;
}

module.exports = { generateTransactions };
