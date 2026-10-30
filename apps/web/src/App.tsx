import { useCallback, useEffect, useState } from "react";
import { AuditGrid } from "./components/AuditGrid";
import { Header } from "./components/Header";
import { NewRequestCard } from "./components/NewRequestCard";
import { PolicyEditor } from "./components/PolicyEditor";
import { RequestView } from "./components/RequestView";
import { api } from "./lib/api";
import { cn } from "./components/ui";

type Theme = "dark" | "light";
type Tab = "audit" | "policy";

export function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem("cartguard-theme");
    return stored === "light" ? "light" : "dark";
  });
  const [health, setHealth] = useState<{ ok: boolean; paypal: string } | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [auditKey, setAuditKey] = useState(0);
  const [tab, setTab] = useState<Tab>("audit");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("cartguard-theme", theme);
  }, [theme]);

  useEffect(() => {
    void (async () => {
      try {
        setHealth(await api.health());
      } catch {
        setHealth(null);
      }
    })();
  }, []);

  const onSettled = useCallback(() => {
    setAuditKey((key) => key + 1);
  }, []);

  return (
    <div className="min-h-full">
      <Header
        health={health}
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
      />
      <main className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <NewRequestCard onCreated={(id) => setActiveRequestId(id)} />
            {activeRequestId !== null && (
              <RequestView requestId={activeRequestId} onSettled={onSettled} />
            )}
          </div>
          <div className="space-y-4">
            <div className="flex gap-2">
              {(["audit", "policy"] as Tab[]).map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setTab(name)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                    tab === name
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-muted hover:text-fg",
                  )}
                >
                  {name === "audit" ? "Audit log" : "Policy editor"}
                </button>
              ))}
            </div>
            {tab === "audit" ? <AuditGrid refreshKey={auditKey} /> : <PolicyEditor />}
          </div>
        </div>
        <p className="pb-4 text-center text-xs text-muted">
          CartGuard runs against the PayPal sandbox — no real money ever moves. The LLM has no
          payment tool; only the policy gate or your explicit approval can reach PayPal.
        </p>
      </main>
    </div>
  );
}
