class RecoveryPipeline{
  constructor({store,executor,auditLogger,aiAgent,policyEngine}){this.store=store;this.executor=executor;this.auditLogger=auditLogger;this.aiAgent=aiAgent;this.policyEngine=policyEngine;this.processedKeys=new Set();}
  _buildAiInput(t){
    const history=this.store.getCustomerHistory(t.customerId,t.transactionId);
    const attempts=Array.isArray(t.recoveryAttempts)?t.recoveryAttempts:[];
    return {transaction:{transactionId:t.transactionId,amountRupees:t.amountRupees,currency:t.currency||"INR",paymentStatus:t.paymentStatus,failureReason:t.failureReason,customerOptedOut:Boolean(t.customerOptedOut)},customerHistory:{previousTransactions:history.length,previousFailures:history.filter(x=>x.paymentStatus==="failed").length,previousRecoveries:history.filter(x=>x.paymentStatus==="success").length},paymentHistory:history.map(x=>({transactionId:x.transactionId,amountRupees:x.amountRupees,paymentStatus:x.paymentStatus,failureReason:x.failureReason})),recoveryAttempts:attempts.length};
  }
  detectRisk(t){return ["failed","at_risk"].includes(t.paymentStatus);}
  async runForTransaction({transactionId,seed,eventId=`recovery_${transactionId}`}){
    const key=`${eventId}:${transactionId}`;
    if(this.processedKeys.has(key))return {success:false,idempotent:true,reason:"This recovery event was already processed"};
    const transaction=this.store.getTransaction(transactionId);
    if(!transaction)throw new Error(`Transaction not found: ${transactionId}`);
    if(!this.detectRisk(transaction))return {success:false,skipped:true,reason:"Transaction is not at risk"};
    this.processedKeys.add(key);

    this.auditLogger.append({eventType:"PAYMENT_FAILED",metadata:{transactionId,failureReason:transaction.failureReason}});
    this.auditLogger.append({eventType:"RISK_DETECTED",metadata:{transactionId,amountRupees:transaction.amountRupees}});

    const diagnosis=await this.aiAgent.diagnose(this._buildAiInput(transaction));
    this.store.saveDiagnosis(transactionId,diagnosis);
    this.auditLogger.append({eventType:"AI_DIAGNOSIS",action:diagnosis.recommendedAction,result:diagnosis.source,metadata:{transactionId,confidence:diagnosis.confidence,diagnosis:diagnosis.diagnosis}});
    this.auditLogger.append({eventType:"AI_RECOMMENDATION",action:diagnosis.recommendedAction,metadata:{transactionId,confidence:diagnosis.confidence}});

    const policyDecision=this.policyEngine.evaluate({transaction,diagnosis});
    this.store.savePolicyDecision(transactionId,policyDecision);
    this.auditLogger.append({eventType:policyDecision.decision==="BLOCKED"?"POLICY_BLOCKED":policyDecision.decision==="ESCALATED"?"POLICY_ESCALATED":"POLICY_APPROVED",action:diagnosis.recommendedAction,result:policyDecision.decision,policyVersion:policyDecision.policyVersion,metadata:{transactionId,ruleId:policyDecision.ruleId,reason:policyDecision.reason}});

    if(!policyDecision.approved)return {success:false,status:"BLOCKED",transaction,diagnosis,policyDecision};

    const effectiveAction=policyDecision.overrideAction||diagnosis.recommendedAction;

    if(effectiveAction==="NO_ACTION"){
      this.store.recordRecoveryAttempt(transactionId,{action:effectiveAction,status:"NO_ACTION",result:"No action taken"});
      return {success:true,status:"NO_ACTION",transaction,diagnosis,policyDecision};
    }

    if(effectiveAction==="ESCALATE_TO_HUMAN"){
      this.store.recordRecoveryAttempt(transactionId,{action:effectiveAction,status:"ESCALATED",result:policyDecision.reason});
      this.auditLogger.append({eventType:"ESCALATED",action:effectiveAction,result:"ESCALATED",metadata:{transactionId,reason:policyDecision.reason}});
      return {success:true,status:"ESCALATED",transaction,diagnosis,policyDecision};
    }

    const existing=Array.isArray(transaction.recoveryAttempts)?transaction.recoveryAttempts:[];
    const attemptNumber=existing.filter(a=>a.action===effectiveAction).length+1;
    this.auditLogger.append({eventType:"RECOVERY_ATTEMPTED",action:effectiveAction,metadata:{transactionId,attemptNumber}});

    const execution=await this.executor.execute({transaction,action:effectiveAction,attemptNumber,seed,recommendedDelayMinutes:diagnosis.recommendedDelayMinutes});
    this.store.recordRecoveryAttempt(transactionId,{action:effectiveAction,status:execution.status,result:execution});

    if(execution.status==="RECOVERED"){
      this.store.markRecovered(transactionId);
      this.auditLogger.append({eventType:"PAYMENT_RECOVERED",action:effectiveAction,result:"RECOVERED",metadata:{transactionId,amountRupees:transaction.amountRupees}});
    }else if(execution.status==="ESCALATED"){
      this.auditLogger.append({eventType:"ESCALATED",action:effectiveAction,result:"ESCALATED",metadata:{transactionId}});
    }else{
      this.auditLogger.append({eventType:"RECOVERY_FAILED",action:effectiveAction,result:execution.status,metadata:{transactionId}});
    }

    return {success:execution.status==="RECOVERED",status:execution.status,transaction:this.store.getTransaction(transactionId),diagnosis,policyDecision,execution};
  }
}
module.exports={RecoveryPipeline};
