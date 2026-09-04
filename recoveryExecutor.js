const { generateMessage } = require("./messageGenerator");
class RecoveryExecutor{
  constructor({paymentAdapter}){this.paymentAdapter=paymentAdapter;}
  async execute({transaction,action,attemptNumber,seed,recommendedDelayMinutes=0}){
    switch(action){
      case "RETRY_PAYMENT": return this.retry(transaction,attemptNumber,seed);
      case "WAIT_AND_RETRY": return {status:"SCHEDULED",action,scheduledFor:new Date(Date.now()+recommendedDelayMinutes*60000).toISOString(),recommendedDelayMinutes,message:"Retry scheduled; no immediate payment attempt was made."};
      case "SEND_PAYMENT_LINK": return this.sendPaymentLink(transaction);
      case "SEND_REMINDER": return this.sendReminder(transaction);
      case "ESCALATE_TO_HUMAN": return {status:"ESCALATED",action,message:"Transaction escalated for human review."};
      case "NO_ACTION": return {status:"NO_ACTION",action,message:"No recovery action taken."};
      default: throw new Error(`Unsupported recovery action: ${action}`);
    }
  }
  async retry(transaction,attemptNumber,seed){const r=await this.paymentAdapter.retryPayment(transaction,{attemptNumber,seed});return {...r,action:"RETRY_PAYMENT",status:r.success?"RECOVERED":"FAILED"};}
  async sendPaymentLink(transaction){const r=await this.paymentAdapter.createPaymentLink(transaction);if(!r.success)return {status:"EXECUTION_ERROR",action:"SEND_PAYMENT_LINK",error:r.error||"Unable to create payment link"};const paymentLink=r.paymentLink||r.data?.short_url;return {status:"SENT",action:"SEND_PAYMENT_LINK",paymentLink,message:generateMessage({messageType:"PAYMENT_LINK",paymentLink}),source:r.source};}
  async sendReminder(transaction){const r=await this.paymentAdapter.createPaymentLink(transaction);const paymentLink=r.paymentLink||r.data?.short_url||null;return {status:"SENT",action:"SEND_REMINDER",paymentLink,message:generateMessage({messageType:"REMINDER",paymentLink}),source:r.source};}
}
module.exports={RecoveryExecutor};
