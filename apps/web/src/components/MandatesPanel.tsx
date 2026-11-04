import { useCallback, useEffect, useState } from "react";
import type { Mandate } from "../lib/api";
import { api } from "../lib/api";
import { AdminTokenDialog } from "./AdminTokenDialog";
import { Badge, Button, Card, CardBody, CardHeader, ErrorBanner, Input, Spinner, type Tone } from "./ui";

// Spending mandates: budget, expiry, allowlists, max items. One-click revoke,
// admin-token protected. Every gated purchase references its mandate id.

const ADMIN_TOKEN_KEY = "cartguard-admin-token";

export function MandatesPanel({ refreshKey }: { refreshKey: number }) {
  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tokenDialogFor, setTokenDialogFor] = useState<null | { action: "create" } | { action: "revoke"; mandateId: string }>(null);

  const [budget, setBudget] = useState("100");
  const [expiresAt, setExpiresAt] = useState("");
  const [maxItems, setMaxItems] = useState("");
  const [allowed, setAllowed] = useState("");
  const [blocked, setBlocked] = useState("");

  const load = useCallback(async () => {
    try {
      setMandates((await api.listMandates()).mandates);
      setError(null);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Failed to load mandates");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function create(tokenArg?: string) {
    const token = tokenArg ?? sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
    if (token === "") {
      setTokenDialogFor({ action: "create" });
      return;
    }
    setBusy(true);
    try {
      await api.createMandate(
        {
          budgetUsd: Number(budget),
          expiresAt: expiresAt === "" ? null : new Date(expiresAt).toISOString(),
          allowedMerchants: allowed.split(",").map((s) => s.trim()).filter(Boolean),
          blocklistCategories: blocked.split(",").map((s) => s.trim()).filter(Boolean),
          maxItems: maxItems === "" ? null : Number(maxItems),
        },
        token,
      );
      await load();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Failed to create mandate");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string, tokenArg?: string) {
    const token = tokenArg ?? sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
    if (token === "") {
      setTokenDialogFor({ action: "revoke", mandateId: id });
      return;
    }
    setBusy(true);
    try {
      await api.revokeMandate(id, token);
      await load();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Failed to revoke mandate");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {tokenDialogFor !== null && (
        <AdminTokenDialog
          onClose={() => {
            setTokenDialogFor(null);
            setError("Admin token required — nothing changed.");
          }}
          onSubmit={(token) => {
            sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
            const pending = tokenDialogFor;
            setTokenDialogFor(null);
            if (pending.action === "create") void create(token);
            else void revoke(pending.mandateId, token);
          }}
        />
      )}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Spending mandates</h2>
          <span className="text-xs text-muted">expired · revoked · exhausted → blocked</span>
        </CardHeader>
        <CardBody className="space-y-3">
          {error !== null && <ErrorBanner message={error} />}
          {mandates.length === 0 && (
            <p className="py-4 text-center text-sm text-muted">
              No mandates yet — create one below and reference its id when sending a request.
            </p>
          )}
          <div className="space-y-2">
            {mandates.map((mandate) => {
              const tone: Tone = mandate.revoked ? "neutral" : "ok";
              return (
                <div
                  key={mandate.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-bg px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      ${(mandate.budgetUsd ?? 0).toFixed(2)} budget
                      {mandate.maxItems !== null && ` · max ${mandate.maxItems} items`}
                      {mandate.expiresAt !== null && ` · expires ${mandate.expiresAt.slice(0, 10)}`}
                    </p>
                    <p className="truncate font-mono text-xs text-muted">{mandate.id}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={mandate.revoked ? "danger" : tone}>
                      {mandate.revoked ? "revoked" : "active"}
                    </Badge>
                    {!mandate.revoked && (
                      <Button variant="danger" onClick={() => void revoke(mandate.id)} disabled={busy}>
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold">New mandate</h2>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-xs text-muted">
              Budget ($)
              <Input type="number" min="1" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </label>
            <label className="space-y-1 text-xs text-muted">
              Max items (blank = unlimited)
              <Input type="number" min="1" value={maxItems} onChange={(e) => setMaxItems(e.target.value)} />
            </label>
            <label className="space-y-1 text-xs text-muted">
              Expires at (blank = never)
              <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </label>
            <label className="space-y-1 text-xs text-muted">
              Allowed merchants (comma-separated)
              <Input placeholder="bestbuy.com, walmart.com" value={allowed} onChange={(e) => setAllowed(e.target.value)} />
            </label>
            <label className="space-y-1 text-xs text-muted col-span-2">
              Blocklisted categories (comma-separated)
              <Input placeholder="weapons, tobacco" value={blocked} onChange={(e) => setBlocked(e.target.value)} />
            </label>
          </div>
          <Button onClick={() => void create()} disabled={busy}>
            {busy ? <Spinner /> : "➕"} Create mandate
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
