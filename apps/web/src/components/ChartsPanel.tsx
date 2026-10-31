import { useEffect, useMemo, useState } from "react";
import { AgCharts } from "ag-charts-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type AgCartesianChartOptions,
  type AgChartOptions,
} from "ag-charts-community";

ModuleRegistry.registerModules([AllCommunityModule]);
import { api, type AuditRow } from "../lib/api";
import { Card, CardBody, CardHeader, ErrorBanner } from "./ui";

// Insights tab: spend over time + verdict breakdown, straight from the audit
// log. Empty states are designed, not blank.

const VERDICT_COLORS: Record<string, string> = {
  auto_pay: "#34d399",
  captured: "#34d399",
  approved: "#34d399",
  needs_approval: "#fbbf24",
  blocked: "#f87171",
  failed: "#f87171",
  rejected: "#8b95a7",
};

export function ChartsPanel({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setRows((await api.audit(500)).rows);
        setError(null);
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : "Failed to load insights");
      }
    })();
  }, [refreshKey]);

  const spendData = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const row of rows) {
      if (row.step === "payment" && row.paypalStatus === "CAPTURED" && row.priceUsd !== null) {
        const day = row.ts.slice(0, 10);
        byDay.set(day, (byDay.get(day) ?? 0) + row.priceUsd);
      }
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount]) => ({ date, amount }));
  }, [rows]);

  const verdictData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (row.step === "gate") counts.set(row.verdict, (counts.get(row.verdict) ?? 0) + 1);
    }
    return [...counts.entries()].map(([verdict, count]) => ({ verdict, count }));
  }, [rows]);

  const chartTheme = useMemo(
    () => ({ background: { visible: false } }),
    [],
  );

  const spendOptions = useMemo(
    (): AgCartesianChartOptions => ({
      ...chartTheme,
      data: spendData,
      legend: { enabled: false },
      series: [
        {
          type: "line" as const,
          xKey: "date",
          yKey: "amount",
          yName: "Captured spend ($)",
          stroke: "#3b82f6",
          marker: { enabled: true, size: 5, fill: "#3b82f6" },
        },
      ],
    }),
    [spendData, chartTheme],
  );

  const verdictOptions = useMemo(
    () => ({
      ...chartTheme,
      data: verdictData,
      series: [
        {
          type: "donut" as const,
          angleKey: "count",
          calloutLabelKey: "verdict",
          calloutLabel: { color: "#8b95a7" },
          legendItemKey: "verdict",
          fills: verdictData.map((entry) => VERDICT_COLORS[entry.verdict] ?? "var(--accent)"),
          innerRadiusRatio: 0.6,
        },
      ],
    }),
    [verdictData, chartTheme],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Captured spend over time</h2>
          <span className="text-xs text-muted">sandbox dollars</span>
        </CardHeader>
        <CardBody>
          {error !== null && <ErrorBanner message={error} />}
          {spendData.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">
              No captured payments yet — run a request that passes the gate.
            </p>
          ) : (
            <div className="h-72">
              <AgCharts options={spendOptions} />
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold">Verdict breakdown</h2>
        </CardHeader>
        <CardBody>
          {verdictData.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">
              No gate decisions yet — the breakdown appears with your first request.
            </p>
          ) : (
            <div className="h-72">
              <AgCharts options={verdictOptions} />
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
