const BANNED_PATTERNS=[/\bguarantee\b/i,/\b100%\b/i,/\bact now\b/i,/\blast chance\b/i,/\bimmediately\b/i,/\baccount\s+(suspend|block|close)\b/i];
const TEMPLATES={
  PAYMENT_RETRY:"We couldn't complete your payment due to a temporary issue. You can try again when convenient.",
  PAYMENT_LINK:"Your payment could not be completed. Please use the payment link below to try again.",
  REMINDER:"Your payment is still pending. Please review your payment method and try again when convenient.",
  NONE:null
};
function sanitize(message){ if(!message)return null; for(const p of BANNED_PATTERNS)if(p.test(message))return null; return message.trim(); }
function generateMessage({messageType,paymentLink}){let m=TEMPLATES[messageType]??null;if(!m)return null;if(paymentLink)m+=`\n\nPayment link: ${paymentLink}`;return sanitize(m);}
module.exports={generateMessage,sanitize,BANNED_PATTERNS};
