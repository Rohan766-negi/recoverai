const { seededRandom } = require("../utils/id");

const BASE_PROBABILITIES = {
  network_failure:.78, temporary_bank_failure:.72, insufficient_funds:.28,
  card_expired:.05, bank_decline:.08, fraud_suspected:.02,
  gateway_timeout:.65, unknown:.35
};

class PaymentSimulator {
  constructor({ clock = () => new Date() } = {}) { this.clock = clock; }

  attemptRecovery(transaction, { attemptNumber = 1, seed } = {}) {
    const reason = transaction.failureReason || "unknown";
    const base = BASE_PROBABILITIES[reason] ?? BASE_PROBABILITIES.unknown;
    const probabilityUsed = Math.max(0, Math.min(1, base * Math.pow(.6, Math.max(0, attemptNumber - 1))));
    const random = seededRandom(seed != null ? Number(seed) + attemptNumber : this.hashToInt(transaction.transactionId) + attemptNumber);
    const roll = random();
    const success = roll < probabilityUsed;
    return {
      success,
      outcome: success ? "RECOVERED" : this.classifyFailure(reason, roll),
      probabilityUsed,
      roll,
      simulatedAt: this.clock().toISOString(),
      source:"simulator"
    };
  }

  classifyFailure(reason, roll) {
    if (["fraud_suspected","card_expired"].includes(reason)) return "PERMANENT_FAILURE";
    if (roll > .85) return "PERMANENT_FAILURE";
    if (reason === "insufficient_funds") return "INSUFFICIENT_FUNDS";
    return "TEMPORARY_FAILURE";
  }

  hashToInt(value="") {
    let hash=0;
    for (let i=0;i<value.length;i++) hash=(hash*31+value.charCodeAt(i))|0;
    return Math.abs(hash);
  }
}
module.exports = { PaymentSimulator, BASE_PROBABILITIES };
