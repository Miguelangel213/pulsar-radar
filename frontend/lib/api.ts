import type { Filters, RadarResponse, SortKey, StageKey } from "./types";

export async function fetchRadar(stage: StageKey, f: Filters, sort: SortKey, order: "asc" | "desc" | undefined, signal: AbortSignal): Promise<RadarResponse> {
  const p = new URLSearchParams({ stage, sort });
  if (order) p.set("order", order);
  if (f.riskLevel) p.set("risk_level", f.riskLevel);
  if (f.maxAge) p.set("max_age", f.maxAge);
  if (f.minLiquidity) p.set("min_liquidity", f.minLiquidity);
  if (f.includeRejected) p.set("include_rejected", "true");
  const r = await fetch(`/api/radar?${p}`, { signal, cache: "no-store" });
  if (!r.ok) throw new Error(r.status === 500 || r.status === 502 || r.status === 504 ? "No se pudo conectar con el backend (puerto 8000)" : `Error ${r.status}`);
  return r.json();
}

export async function fetchAlerts(after: number | null, signal: AbortSignal): Promise<import("./types").AlertsResponse> {
  const r = await fetch(`/api/alerts${after === null ? "" : `?after=${after}`}`, { signal, cache: "no-store" });
  if (!r.ok) throw new Error(`Error ${r.status}`);
  return r.json();
}
