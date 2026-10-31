import { useState } from "react";
import { api } from "../lib/api";
import { Button, Card, CardBody, CardHeader, ErrorBanner, Input, Spinner } from "./ui";

const EXAMPLES: Array<{ label: string; goal: string; budget: number; path: string }> = [
  { label: "auto_pay", goal: "Wireless earbuds under $60 with good reviews", budget: 60, path: "small, normal purchase" },
  { label: "needs_approval", goal: "Laptop around $400 for uni", budget: 450, path: "above the per-purchase cap" },
  { label: "blocked", goal: "Noise-cancelling headphones under $20", budget: 20, path: "nothing real costs this little" },
];

export function NewRequestCard({ onCreated }: { onCreated: (id: string, requestToken: string) => void }) {
  const [goal, setGoal] = useState("");
  const [budget, setBudget] = useState("60");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const parsedBudget = Number(budget);
    if (goal.trim().length < 3 || !Number.isFinite(parsedBudget) || parsedBudget <= 0) {
      setError("Give the agent a goal (3+ chars) and a positive budget.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { id, requestToken } = await api.createRequest(goal.trim(), parsedBudget);
      onCreated(id, requestToken);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Request failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">New shopping request</h2>
        <span className="text-xs text-muted">agent proposes · gate decides</span>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="e.g. Wireless earbuds under $60 with good reviews"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !submitting) void submit();
            }}
          />
          <div className="flex items-center gap-2">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">
                $
              </span>
              <Input
                className="w-28 pl-7"
                type="number"
                min="1"
                step="1"
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
                aria-label="budget in USD"
              />
            </div>
            <Button onClick={() => void submit()} disabled={submitting}>
              {submitting ? <Spinner /> : "▶"} Run agent
            </Button>
          </div>
        </div>
        {error !== null && <ErrorBanner message={error} />}
        <div className="flex flex-wrap gap-2 pt-1">
          {EXAMPLES.map((example) => (
            <button
              key={example.label}
              type="button"
              className="rounded-full border border-border px-3 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-accent"
              onClick={() => {
                setGoal(example.goal);
                setBudget(String(example.budget));
              }}
              title={`Demo path: ${example.path}`}
            >
              {example.label}: {example.goal}
            </button>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
