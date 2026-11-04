import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { RequestDetail } from "../lib/api";
import { api } from "../lib/api";
import { Badge, Button, Card, CardBody, CardHeader, ErrorBanner, Spinner, type Tone } from "./ui";

const TERMINAL = ["captured", "needs_approval", "rejected", "blocked", "failed"];

const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "queued", tone: "neutral" },
  running: { label: "agent running", tone: "accent" },
  captured: { label: "auto_paid ✓", tone: "ok" },
  needs_approval: { label: "needs your approval", tone: "warn" },
  rejected: { label: "rejected", tone: "neutral" },
  blocked: { label: "blocked", tone: "danger" },
  failed: { label: "failed", tone: "danger" },
};

interface StoryBeat {
  icon: string;
  title: string;
  detail?: string;
}

/** Turns a raw trace entry into a human sentence. Falls back to the raw text
 * when the payload is not one of our known shapes. */
function toStoryBeat(entry: { kind: string; text: string }): StoryBeat {
  const parsed: Record<string, unknown> | null = (() => {
    try {
      const trimmed =
        entry.text.startsWith("{") || entry.text.startsWith("[")
          ? entry.text
          : entry.text.slice(entry.text.indexOf(" ") + 1);
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();

  if (entry.kind === "tool_call" && entry.text.startsWith("search_products")) {
    const query = parsed !== null && typeof parsed.query === "string" ? parsed.query : "";
    return { icon: "🔍", title: `Searching product data${query !== "" ? `: “${query}”` : ""}` };
  }
  if (entry.kind === "tool_call" && entry.text.startsWith("get_product")) {
    const id = parsed !== null && typeof parsed.product_id === "string" ? parsed.product_id : "";
    return { icon: "🔎", title: `Verifying candidate ${id} with the product API` };
  }
  if (entry.kind === "tool_call" && entry.text.startsWith("propose_purchase")) {
    return { icon: "📝", title: "Submitting the pick for gate review" };
  }
  if (entry.kind === "tool_result" && parsed !== null && Array.isArray(parsed.products)) {
    const count = parsed.products.length;
    const median =
      typeof parsed.median_price_usd === "number" ? `$${parsed.median_price_usd.toFixed(2)}` : "n/a";
    return { icon: "🧾", title: `Found ${count} product${count === 1 ? "" : "s"} · median price ${median}`, detail: entry.text };
  }
  if (entry.kind === "tool_result" && parsed !== null && typeof parsed.title === "string") {
    const offer = parsed.price_usd;
    const merchant = typeof parsed.merchant === "string" ? parsed.merchant : "";
    const stock = parsed.availability === "InStock" ? "in stock" : "availability unknown";
    return {
      icon: "✅",
      title: `Verified: ${parsed.title} — ${typeof offer === "number" ? `$${offer.toFixed(2)}` : "price n/a"} at ${merchant} (${stock})`,
      detail: entry.text,
    };
  }
  if (entry.kind === "proposal") {
    return { icon: "⚡", title: entry.text };
  }
  if (entry.kind === "error") {
    return { icon: "⚠️", title: entry.text };
  }
  if (entry.kind === "assistant_text" && entry.text.trim() !== "") {
    return { icon: "💬", title: entry.text };
  }
  if (entry.kind === "tool_result" && entry.text.includes("Unknown tool")) {
    const tool = entry.text.replace("Unknown tool: ", "").trim();
    return { icon: "🛡️", title: `Blocked an unknown tool call (“${tool}”) — no such capability exists` };
  }
  return { icon: "·", title: entry.text };
}

export function RequestView({
  requestId,
  requestToken,
  mockMode = false,
  onSettled,
}: {
  requestId: string;
  requestToken: string;
  mockMode?: boolean;
  onSettled: () => void;
}) {
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const settledRef = useRef(false);
  const streamRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    settledRef.current = false;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const data = await api.getRequest(requestId);
        if (!alive) return;
        setDetail(data);
        setError(null);
        if (TERMINAL.includes(data.request.status)) {
          if (!settledRef.current) {
            settledRef.current = true;
            onSettled();
          }
          return;
        }
      } catch (cause: unknown) {
        if (!alive) return;
        setError(cause instanceof Error ? cause.message : "Failed to load request");
      }
      timer = setTimeout(() => void poll(), 700);
    }

    void poll();
    return () => {
      alive = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [requestId, onSettled]);

  useEffect(() => {
    if (streamRef.current !== null) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [detail?.request.trace.length]);

  async function decide(action: "approve" | "reject") {
    setBusy(true);
    try {
      if (action === "approve") await api.approve(requestId, requestToken);
      else await api.reject(requestId, requestToken);
      setDetail(await api.getRequest(requestId));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  }

  if (error !== null && detail === null) {
    return <ErrorBanner message={error} onRetry={() => setError(null)} />;
  }
  if (detail === null) {
    return (
      <Card>
        <CardBody className="flex items-center gap-3 text-sm text-muted">
          <Spinner className="text-accent" /> Agent is thinking…
        </CardBody>
      </Card>
    );
  }

  const { request, audit } = detail;
  const statusMeta = STATUS_META[request.status] ?? { label: request.status, tone: "neutral" as Tone };
  const gateRow = audit.find((row) => row.step === "gate");
  const chosen = request.chosenProduct;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
            <span className="font-mono text-xs text-muted">#{request.id.slice(0, 8)}</span>
          </div>
          <p className="mt-1 truncate text-sm font-medium">{request.goal}</p>
        </div>
        <div className="text-right text-xs text-muted">
          budget <span className="font-mono text-fg">${request.budgetUsd.toFixed(2)}</span>
          {gateRow?.priceUsd != null && (
            <>
              {" · verified price "}
              <span className="font-mono text-fg">${gateRow.priceUsd.toFixed(2)}</span>
            </>
          )}
        </div>
      </CardHeader>

      <CardBody className="space-y-4">
        {/* Reasoning stream */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Agent reasoning
          </p>
          <div
            ref={streamRef}
            aria-live="polite"
            className="max-h-72 space-y-1.5 overflow-y-auto rounded-xl border border-border bg-bg p-3 text-xs"
          >
            {request.trace.length === 0 && (
              <p className="text-muted">Waiting for the first model turn…</p>
            )}
            <AnimatePresence initial={false}>
              {request.trace.map((entry, index) => {
                const beat = toStoryBeat(entry);
                return (
                  <motion.div
                    key={`${entry.step}-${entry.kind}-${index}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex gap-2"
                  >
                    <span aria-hidden>{beat.icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-fg">{beat.title}</p>
                      {beat.detail !== undefined && (
                        <details className="mt-0.5">
                          <summary className="cursor-pointer select-none text-muted">raw data</summary>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-muted">
                            {beat.detail}
                          </pre>
                        </details>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>

        {/* Verified pick */}
        {chosen !== null && chosen.bestOffer !== null && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-bg px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {chosen.brand !== "" && <span className="text-muted">{chosen.brand} · </span>}
                {chosen.title}
              </p>
              <p className="text-xs text-muted">
                verified via Channel3 · {chosen.bestOffer.domain}
                {chosen.rating !== null && ` · ★ ${chosen.rating.toFixed(1)}`}
              </p>
            </div>
            <Badge tone="ok">${chosen.bestOffer.price.toFixed(2)}</Badge>
          </div>
        )}

        {/* Gate reasons */}
        {gateRow != null && gateRow.reasons.length > 0 && (
          <div className="space-y-1.5">
            {gateRow.reasons.map((reason) => (
              <div
                key={`${reason.rule}-${reason.message}`}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  reason.outcome === "blocked"
                    ? "border-danger/30 bg-danger/5 text-danger"
                    : "border-warn/30 bg-warn/5 text-warn"
                }`}
              >
                <span className="font-mono font-semibold">{reason.rule}</span> — {reason.message}
              </div>
            ))}
          </div>
        )}

        {/* Verdict banner */}
        <AnimatePresence>
          {TERMINAL.includes(request.status) && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 22 }}
            >
              <div
                className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
                  request.status === "captured"
                    ? "border-ok/30 bg-ok/10 text-ok"
                    : request.status === "needs_approval"
                      ? "border-warn/30 bg-warn/10 text-warn"
                      : request.status === "blocked" || request.status === "failed"
                        ? "border-danger/30 bg-danger/10 text-danger"
                        : "border-border bg-fg/5 text-muted"
                }`}
              >
                {request.status === "captured" &&
                  "Payment captured in PayPal sandbox — every step is in the audit log."}
                {request.status === "needs_approval" &&
                  "The gate needs a human decision before any money moves."}
                {request.status === "blocked" && "Blocked by policy. Nothing was purchased."}
                {request.status === "rejected" && "Rejected by you. Nothing was purchased."}
                {request.status === "failed" && "The run failed — see the audit log for details."}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Approval card */}
        {request.status === "needs_approval" && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-warn/30 bg-warn/5 p-4"
          >
            <p className="text-sm font-medium text-warn">Approval required</p>
            <p className="mt-1 text-xs text-muted">
              Approving opens the PayPal sandbox buyer flow
              {request.approvalUrl === null ? "" : " or captures directly here"}. Rejecting keeps
              every dollar in your wallet.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {request.approvalUrl !== null && !mockMode && (
                <Button
                  variant="outline"
                  onClick={() => window.open(request.approvalUrl ?? "", "_blank")}
                >
                  Open PayPal sandbox ↗
                </Button>
              )}
              {mockMode && (
                <span className="inline-flex items-center rounded-full border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs text-accent">
                  mock rail — the real PayPal link appears in live mode
                </span>
              )}
              <Button variant="ok" onClick={() => void decide("approve")} disabled={busy}>
                {busy ? <Spinner /> : "✓"} Approve
              </Button>
              <Button variant="danger" onClick={() => void decide("reject")} disabled={busy}>
                Reject
              </Button>
            </div>
          </motion.div>
        )}

        {error !== null && <ErrorBanner message={error} />}
      </CardBody>
    </Card>
  );
}
