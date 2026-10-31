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

const KIND_META: Record<string, { icon: string; tone: string }> = {
  assistant_text: { icon: "💬", tone: "text-fg" },
  tool_call: { icon: "⚙️", tone: "text-accent" },
  tool_result: { icon: "↳", tone: "text-muted" },
  proposal: { icon: "⚡", tone: "text-warn" },
  error: { icon: "✗", tone: "text-danger" },
};

export function RequestView({
  requestId,
  requestToken,
  onSettled,
}: {
  requestId: string;
  requestToken: string;
  onSettled: () => void;
}) {
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const settledRef = useRef(false);

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
          <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl border border-border bg-bg p-3 font-mono text-xs">
            {request.trace.length === 0 && (
              <p className="text-muted">Waiting for the first model turn…</p>
            )}
            <AnimatePresence initial={false}>
              {request.trace.map((entry) => {
                const meta = KIND_META[entry.kind] ?? { icon: "·", tone: "text-fg" };
                return (
                  <motion.div
                    key={`${entry.step}-${entry.kind}-${entry.text.slice(0, 24)}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex gap-2"
                  >
                    <span aria-hidden>{meta.icon}</span>
                    <span className={`${meta.tone} break-all`}>{entry.text.slice(0, 300)}</span>
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
              {request.approvalUrl !== null && (
                <Button
                  variant="outline"
                  onClick={() => window.open(request.approvalUrl ?? "", "_blank")}
                >
                  Open PayPal sandbox ↗
                </Button>
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
