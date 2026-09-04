const ALLOWED_ACTIONS=["RETRY_PAYMENT","SEND_PAYMENT_LINK","SEND_REMINDER","WAIT_AND_RETRY","ESCALATE_TO_HUMAN","NO_ACTION"];
const SYSTEM_PROMPT=`You are RecoverAI, an AI revenue recovery decision-support agent.
Return ONLY valid JSON with riskLevel, revenueAtRisk, diagnosis, confidence, recommendedAction, recommendedDelayMinutes, messageType, reasoningSummary, expectedOutcome.
Allowed riskLevel: LOW, MEDIUM, HIGH.
Allowed actions: RETRY_PAYMENT, SEND_PAYMENT_LINK, SEND_REMINDER, WAIT_AND_RETRY, ESCALATE_TO_HUMAN, NO_ACTION.
Never invent customer data. Never guarantee recovery. Permanent failures should not be blindly retried. The AI recommends; deterministic policy decides execution.`;

function validateShape(r){
  if(!r || typeof r!=="object") return false;
  if(!["LOW","MEDIUM","HIGH"].includes(r.riskLevel)) return false;
  if(!Number.isFinite(Number(r.revenueAtRisk)) || Number(r.revenueAtRisk)<0) return false;
  if(typeof r.diagnosis!=="string" || !r.diagnosis.trim()) return false;
  if(!Number.isFinite(Number(r.confidence)) || Number(r.confidence)<0 || Number(r.confidence)>1) return false;
  if(!ALLOWED_ACTIONS.includes(r.recommendedAction)) return false;
  if(!Number.isInteger(Number(r.recommendedDelayMinutes)) || Number(r.recommendedDelayMinutes)<0) return false;
  return typeof r.messageType==="string" && typeof r.reasoningSummary==="string" && typeof r.expectedOutcome==="string";
}

function ruleBasedDiagnosis({transaction:tx,recoveryAttempts=0}){
  const attempts=Number(recoveryAttempts), amount=Number(tx.amountRupees||0), reason=tx.failureReason||"unknown";
  if(tx.customerOptedOut) return {riskLevel:"LOW",revenueAtRisk:amount,diagnosis:"Customer opted out of recovery communication",confidence:.95,recommendedAction:"NO_ACTION",recommendedDelayMinutes:0,messageType:"NONE",reasoningSummary:"Communication should not be initiated.",expectedOutcome:"No recovery action"};
  if(attempts>=2) return {riskLevel:"HIGH",revenueAtRisk:amount,diagnosis:"Multiple recovery attempts have failed",confidence:.8,recommendedAction:"ESCALATE_TO_HUMAN",recommendedDelayMinutes:0,messageType:"NONE",reasoningSummary:"Further automated retries are not justified.",expectedOutcome:"Human review"};
  if(["fraud_suspected","card_expired","bank_decline"].includes(reason)) return {riskLevel:"HIGH",revenueAtRisk:amount,diagnosis:`Failure reason ${reason} is unlikely to be fixed by immediate retry`,confidence:.62,recommendedAction:attempts===0?"SEND_PAYMENT_LINK":"ESCALATE_TO_HUMAN",recommendedDelayMinutes:0,messageType:attempts===0?"PAYMENT_LINK":"NONE",reasoningSummary:"Use an alternate payment attempt rather than repeated retry.",expectedOutcome:"Customer completes payment through an alternate route"};
  if(reason==="insufficient_funds") return {riskLevel:"MEDIUM",revenueAtRisk:amount,diagnosis:"Insufficient funds may require customer action before retry",confidence:.55,recommendedAction:"SEND_REMINDER",recommendedDelayMinutes:1440,messageType:"REMINDER",reasoningSummary:"Give the customer time to resolve the funding issue.",expectedOutcome:"Customer retries after resolving funds issue"};
  if(["network_failure","temporary_bank_failure","gateway_timeout"].includes(reason)) return {riskLevel:amount>=50000?"HIGH":"MEDIUM",revenueAtRisk:amount,diagnosis:`Failure ${reason} appears temporary`,confidence:attempts===0?.91:.68,recommendedAction:attempts===0?"RETRY_PAYMENT":"WAIT_AND_RETRY",recommendedDelayMinutes:attempts===0?30:60,messageType:"PAYMENT_RETRY",reasoningSummary:"A bounded retry is appropriate for a temporary failure.",expectedOutcome:"Payment may succeed on a subsequent attempt"};
  return {riskLevel:"MEDIUM",revenueAtRisk:amount,diagnosis:"Failure reason is uncertain",confidence:.45,recommendedAction:"ESCALATE_TO_HUMAN",recommendedDelayMinutes:0,messageType:"NONE",reasoningSummary:"Insufficient evidence for safe automated recovery.",expectedOutcome:"Human review"};
}

class RevenueRecoveryAgent{
  constructor({apiKey=process.env.ANTHROPIC_API_KEY,model=process.env.ANTHROPIC_MODEL||"claude-sonnet-4-6",forceRules=false}={}){
    this.apiKey=apiKey; this.model=model; this.forceRules=forceRules;
  }
  async diagnose(input){
    if(!this.apiKey || this.forceRules) return {...ruleBasedDiagnosis(input),source:"rules"};
    try{
      const result=await this.callClaude(input);
      if(!validateShape(result)) return {...ruleBasedDiagnosis(input),source:"rules",fallbackReason:"LLM schema validation failed"};
      return {...result,source:"llm"};
    }catch(error){ return {...ruleBasedDiagnosis(input),source:"rules",fallbackReason:error.message}; }
  }
  async callClaude(input){
    const response=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"content-type":"application/json","x-api-key":this.apiKey,"anthropic-version":"2023-06-01"},body:JSON.stringify({model:this.model,max_tokens:700,system:SYSTEM_PROMPT,messages:[{role:"user",content:JSON.stringify(input)}]})});
    if(!response.ok) throw new Error(`Claude API ${response.status}: ${await response.text()}`);
    const data=await response.json();
    const text=data?.content?.find(x=>x.type==="text")?.text;
    if(!text) throw new Error("Claude returned no text content");
    return JSON.parse(text.replace(/^```json\s*/i,"").replace(/^```\s*/i,"").replace(/\s*```$/i,"").trim());
  }
}
module.exports={RevenueRecoveryAgent,validateShape,ruleBasedDiagnosis,ALLOWED_ACTIONS};
