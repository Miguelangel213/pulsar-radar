import type { Filters, RadarResponse, SortKey, StageKey } from "./types";

/** Modo estático (GitHub Pages): sin backend; el motor corre en el navegador y llama directo a DexScreener. */
export const STATIC = process.env.NEXT_PUBLIC_STATIC === "1";

export async function fetchRadar(stage: StageKey, f: Filters, sort: SortKey, order: "asc" | "desc" | undefined, signal: AbortSignal): Promise<RadarResponse> {
  if (STATIC) return (await import("./engine")).radarQuery(stage, f, sort, order);
  const p = new URLSearchParams({ stage, sort });
  if (order) p.set("order", order);
  if (f.riskLevel) p.set("risk_level", f.riskLevel);
  if (f.maxAge) p.set("max_age", f.maxAge);
  if (f.minLiquidity) p.set("min_liquidity", f.minLiquidity);
  if (f.includeRejected) p.set("include_rejected", "true");
  const r = await fetch(`/api/radar?${p}`, { signal, cache: "no-store" });
  if (!r.ok) {
    let detail = "";
    try { detail = (await r.json()).detail ?? ""; } catch { /* sin cuerpo JSON: el proxy no alcanzó el backend */ }
    throw new Error(detail || (r.status >= 500 ? "No se pudo conectar con el backend (puerto 8000)" : `Error ${r.status}`));
  }
  return r.json();
}

export async function fetchAlerts(after: number | null, signal: AbortSignal): Promise<import("./types").AlertsResponse> {
  if (STATIC) return (await import("./engine")).alertsEvents(after);
  const r = await fetch(`/api/alerts${after === null ? "" : `?after=${after}`}`, { signal, cache: "no-store" });
  if (!r.ok) throw new Error(`Error ${r.status}`);
  return r.json();
}
