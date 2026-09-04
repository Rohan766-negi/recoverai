const ALLOWED_ACTIONS = ["RETRY_PAYMENT","SEND_PAYMENT_LINK","SEND_REMINDER","WAIT_AND_RETRY","ESCALATE_TO_HUMAN","NO_ACTION"];
const POLICY_VERSION = "v1.0";
const DEFAULT_POLICY_CONFIG = {
  maxRetries: 2,
  maxRecoveryAttempts: 2,
  minRetryIntervalMinutes: 30,
  aiConfidenceThreshold: 0.55,
  highValueThresholdRupees: 50000,
  duplicateMessageWindowMinutes: 60
};

class PolicyEngine {
  constructor(config = {}) { this.config = { ...DEFAULT_POLICY_CONFIG, ...config }; }

  evaluate({ transaction, diagnosis, now = new Date() }) {
    const attempts = Array.isArray(transaction?.recoveryAttempts) ? transaction.recoveryAttempts : [];
    const action = diagnosis?.recommendedAction;
    const confidence = Number(diagnosis?.confidence ?? 0);

    if (!transaction) return this.block("INVALID_TRANSACTION", "Transaction not found");
    if (transaction.paymentStatus === "success") return this.block("ALREADY_SUCCESS", "Payment is already successful");
    if (transaction.paymentStatus === "refunded") return this.block("REFUNDED", "Refunded transactions cannot be recovered");
    if (!ALLOWED_ACTIONS.includes(action)) return this.block("ACTION_NOT_ALLOWED", "AI recommended an unsupported action");

    if (transaction.customerOptedOut && ["SEND_PAYMENT_LINK","SEND_REMINDER"].includes(action))
      return this.block("CUSTOMER_OPTED_OUT", "Customer opted out of communication");

    const retryAttempts = attempts.filter(a => ["RETRY_PAYMENT","WAIT_AND_RETRY"].includes(a.action)).length;
    if (["RETRY_PAYMENT","WAIT_AND_RETRY"].includes(action) && retryAttempts >= this.config.maxRetries)
      return this.escalate("MAX_RETRIES", "Maximum payment retries reached");

    if (attempts.length >= this.config.maxRecoveryAttempts)
      return this.escalate("MAX_RECOVERY_ATTEMPTS", "Maximum recovery attempts reached");

    const lastAttempt = attempts[attempts.length - 1];
    if (lastAttempt?.timestamp) {
      const elapsed = (new Date(now) - new Date(lastAttempt.timestamp)) / 60000;
      if (elapsed >= 0 && elapsed < this.config.minRetryIntervalMinutes && action === lastAttempt.action)
        return this.block("DUPLICATE_ACTION_WINDOW", "Same action was attempted too recently");
    }

    if (["SEND_PAYMENT_LINK","SEND_REMINDER"].includes(action) && lastAttempt?.action === action && lastAttempt?.timestamp) {
      const elapsed = (new Date(now) - new Date(lastAttempt.timestamp)) / 60000;
      if (elapsed >= 0 && elapsed < this.config.duplicateMessageWindowMinutes)
        return this.block("DUPLICATE_MESSAGE", "Duplicate customer communication blocked");
    }

    if (confidence < this.config.aiConfidenceThreshold)
      return this.escalate("LOW_AI_CONFIDENCE", `AI confidence ${confidence.toFixed(2)} is below threshold`);

    if (Number(transaction.amountRupees || 0) >= this.config.highValueThresholdRupees)
      return this.escalate("HIGH_VALUE_TRANSACTION", "High-value transaction requires human review");

    if (action === "NO_ACTION")
      return { approved:true, decision:"NO_ACTION", reason:"No recovery action is appropriate", policyVersion:POLICY_VERSION, ruleId:"NO_ACTION" };

    if (action === "ESCALATE_TO_HUMAN")
      return this.escalate("AI_ESCALATION", "AI recommended human escalation");

    return { approved:true, decision:"APPROVED", reason:"Action passed deterministic recovery policy", policyVersion:POLICY_VERSION, ruleId:"DEFAULT_ALLOW" };
  }

  block(ruleId, reason) { return { approved:false, decision:"BLOCKED", reason, policyVersion:POLICY_VERSION, ruleId }; }
  escalate(ruleId, reason) { return { approved:true, decision:"ESCALATED", overrideAction:"ESCALATE_TO_HUMAN", reason, policyVersion:POLICY_VERSION, ruleId }; }
}
module.exports = { PolicyEngine, POLICY_VERSION, ALLOWED_ACTIONS, DEFAULT_POLICY_CONFIG };
