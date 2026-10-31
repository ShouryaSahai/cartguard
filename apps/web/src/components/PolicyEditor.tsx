import { useEffect, useState } from "react";
import type { PolicyConfig } from "@cartguard/shared";
import { api } from "../lib/api";
import { Button, Card, CardBody, CardHeader, ErrorBanner, Input, Spinner } from "./ui";

function csv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== "");
}

export function PolicyEditor() {
  const [config, setConfig] = useState<PolicyConfig | null>(null);
  const [merchants, setMerchants] = useState("");
  const [categories, setCategories] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [replays, setReplays] = useState<Array<{ requestId: string; oldVerdict: string; newVerdict: string; changed: boolean; skipped?: string }> | null>(null);
  const [replayBusy, setReplayBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await api.getPolicy();
        setConfig(loaded);
        setMerchants(loaded.allowlistMerchants.join(", "));
        setCategories(loaded.blocklistCategories.join(", "));
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : "Failed to load policy");
      }
    })();
  }, []);

  async function save() {
    if (config === null) return;
    let adminToken = sessionStorage.getItem("cartguard-admin-token") ?? "";
    if (adminToken === "") {
      const entered = window.prompt("Enter the admin token (ADMIN_TOKEN) to save the policy:");
      if (entered === null || entered.trim() === "") {
        setError("Saving the policy requires an admin token.");
        return;
      }
      adminToken = entered.trim();
    }
    setBusy(true);
    setSaved(false);
    try {
      const next: PolicyConfig = {
        ...config,
        allowlistMerchants: csv(merchants),
        blocklistCategories: csv(categories),
      };
      const stored = await api.putPolicy(next, adminToken);
      sessionStorage.setItem("cartguard-admin-token", adminToken);
      setConfig(stored);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : "Failed to save policy";
      if (message.includes("401") || message.includes("403")) {
        sessionStorage.removeItem("cartguard-admin-token");
        setError("Admin token missing or invalid — nothing was saved.");
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (config === null) {
    return (
      <Card>
        <CardBody className="flex items-center gap-3 text-sm text-muted">
          {error !== null ? <ErrorBanner message={error} /> : <><Spinner className="text-accent" /> Loading policy…</>}
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Policy — what the gate enforces</h2>
        {saved && <span className="text-xs text-ok">saved ✓</span>}
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-xs text-muted">
            Per-purchase cap ($)
            <Input
              type="number"
              min="1"
              value={config.perPurchaseCap}
              onChange={(event) => setConfig({ ...config, perPurchaseCap: Number(event.target.value) })}
            />
            <span className="block">Above this → needs approval</span>
          </label>
          <label className="space-y-1 text-xs text-muted">
            Weekly cap ($)
            <Input
              type="number"
              min="1"
              value={config.weeklyCap}
              onChange={(event) => setConfig({ ...config, weeklyCap: Number(event.target.value) })}
            />
            <span className="block">7-day captured total + price above this → approval</span>
          </label>
          <label className="space-y-1 text-xs text-muted">
            Suspiciously expensive (× median)
            <Input
              type="number"
              step="0.1"
              value={config.priceMultiplierHigh}
              onChange={(event) => setConfig({ ...config, priceMultiplierHigh: Number(event.target.value) })}
            />
            <span className="block">Price above median × this → approval</span>
          </label>
          <label className="space-y-1 text-xs text-muted">
            Suspiciously cheap (× median)
            <Input
              type="number"
              step="0.1"
              value={config.priceMultiplierLow}
              onChange={(event) => setConfig({ ...config, priceMultiplierLow: Number(event.target.value) })}
            />
            <span className="block">Price below median × this → approval</span>
          </label>
        </div>
        <label className="block space-y-1 text-xs text-muted">
          Merchant allowlist (comma-separated, empty = any)
          <Input
            placeholder="macys.com, bestbuy.com"
            value={merchants}
            onChange={(event) => setMerchants(event.target.value)}
          />
          <span className="block">Off-list merchants → needs approval</span>
        </label>
        <label className="block space-y-1 text-xs text-muted">
          Category blocklist (comma-separated)
          <Input
            placeholder="weapons, tobacco"
            value={categories}
            onChange={(event) => setCategories(event.target.value)}
          />
          <span className="block">Blocked outright, never purchased</span>
        </label>
        {error !== null && <ErrorBanner message={error} onRetry={() => setError(null)} />}
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? <Spinner /> : "💾"} Save policy
        </Button>
      </CardBody>
    </Card>
  );
}
