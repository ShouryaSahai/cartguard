import { Badge, Button } from "./ui";

export function Header({
  health,
  theme,
  onToggleTheme,
}: {
  health: { ok: boolean; paypal: string } | null;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-border bg-card/70 px-5 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <ShieldLogo />
        <div className="leading-tight">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold tracking-tight">CartGuard</span>
            <Badge tone="accent">sandbox</Badge>
          </div>
          <p className="hidden text-xs text-muted sm:block">
            The trust layer for agent payments
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Badge tone={health === null ? "neutral" : health.paypal === "configured" ? "ok" : "warn"}>
          <span
            className={`inline-block size-1.5 rounded-full ${
              health === null ? "bg-muted" : health.ok ? "bg-ok" : "bg-danger"
            }`}
          />
          {health === null ? "connecting" : health.paypal === "configured" ? "rail ready" : "rail off"}
        </Badge>
        <Button variant="ghost" onClick={onToggleTheme} aria-label="toggle theme">
          {theme === "dark" ? "☀️" : "🌙"}
        </Button>
      </div>
    </header>
  );
}

function ShieldLogo() {
  return (
    <svg viewBox="0 0 24 24" className="size-8" fill="none" aria-hidden="true">
      <path
        d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
        stroke="var(--accent)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="m9 12 2 2 4-4"
        stroke="var(--accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="11" stroke="var(--border)" strokeDasharray="2 4" />
    </svg>
  );
}
