# Devpost submission — CartGuard

> Agents can spend money. CartGuard is what makes that safe.

**CartGuard** is a shopping agent that can pay with PayPal — but only inside
rules the user controls. The LLM proposes a purchase, a **deterministic policy
gate decides**, and every decision is logged and explainable. The LLM has no
tool that can move money: the only code path to PayPal runs through the gate's
verdict or an explicit human approval, and the same gate is exposed over HTTP
and MCP so **any agent** can plug into it.

**Status: PayPal sandbox only. No real money ever moves.**

## What it does

- **Agent shopping, gated payments.** Give a goal and a budget. The agent
  searches real product data (Channel3), verifies its pick, and proposes. The
  gate re-fetches the price from product data (never trusting the model's
  stated price), evaluates the user's policy, and decides:
  `auto_pay` → PayPal sandbox capture · `needs_approval` → human decision ·
  `blocked` → refused with reasons.
- **Spending mandates.** Budget, expiry, allowed merchants/categories, max
  items — shown as a card, revocable in one click, referenced by mandate id in
  every audit row. Expired, revoked, or exhausted mandates block.
- **Every decision auditable.** Filterable AG Grid log with verdict badges,
  live reasoning stream, spend-over-time and verdict-breakdown charts.
- **Gate as infrastructure.** `POST /gate/propose` (API-key) and an MCP server
  (`propose_purchase` tool) expose the same gate to other agents — with no
  second code path to PayPal. A second agent ships in `examples/`.
- **Red-team scorecard.** 46/46 scripted attacks held — deterministic, offline
  proof that the gate holds **regardless of what the model does** (the suite
  does not measure LLM resistance; the model is treated as adversarial by
  design).

## How we built it

- **TypeScript everywhere.** Express + zod API, better-typed strict mode, one
  npm workspace (`apps/api`, `apps/mcp`, `apps/web`, `packages/shared`).
- **LLM:** Google Gemini free tier via the official OpenAI-compatible endpoint
  (tool calling, schema-validated with zod; the model has no payment tool).
- **Payments:** PayPal Orders v2 sandbox via the official
  `@paypal/paypal-server-sdk`, with a startup guard that refuses any
  non-sandbox base URL. Vault-on-success supported: after one approval,
  later auto-pay charges use the saved token with no buyer click.
- **Products:** Channel3 product graph — search, product detail (the gate's
  price re-verification source), price tracking capable.
- **UI:** Vite + React + Tailwind + shadcn-style components + Framer Motion +
  AG Grid + AG Charts. Dark/light themes, designed empty/loading/error states,
  375/768/1440 layouts.
- **Auth:** admin token for policy/mandate writes, per-request approval
  secrets for approve/reject, API key for the gate surface.

## Judging criteria

- **Technological implementation:** deterministic policy engine (9+ additive
  rule families), single money path, price re-verification, vault cycle,
  rate limiting, replay analysis. 95 offline unit/integration tests + 6
  browser end-to-end tests + a 46-attack red-team suite.
- **Design:** shipped-product UI with a consistent identity, animated verdict
  cards, live agent reasoning, charts, seeded demo data, three breakpoints.
- **Potential impact:** every agent payment needs a trust layer. CartGuard is
  the part you keep when the demo ends.
- **Innovation:** the gate is the product — exposed over MCP/HTTP so any agent
  (or harness) can route payments through rules the user controls.
- **Presentation:** 3-minute script in `docs/DEMO_SCRIPT.md`, screenshots in
  `docs/screenshots/`, one-command local run, one-click Render blueprint.

## Real usage numbers

<!-- PLACEHOLDER: run `npm run export:audit -w @cartguard/api` against the
     deployed instance and paste the CSV totals here (requests, blocks,
     approvals, attacks stopped). Do NOT invent numbers. -->

- Requests processed: **[PENDING — export from deployed instance]**
- Purchases auto-paid: **[PENDING]**
- Purchases needing approval: **[PENDING]**
- Blocked by policy: **[PENDING]**
- Red-team attacks held: **46/46** (deterministic suite — reproducible via
  `npm run redteam -w @cartguard/api`)

## Tools used

PayPal developer platform (Orders v2 sandbox, Vault), Channel3 product API,
Google Gemini (free tier, OpenAI-compatible endpoint), AG Grid, AG Charts,
Render, Postman/APIMatic (OpenAPI import), Playwright, Vitest.

## Try it

Hosted demo: **[PENDING — Render URL after deploy]**
Repo: https://github.com/ShouryaSahai/cartguard (MIT license)

```bash
npm install
cp .env.example .env   # add your sandbox keys
npm run build && npm run start -w @cartguard/api
```
