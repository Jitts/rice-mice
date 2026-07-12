"use client";

import { useMemo, useState } from "react";
import { formatCents } from "@/lib/format";
import { InfoTip } from "@/components/InfoTip";
import { downloadText } from "@/lib/segmentExport";
import {
  buildReport,
  dayKey,
  presetRange,
  reportCsv,
  startOfDay,
  PRESETS,
  type PresetId,
  type ReportRange,
} from "@/lib/reports";
import type { Order } from "@/lib/orders";

// Parses the yyyy-mm-dd value of an <input type="date"> as a LOCAL day
// (new Date("2026-07-12") would parse as UTC midnight and shift the day in
// west-of-UTC timezones).
function parseDay(value: string): Date | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function StatCard({
  label,
  value,
  tip,
  accent,
}: {
  label: string;
  value: string;
  tip?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">
        {label}
        {tip && <InfoTip term={tip} align="left" />}
      </p>
      <p className={`text-2xl font-semibold tracking-tight ${accent ?? ""}`}>
        {value}
      </p>
    </div>
  );
}

export function ReportsManager({ initialOrders }: { initialOrders: Order[] }) {
  const [preset, setPreset] = useState<PresetId | "custom">("last7");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const range: ReportRange = useMemo(() => {
    if (preset !== "custom") return presetRange(preset);
    const from = parseDay(customFrom);
    const to = parseDay(customTo);
    if (from && to && from.getTime() <= to.getTime()) return { from, to };
    // Incomplete custom input falls back to the last 7 days.
    return presetRange("last7");
  }, [preset, customFrom, customTo]);

  const report = useMemo(
    () => buildReport(initialOrders, range),
    [initialOrders, range],
  );

  const maxDayRevenue = Math.max(1, ...report.byDay.map((d) => d.revenueCents));
  const todayKey = dayKey(startOfDay(new Date()));
  const rangeLabel = `${range.from.toLocaleDateString()} – ${range.to.toLocaleDateString()}`;

  function exportCsv() {
    downloadText(
      `rice-mice-orders-${dayKey(range.from)}-to-${dayKey(range.to)}.csv`,
      reportCsv(initialOrders, range),
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Completed orders in {rangeLabel}
            <InfoTip term="report_day" />
          </p>
        </div>
        <button
          onClick={exportCsv}
          className="text-sm border border-neutral-300 rounded-lg px-4 py-2 text-neutral-600 hover:border-neutral-500"
        >
          Export orders CSV
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPreset(p.id)}
            className={`text-sm rounded-full px-4 py-1.5 border ${
              preset === p.id
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setPreset("custom")}
          className={`text-sm rounded-full px-4 py-1.5 border ${
            preset === "custom"
              ? "border-neutral-900 bg-neutral-900 text-white"
              : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
          }`}
        >
          Custom
        </button>
        {preset === "custom" && (
          <span className="flex items-center gap-2 text-sm">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="border border-neutral-300 rounded px-2 py-1"
            />
            <span className="text-neutral-400">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="border border-neutral-300 rounded px-2 py-1"
            />
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Revenue"
          value={formatCents(report.revenueCents)}
          tip="revenue"
          accent="text-emerald-600"
        />
        <StatCard label="Completed orders" value={String(report.completedCount)} />
        <StatCard
          label="Avg order value"
          value={formatCents(report.avgOrderCents)}
          tip="avg_order_value"
        />
        <StatCard
          label="Discounts given"
          value={formatCents(report.discountCents)}
          tip="discounts_given"
          accent={report.discountCents > 0 ? "text-violet-600" : ""}
        />
      </div>

      {report.byDay.length > 1 && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold mb-3">Revenue by day</h2>
          <div className="overflow-x-auto">
            <div
              className="flex items-end gap-1"
              style={{ minWidth: `${report.byDay.length * 14}px`, height: "120px" }}
            >
              {report.byDay.map((d) => (
                <div
                  key={d.key}
                  title={`${d.key} — ${formatCents(d.revenueCents)} (${d.orders} order${d.orders === 1 ? "" : "s"})`}
                  className={`flex-1 rounded-t min-w-[10px] ${
                    d.key === todayKey ? "bg-neutral-900" : "bg-emerald-400"
                  } ${d.revenueCents === 0 ? "opacity-20" : ""}`}
                  style={{
                    height: `${Math.max(3, (d.revenueCents / maxDayRevenue) * 100)}%`,
                  }}
                />
              ))}
            </div>
            <div className="flex justify-between text-xs text-neutral-400 mt-2">
              <span>{report.byDay[0]?.key}</span>
              <span>{report.byDay[report.byDay.length - 1]?.key}</span>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
          <h2 className="text-sm font-semibold px-4 pt-4 pb-2">
            Top items
            <InfoTip term="gross_item_sales" align="left" />
          </h2>
          {report.byItem.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-neutral-400">
              No completed orders in this range.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-neutral-200 bg-neutral-50 text-neutral-500">
                  <th className="px-4 py-2 font-medium">Item</th>
                  <th className="px-4 py-2 font-medium text-right">Qty</th>
                  <th className="px-4 py-2 font-medium text-right">Gross sales</th>
                </tr>
              </thead>
              <tbody>
                {report.byItem.map((i) => (
                  <tr key={i.name} className="border-b border-neutral-100 last:border-0">
                    <td className="px-4 py-2">{i.name}</td>
                    <td className="px-4 py-2 text-right">{i.quantity}</td>
                    <td className="px-4 py-2 text-right">{formatCents(i.grossCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
            <h2 className="text-sm font-semibold px-4 pt-4 pb-2">Payment methods</h2>
            {report.byPayment.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-neutral-400">Nothing yet.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {report.byPayment.map((p) => (
                    <tr key={p.name} className="border-b border-neutral-100 last:border-0">
                      <td className="px-4 py-2 capitalize">{p.name}</td>
                      <td className="px-4 py-2 text-right text-neutral-500">
                        {p.orders} order{p.orders === 1 ? "" : "s"}
                      </td>
                      <td className="px-4 py-2 text-right">{formatCents(p.revenueCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
            <h2 className="text-sm font-semibold px-4 pt-4 pb-2">By staff</h2>
            {report.byStaff.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-neutral-400">Nothing yet.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {report.byStaff.map((s) => (
                    <tr key={s.name} className="border-b border-neutral-100 last:border-0">
                      <td className="px-4 py-2">{s.name}</td>
                      <td className="px-4 py-2 text-right text-neutral-500">
                        {s.orders} order{s.orders === 1 ? "" : "s"}
                      </td>
                      <td className="px-4 py-2 text-right">{formatCents(s.revenueCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {report.cancelledCount > 0 && (
        <p className="text-xs text-neutral-400">
          {report.cancelledCount} order{report.cancelledCount === 1 ? "" : "s"} in
          this range {report.cancelledCount === 1 ? "was" : "were"} cancelled and
          excluded from every number above.
        </p>
      )}
    </div>
  );
}
