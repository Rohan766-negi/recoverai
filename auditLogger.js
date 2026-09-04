const { generateId }=require("./utils/id");
const EVENT_TYPES=["PAYMENT_FAILED","RISK_DETECTED","AI_DIAGNOSIS","AI_RECOMMENDATION","POLICY_APPROVED","POLICY_BLOCKED","POLICY_ESCALATED","RECOVERY_ATTEMPTED","PAYMENT_RECOVERED","RECOVERY_FAILED","ESCALATED"];
class AuditLogger{
  constructor({clock=()=>new Date()}={}){this.events=[];this.clock=clock;}
  append({eventType,actor="system",action=null,result=null,metadata={},policyVersion=null}){
    if(!EVENT_TYPES.includes(eventType))throw new Error(`Unsupported audit event: ${eventType}`);
    const event={eventId:generateId("evt"),timestamp:this.clock().toISOString(),eventType,actor,action,result,metadata,policyVersion};
    this.events.push(Object.freeze(event));return event;
  }
  getAll(){return [...this.events].sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));}
  getByTransaction(id){return this.getAll().filter(e=>e.metadata?.transactionId===id);}
}
module.exports={AuditLogger,EVENT_TYPES};
