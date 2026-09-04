# RecoverAI

RecoverAI is a buildathon-ready prototype for **AI Revenue Recovery**.

## Architecture

Detection → AI Diagnosis → Deterministic Policy Engine → Recovery Executor → Payment Simulator/Razorpay Test Adapter → Outcome Tracking → Audit

**AI recommends. Policy authorizes. Executor executes.**

## Run

Requirements: Node.js 18+.

```bash
npm install
npm run dev
```

Frontend: http://localhost:5173  
API: http://localhost:5000

The app starts with 1,000 deterministic synthetic transactions using seed `42`.

## Optional AI

Copy `.env.example` to `.env` and add an Anthropic API key. Without a key, RecoverAI automatically uses its deterministic rule-based fallback.

Never commit `.env`.

## Optional Razorpay Test Mode

Add Razorpay test credentials to `.env`. The adapter stays isolated and never enables production payment behavior.

## Evaluation

Use the dashboard's **Run 1,000-case evaluation** button.

The evaluation compares RecoverAI against a simple naive baseline on the same generated dataset and reports recovered revenue, recovery rate, revenue recovery, uplift, escalations, blocks and scheduled actions.

Metrics are calculated from simulation outcomes; they are not hardcoded.

## Important demo story

1. Show revenue at risk.
2. Open a failed transaction.
3. Run the recovery agent.
4. Show AI diagnosis.
5. Show policy/guardrail decision.
6. Show recovery outcome.
7. Run the 1,000-case evaluation.
8. Compare RecoverAI against baseline.
9. Show the append-only audit trail.

## Security

- No API keys are hardcoded.
- Production money movement is not implemented.
- LLM output is schema-validated.
- Deterministic policy gates recovery actions.
- Customer opt-out blocks communication actions.
- Retry and high-value guardrails are enforced.
