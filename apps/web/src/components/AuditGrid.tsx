import { useCallback, useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import type { AuditRow } from "../lib/api";
import { api } from "../lib/api";
import { Button, Card, CardBody, CardHeader, ErrorBanner, Input, type Tone } from "./ui";

ModuleRegistry.registerModules([AllCommunityModule]);

const VERDICT_TONE: Record<string, Tone> = {
  auto_pay: "ok",
  captured: "ok",
  approved: "ok",
  needs_approval: "warn",
  blocked: "danger",
  failed: "danger",
};

function VerdictBadgeRenderer(props: ICellRendererParams<AuditRow, string>) {
  const verdict = props.value ?? "";
  const tone = VERDICT_TONE[verdict] ?? "neutral";
  const toneClass =
    tone === "ok"
      ? "text-ok border-ok/30 bg-ok/10"
      : tone === "warn"
        ? "text-warn border-warn/30 bg-warn/10"
        : tone === "danger"
          ? "text-danger border-danger/30 bg-danger/10"
          : "text-muted border-border bg-fg/5";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${toneClass}`}>
      {verdict}
    </span>
  );
}

export function AuditGrid({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [quickFilter, setQuickFilter] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api.audit(500);
      setRows(data.rows);
      setError(null);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);

  const columnDefs = useMemo<ColDef<AuditRow>[]>(
    () => [
      {
        field: "ts",
        headerName: "Time",
        width: 100,
        valueFormatter: (p) => new Date(String(p.value)).toLocaleTimeString(),
        sort: "desc",
        sortIndex: 0,
      },
      { field: "step", headerName: "Step", width: 90 },
      { field: "productId", headerName: "Product", flex: 1, minWidth: 90, tooltipField: "productId" },
      { field: "merchant", headerName: "Merchant", width: 120 },
      {
        field: "priceUsd",
        headerName: "Price",
        width: 95,
        type: "rightAligned",
        valueFormatter: (p) => (p.value === null ? "—" : `$${Number(p.value).toFixed(2)}`),
      },
      {
        field: "verdict",
        headerName: "Verdict",
        width: 140,
        cellRenderer: VerdictBadgeRenderer,
      },
      {
        field: "demo",
        headerName: "",
        width: 74,
        sortable: false,
        filter: false,
        cellRenderer: (props: ICellRendererParams<AuditRow, boolean>) =>
          props.value === true
            ? '<span class="inline-flex items-center rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">DEMO</span>'
            : "",
      },
      { field: "paypalStatus", headerName: "PayPal", width: 130 },
      {
        field: "requestId",
        headerName: "Request",
        width: 110,
        valueFormatter: (p) => String(p.value ?? "").slice(0, 8),
        tooltipField: "requestId",
      },
    ],
    [],
  );

  const gridTheme = useMemo(
    () =>
      themeQuartz.withParams({
        accentColor: "var(--accent)",
        borderColor: "var(--border)",
        backgroundColor: "var(--card)",
        foregroundColor: "var(--fg)",
        headerBackgroundColor: "var(--card)",
        oddRowBackgroundColor: "color-mix(in oklab, var(--fg) 3%, transparent)",
        rowHoverColor: "color-mix(in oklab, var(--accent) 8%, transparent)",
        fontFamily: "inherit",
        fontSize: 12.5,
        headerFontSize: 11.5,
        wrapperBorder: false,
        rowBorder: true,
        cellHorizontalPadding: 10,
      }),
    [],
  );

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Decision audit log{" "}
          <span className="ml-1 rounded-full border border-border px-2 py-0.5 text-xs font-normal text-muted">
            {rows.length}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <Input
            className="w-44"
            placeholder="Filter…"
            value={quickFilter}
            onChange={(event) => setQuickFilter(event.target.value)}
          />
          <Button variant="outline" onClick={() => void load()}>
            ↻
          </Button>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        {error !== null && (
          <div className="p-4">
            <ErrorBanner message={error} onRetry={() => void load()} />
          </div>
        )}
        <div className="h-[380px] w-full">
          <AgGridReact<AuditRow>
            theme={gridTheme}
            columnDefs={columnDefs}
            rowData={rows}
            quickFilterText={quickFilter}
            defaultColDef={{ sortable: true, filter: true, resizable: true, suppressHeaderMenuButton: true }}
            tooltipShowDelay={200}
            loading={loading}
            overlayNoRowsTemplate={
              '<span style="color:var(--muted);font-size:13px">No decisions yet — run your first request above and watch the gate work.</span>'
            }
            pagination
            paginationPageSize={50}
            paginationPageSizeSelector={false}
          />
        </div>
      </CardBody>
    </Card>
  );
}
