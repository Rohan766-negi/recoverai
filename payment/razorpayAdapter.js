const https = require("https");
const { PaymentSimulator } = require("./paymentSimulator");

class RazorpayAdapter {
  constructor({ keyId=process.env.RAZORPAY_KEY_ID, keySecret=process.env.RAZORPAY_KEY_SECRET, simulator=new PaymentSimulator() }={}) {
    this.keyId=keyId; this.keySecret=keySecret; this.simulator=simulator;
    this.mode=keyId && keySecret ? "razorpay_test" : "simulator";
  }

  async createPaymentLink(transaction) {
    if (this.mode === "simulator")
      return { success:true, source:"simulator", paymentLink:`https://recoverai.demo/pay/${transaction.transactionId}` };

    const payload = {
      amount:Math.round(Number(transaction.amountRupees)*100),
      currency:"INR",
      description:`RecoverAI recovery for ${transaction.transactionId}`,
      reference_id:transaction.transactionId,
      customer:{
        name:transaction.customerName || undefined,
        email:transaction.customerEmail || undefined,
        contact:transaction.customerPhone || undefined
      },
      notify:{ sms:false, email:false }
    };
    return this.request("POST","/v1/payment_links",payload);
  }

  async retryPayment(transaction, options={}) {
    return this.simulator.attemptRecovery(transaction, options);
  }

  async fetchPaymentStatus(paymentId) {
    if (this.mode === "simulator") return { success:false, source:"simulator", reason:"No live Razorpay payment configured" };
    try { return await this.request("GET",`/v1/payments/${paymentId}`); }
    catch(error) { return { success:false, source:"razorpay_test", error:error.message }; }
  }

  request(method,path,body) {
    return new Promise((resolve,reject)=>{
      const auth=Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
      const data=body ? JSON.stringify(body) : null;
      const req=https.request({
        hostname:"api.razorpay.com", path, method,
        headers:{ Authorization:`Basic ${auth}`, "Content-Type":"application/json", ...(data ? {"Content-Length":Buffer.byteLength(data)}:{}) }
      },res=>{
        let response="";
        res.on("data",chunk=>response+=chunk);
        res.on("end",()=>{
          let parsed; try { parsed=response?JSON.parse(response):{}; } catch { parsed={raw:response}; }
          if(res.statusCode<200 || res.statusCode>=300) return reject(new Error(parsed?.error?.description || parsed?.error?.code || `Razorpay request failed: ${res.statusCode}`));
          resolve({success:true,source:"razorpay_test",data:parsed});
        });
      });
      req.on("error",reject); if(data) req.write(data); req.end();
    });
  }
}
module.exports = { RazorpayAdapter };
