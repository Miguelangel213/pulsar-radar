// Motor del radar en el navegador (modo estático / GitHub Pages): misma lógica que el backend Python, sin servidor.
// Fuente por defecto: DexScreener (sin key). Si el visitante pone su propia API key de GMGN, usa GMGN y cae a DexScreener si falla.
import { AlertService } from "./alerts";
import { DexScreenerClient } from "./client";
import CONFIG from "./config.generated.json";
import { GmgnClient, browserKeyStore } from "./gmgn-client";
import { GmgnScanner } from "./gmgn-scanner";
import { RadarService } from "./service";
import { TokenScanner } from "./scanner";
import { SourceManager } from "./sources";
import type { AlertsResponse, Filters, GmgnStatus, RadarResponse, SortKey, StageKey } from "../types";
import type { Cfg } from "./types";

const COVERAGE_DEX =
  "Fuente: DexScreener (sin API key), consultada directamente desde tu navegador. No existe un feed oficial de todos los tokens nuevos: el radar descubre tokens por sus boosts " +
  "y perfiles publicados. No incluye seguridad del contrato, holders, dev ni smart money. Modo demo: no se guarda histórico.";
const COVERAGE_GMGN =
  "Fuente: GMGN (con tu propia API key, consultada desde tu navegador): tokens desde sus primeros minutos, con señales de seguridad, holders, dev y smart money. Modo demo: no se guarda histórico.";

let engine: { sources: SourceManager; service: RadarService; alerts: AlertService } | null = null;
function get() {
  if (!engine) {
    const cfg = CONFIG as Cfg;
    const dex = new TokenScanner(new DexScreenerClient(cfg), cfg);
    const gmgnClient = new GmgnClient(cfg, browserKeyStore);
    const sources = new SourceManager(dex, new GmgnScanner(gmgnClient, cfg), browserKeyStore, gmgnClient, cfg);
    const service = new RadarService(sources, cfg);
    engine = { sources, service, alerts: new AlertService(service) };
  }
  return engine;
}

export async function radarQuery(stage: StageKey, f: Filters, sort: SortKey, order: "asc" | "desc" | undefined): Promise<RadarResponse> {
  const { service, sources } = get();
  const toNum = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));
  const items = await service.query({ stage, riskLevel: f.riskLevel || null, maxAge: toNum(f.maxAge), minLiquidity: toNum(f.minLiquidity), sort, order: order ?? null, includeRejected: f.includeRejected });
  const gmgn = sources.active === "gmgn";
  return {
    mode: gmgn ? "GMGN" : "DEXSCREENER", stage, generated_at: Date.now() / 1000, count: items.length, disclaimer: service.cfg.scoring.disclaimer,
    meta: { quadrant: gmgn ? service.cfg.scoring.ranking.quadrant_gmgn : service.cfg.scoring.ranking.quadrant, coverage: gmgn ? COVERAGE_GMGN : COVERAGE_DEX, last_scan: sources.lastScan, last_error: sources.lastError, gmgn: sources.gmgnStatus() },
    items: items as unknown as RadarResponse["items"],
  };
}

export const alertsEvents = (after: number | null): Promise<AlertsResponse> => get().alerts.events(after) as Promise<AlertsResponse>;

/** Guarda (o quita, con null) la API key de GMGN de este navegador. Se queda solo aquí y solo se envía a GMGN. */
export const setGmgnKey = (key: string | null): void => get().sources.setKey(key);
export const gmgnStatus = (): GmgnStatus => get().sources.gmgnStatus();
