// Motor del radar en el navegador (modo estático / GitHub Pages): misma lógica que el backend Python, sin servidor ni histórico.
import { AlertService } from "./alerts";
import { DexScreenerClient } from "./client";
import CONFIG from "./config.generated.json";
import { RadarService } from "./service";
import { TokenScanner } from "./scanner";
import type { AlertsResponse, Filters, RadarResponse, SortKey, StageKey } from "../types";
import type { Cfg } from "./types";

const COVERAGE =
  "Fuente: DexScreener (sin API key), consultada directamente desde tu navegador. No existe un feed oficial de todos los tokens nuevos: el radar descubre tokens por sus boosts " +
  "y perfiles publicados. No incluye seguridad del contrato, holders, dev ni smart money. Modo demo: no se guarda histórico.";

let engine: { scanner: TokenScanner; service: RadarService; alerts: AlertService } | null = null;
function get() {
  if (!engine) {
    const cfg = CONFIG as Cfg;
    const scanner = new TokenScanner(new DexScreenerClient(cfg), cfg);
    const service = new RadarService(scanner, cfg);
    engine = { scanner, service, alerts: new AlertService(service) };
  }
  return engine;
}

export async function radarQuery(stage: StageKey, f: Filters, sort: SortKey, order: "asc" | "desc" | undefined): Promise<RadarResponse> {
  const { service, scanner } = get();
  const toNum = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));
  const items = await service.query({ stage, riskLevel: f.riskLevel || null, maxAge: toNum(f.maxAge), minLiquidity: toNum(f.minLiquidity), sort, order: order ?? null, includeRejected: f.includeRejected });
  return {
    mode: "DEXSCREENER", stage, generated_at: Date.now() / 1000, count: items.length, disclaimer: service.cfg.scoring.disclaimer,
    meta: { quadrant: service.cfg.scoring.ranking.quadrant, coverage: COVERAGE, last_scan: scanner.lastScan, last_error: scanner.lastError },
    items: items as unknown as RadarResponse["items"],
  };
}

export const alertsEvents = (after: number | null): Promise<AlertsResponse> => get().alerts.events(after) as Promise<AlertsResponse>;
