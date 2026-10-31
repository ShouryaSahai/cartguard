# Demo script — 3 minutes (tight cut)

Record after `npm run preflight -w @cartguard/api` is all green.
`CARTGUARD_MOCK_RAILS=1` gives a fully deterministic run if the live rails misbehave; say "demo mode" on camera if used.

| Time | On screen | Say / do |
| --- | --- | --- |
| 0:00–0:15 | Header + dashboard | "Agents can spend money. CartGuard is what makes that safe: the LLM proposes, a deterministic policy gate decides, and every decision is logged." |
| 0:15–0:50 | auto_pay preset → Run agent | Watch the reasoning stream. "The gate re-fetches the price from product data — the model's stated price is ignored. Verdict: auto_pay — captured in the PayPal sandbox, logged." Point at the audit row + spend chart. |
| 0:50–1:25 | needs_approval preset ($450 laptop) | "Above the per-purchase cap — the gate pauses for a human." Show the approval card → Approve → captured. Then a second run → Reject → "nothing was purchased." |
| 1:25–1:45 | blocked preset ($20 headphones) | "Bait pricing and an off-allowlist merchant — blocked, PayPal never touched. Reasons are right here in the grid." |
| 1:45–2:10 | Mandates tab | "Spending mandates: budget, expiry, allowed merchants, max items. One click to revoke — and the next purchase is blocked. Every audit row carries the mandate id." |
| 2:10–2:35 | Policy editor → change cap → Replay against audit | "Change a rule and replay past decisions — this one would have needed approval. Read-only; PayPal untouched." |
| 2:35–2:50 | Terminal: red-team suite | "46 of 46 scripted attacks held. The gate holds regardless of what the model does — and any agent can plug into it over MCP or HTTP." |
| 2:50–3:00 | Logo | "CartGuard — the trust layer for agent payments. Sandbox only; no real money moves." |

## Fallbacks

- Live rails slow → `CARTGUARD_MOCK_RAILS=1 npm run start -w @cartguard/api` (deterministic demo mode; say so on camera).
- Empty dashboard → `npm run seed:demo -w @cartguard/api`.
- Red-team cutaway → `npm run redteam -w @cartguard/api` (terminal output is the visual).
