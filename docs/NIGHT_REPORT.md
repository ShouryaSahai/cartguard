# Night build report — `night-build` branch

Everything below ran on the `night-build` branch (never committed to main directly).
Final state at push: **104 offline tests · 12 browser e2e tests · typecheck clean ·
red-team 46/46 · no deploy performed · no secrets committed.**

## Item 1 — UI end-to-end check ✅ (commit `3a18eb8`)

- Playwright runs the **real built app** (Express + web bundle) in a deterministic
  mock-rails mode (`CARTGUARD_MOCK_RAILS=1`): scripted LLM, Channel3, and PayPal
  fakes; the pipeline, gate, and audit code paths are the real ones.
- 6 e2e tests: auto_pay, needs_approval (approve AND reject), blocked, policy
  editor without/with admin token, audit grid. Screenshots in `docs/screenshots/`.
- **Real bug found and fixed:** `apps/web/src/lib/api.ts` spread `...init` after
  the merged headers, so caller headers clobbered `Content-Type` — the policy
  PUT arrived bodyless on the real UI (400). Fixed by spreading init first.
- Also: keyboard-submit path used for the main form (headless-shell click
  quirk documented in the spec); full Chromium channel for reliable screenshots.

## Item 2 — Design pass ✅ (commit `5a3cb8d`)

- AG Charts added (`ag-charts-community`/`ag-charts-react` 14.2, workspace-scoped):
  captured spend over time (line) + verdict breakdown (donut) with
  verdict-matched colors and designed empty states, in a new **Insights** tab.
- Screenshot review at 375/768/1440 caught and fixed four real visual issues:
  verdict column rendered raw HTML (string cellRenderer → proper React badge),
  donut legend clipped, button label wrapping at 375px, cramped pagination bar.
- Demo dataset (`demoSeed.ts`/`demoSeedData.ts`) auto-seeds an empty audit log on
  boot (opt-out `CARTGUARD_SEED_DEMO=0`); seeded rows are labeled as demo rows.
- Evidence: `docs/screenshots/responsive-{375,768,1440}.png`,
  `insights-{375,768,1440}.png`, plus per-path screenshots from item 1.

## Item 3 — Gate as infrastructure ✅ (commit `225a8d5`)

- `executeProposal` extracted from the pipeline — the external surface shares the
  exact same gate → PayPal code path (no second money path).
- `POST /gate/propose` (API key `GATE_API_KEY`; unset → 403, wrong → 401) returns
  verdict, reasons, priceUsed, and the approval link for needs_approval.
- `apps/mcp`: stdio JSON-RPC MCP server (`propose_purchase` tool) bridging to the
  gate API — hand-rolled, zero dependencies, no PayPal code.
- `examples/second-agent.mjs`: a second agent calling the gate directly.
- Red-team +5 (`gate_api`): missing key, wrong key, price spoof through the
  surface, non-USD product, replay — scorecard **42/42** at this item.

## Item 4 — Spending mandates ✅ (commit `0ca9568`)

- Mandates: budget, expiry, allowed merchants/categories, max items, revocable
  in one click (admin-token protected). Referenced by `mandate_id` in every
  audit row and in the CSV export.
- Six **additive** policy rules (existing rules untouched): expired/revoked/
  exhausted/mandate-budget → blocked; mandate-merchant → needs_approval;
  mandate-category → blocked. A referenced-but-missing mandate counts as revoked.
- API: `POST/GET /mandates`, `POST /mandates/:id/revoke`; `mandate_id` accepted
  by `POST /requests` and `/gate/propose` (unknown id → 400).
- UI: Mandates panel (create/list/revoke) in the dashboard.
- Red-team +4 (`mandates`): expired, revoked, exhausted, budget exhaustion
  (4 captures then blocked) — scorecard **46/46**.

## Item 5 — Policy replay ✅ (commit `056cfd7`)

- `POST /policy/replay` (admin-token protected): replays the last 50 gate rows
  against a **draft** policy using stored product + budget data. Read-only —
  test asserts PayPal traffic is unchanged and stored verdicts untouched.
- Honest limits stated in UI and response: weekly-spend, median, and
  match-score rules are marked `skipped` because their inputs are not fully stored.
- UI: "Replay against audit" in the policy editor with old → new verdicts and
  would-change highlights.

## Item 6 — Docs ✅ (commit `fa0ddcd`)

- `docs/DEVPOST.md`: submission copy with clearly marked `[PENDING]` placeholders
  for real usage numbers (export via `npm run export:audit`) — no invented data.
- README: Mermaid architecture diagram (browser → API → agent → gate → PayPal,
  audit, and the gate-as-infrastructure surface).
- `docs/DEMO_SCRIPT.md`: tightened to a 3-minute cut covering all seven judged
  surfaces (three paths, mandates, replay, red-team).

## Item 7 — Report ✅ (this commit)

## Verification evidence (run after every item)

| Item | npm test | typecheck | red-team | e2e |
| --- | --- | --- | --- | --- |
| 1 | 95/95 | exit 0 | 37/37 | 6/6 |
| 2 | 95/95 | exit 0 | 37/37 | 12/12 |
| 3 | 95/95 | exit 0 | 42/42 | 12/12 |
| 4 | 103/103 | exit 0 | 46/46 | 12/12 |
| 5 | 104/104 | exit 0 | 46/46 | 12/12 |
| 6 | 104/104 | exit 0 | 46/46 | 12/12 |

## Skipped / not attempted

- Nothing was reverted under the 45-minute rule; all seven items landed.
- Render deploy explicitly **not** performed (owner instruction).
- Real usage numbers remain `[PENDING]` placeholders until the app runs on a
  deployed URL — no numbers were invented anywhere.

## Known issues (honest)

- The Insights e2e assertions check panel headers, not pixel content; the
  blank-chart regression seen during development (missing chart-module
  registration) was caught by screenshot review, and the empty states now cover
  the seeded dataset — but chart pixels are not asserted in CI.
- The per-IP rate limiter is in-memory: a server restart clears it (documented
  in code). Sufficient for demo-scale abuse protection, not a production WAF.
- The mandate-merchant rule **escalates to approval** rather than blocking —
  deliberate, consistent with the global allowlist semantics; flip to blocked
  by changing one outcome if desired.
- Policy replay deliberately skips weekly-spend/median/match-score rules
  (their historical inputs are not fully stored) — surfaced as `skipped` in the
  response and UI rather than pretending to recompute them.
- The MCP server is a stdio→HTTP bridge: MCP clients run it with `GATE_URL` +
  `GATE_API_KEY` pointing at a CartGuard API instance (single code path by design).
- `gh` CLI is not installed on this machine; pushes use the stored keychain
  credential.

## How to verify (exact commands)

```bash
git checkout night-build && git pull
npm install
npm run build                       # shared + web
npm test                            # 104 offline tests
npm run typecheck                   # all workspaces, strict
npm run redteam -w @cartguard/api   # 46/46 scorecard
npm run e2e                         # 12 browser tests (mock rails, real app)
npm run export:audit -w @cartguard/api   # CSV of the audit table
```

Manual UI (mock rails, no keys needed):

```bash
CARTGUARD_MOCK_RAILS=1 ADMIN_TOKEN=local-dev npm run start -w @cartguard/api
# open http://localhost:3000 — demo rows seeded automatically
```
