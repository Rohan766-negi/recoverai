class InMemoryStore{
  constructor(){this.transactions=new Map();this.recoveryAttempts=new Map();this.diagnoses=new Map();this.policyDecisions=new Map();this.auditEvents=[];this.settings={};}
  upsertTransaction(t){if(!t?.transactionId)throw new Error("transactionId is required");const old=this.transactions.get(t.transactionId)||{};const merged={...old,...t,recoveryAttempts:t.recoveryAttempts??old.recoveryAttempts??[]};this.transactions.set(t.transactionId,merged);return merged;}
  getTransaction(id){return this.transactions.get(id)||null;}
  getAllTransactions(){return [...this.transactions.values()];}
  getTransactions(filter={}){return this.getAllTransactions().filter(t=>Object.entries(filter).every(([k,v])=>t[k]===v));}
  getCustomerHistory(customerId,currentTransactionId=null){return this.getAllTransactions().filter(t=>t.customerId===customerId&&t.transactionId!==currentTransactionId);}
  getPaymentHistory(customerId,currentTransactionId=null){return this.getCustomerHistory(customerId,currentTransactionId);}
  saveDiagnosis(id,d){this.diagnoses.set(id,d);const t=this.getTransaction(id);if(t){t.riskLevel=d.riskLevel;t.revenueAtRisk=d.revenueAtRisk;t.recommendedAction=d.recommendedAction;t.aiConfidence=d.confidence;}}
  getDiagnosis(id){return this.diagnoses.get(id)||null;}
  savePolicyDecision(id,d){this.policyDecisions.set(id,d);}
  getPolicyDecision(id){return this.policyDecisions.get(id)||null;}
  recordRecoveryAttempt(id,a){const t=this.getTransaction(id);if(!t)throw new Error("Transaction not found");const attempts=Array.isArray(t.recoveryAttempts)?t.recoveryAttempts:[];const next={...a,attemptId:a.attemptId||`attempt_${Date.now()}_${attempts.length+1}`,timestamp:a.timestamp||new Date().toISOString()};attempts.push(next);t.recoveryAttempts=attempts;if(next.status==="RECOVERED"){t.recoveryStatus="RECOVERED";t.paymentStatus="success";}else if(next.status==="ESCALATED"){t.recoveryStatus="ESCALATED";}else if(next.status==="SCHEDULED"){t.recoveryStatus="SCHEDULED";}else{t.recoveryStatus="IN_PROGRESS";}return next;}
  appendAuditEvent(e){this.auditEvents.push(e);return e;}
  getAllAuditEvents(){return [...this.auditEvents].sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));}
  markRecovered(id){const t=this.getTransaction(id);if(!t)throw new Error("Transaction not found");t.paymentStatus="success";t.recoveryStatus="RECOVERED";return t;}
  updateSettings(p){this.settings={...this.settings,...p};return this.settings;}
  getSettings(){return {...this.settings};}
  loadTransactions(ts=[]){for(const t of ts)this.upsertTransaction(t);}
  clear(){this.transactions.clear();this.recoveryAttempts.clear();this.diagnoses.clear();this.policyDecisions.clear();this.auditEvents=[];}
}
module.exports={InMemoryStore};
