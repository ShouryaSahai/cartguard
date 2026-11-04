import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { Header } from "./components/Header";
import { NewRequestCard } from "./components/NewRequestCard";
import { PolicyEditor } from "./components/PolicyEditor";
import { RequestView } from "./components/RequestView";
import { api } from "./lib/api";
import { cn, Spinner } from "./components/ui";
import { ChartsPanel } from "./components/ChartsPanel";
import { MandatesPanel } from "./components/MandatesPanel";

// AG Grid is heavy — load it only when the audit tab is opened.
const AuditGrid = lazy(async () => ({ default: await import("./components/AuditGrid").then((m) => m.AuditGrid) }));

type Theme = "dark" | "light";
type Tab = "audit" | "insights" | "policy" | "mandates";

export function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem("cartguard-theme");
    return stored === "light" ? "light" : "dark";
  });
  const [health, setHealth] = useState<{ ok: boolean; mode: "mock" | "live"; paypal: string } | null>(null);
  const [activeRequest, setActiveRequest] = useState<{ id: string; token: string } | null>(null);
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
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:text-accent-fg"
      >
        Skip to content
      </a>
      <Header
        health={health}
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
      />
      <main id="main-content" className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6">
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <div className="space-y-4 lg:sticky lg:top-20">
            <NewRequestCard onCreated={(id, token) => setActiveRequest({ id, token })} />
            {activeRequest !== null && (
              <RequestView
                requestId={activeRequest.id}
                requestToken={activeRequest.token}
                mockMode={health?.mode === "mock"}
                onSettled={onSettled}
              />
            )}
          </div>
          <div className="space-y-4">
            <div className="flex gap-2">
              {(["audit", "insights", "policy", "mandates"] as Tab[]).map((name) => (
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
                  {
                    name === "audit"
                      ? "Audit log"
                      : name === "insights"
                        ? "Insights"
                        : name === "mandates"
                          ? "Mandates"
                          : "Policy editor"
                  }
                </button>
              ))}
            </div>
            {tab === "insights" ? (
              <ChartsPanel refreshKey={auditKey} />
            ) : tab === "mandates" ? (
              <MandatesPanel refreshKey={auditKey} />
            ) : tab === "audit" ? (
              <Suspense
                fallback={
                  <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 text-sm text-muted">
                    <Spinner className="text-accent" /> Loading audit log…
                  </div>
                }
              >
                <AuditGrid refreshKey={auditKey} />
              </Suspense>
            ) : (
              <PolicyEditor />
            )}
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
