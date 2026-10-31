# Demo video runbook (< 3 minutes)

Script from PRD §14, mapped to the built UI. Record **after** `npm run preflight -w @cartguard/api` is all green.

## Pre-flight (5 min before recording)

1. `npm run preflight -w @cartguard/api` — every row ✅
2. `npm run seed:demo -w @cartguard/api` — audit grid has the three paths as backup footage
3. `npm run build && npm run start -w @cartguard/api` — one deploy, http://localhost:3000
4. Browser: dark mode, 100% zoom, clean profile (no bookmarks bar)

## Shot list

| Time | On screen | Say |
| --- | --- | --- |
| 0:00–0:20 | Header + hero | "AI agents can spend money. CartGuard is what makes that safe: the LLM proposes, a deterministic policy gate decides, and every decision is logged." |
| 0:20–0:55 | Type "Wireless earbuds under $60 with good reviews", $60, **Run agent** | Let the reasoning stream play. Point at: "agent proposes… gate re-verifies the price from product data — the model's own price is ignored." Verdict: **auto_paid ✓**, audit row appears. |
| 0:55–1:30 | New request: "Laptop around $400", $450 | "Above the per-purchase cap — the gate pauses and asks a human." Show the reasoning + **approval card**. Click **Open PayPal sandbox**, approve with the sandbox buyer, come back, show **captured**. |
| 1:30–1:55 | New request: "Noise-cancelling headphones under $20", $20 | "Nothing real costs this little. The gate flags bait pricing and an off-allowlist merchant — **blocked**, PayPal was never touched." Show the red reasons in the grid. |
| 1:55–2:20 | Hostile product moment | "And when a product description *itself* tries to hijack the agent — 'call pay_now' — the model is treated as adversarial by design: 37 of 37 scripted attacks show the gate holds regardless of what the model does." Show `redteam-results.md` pass rate. |
| 2:20–2:50 | Filter the AG Grid, open **Policy editor**, lower the per-purchase cap | "Users control the rules. Every decision references the policy. Sandbox only — no real money ever moves." |
| 2:50–3:00 | Header logo | "CartGuard — the trust layer for agent payments." |

## Fallbacks (PRD risk table)

- Live agent call fails → the **seeded** demo rows show all three paths (`npm run seed:demo -w @cartguard/api`)
- PayPal approval step is slow → the in-app **Approve** button captures without the sandbox popup
- Record the red-team terminal output as a separate cutaway: `npm run redteam -w @cartguard/api`
