import { buildLinks } from "./scanner";
import type { Cfg, Pair, Token } from "./types";
import type { GmgnData } from "../types";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** GMGN mezcla 1, "1", true y 0, "0", false; "unknown"/""/null = no informado. */
const flag = (v: unknown): boolean | null => (v === 1 || v === "1" || v === true ? true : v === 0 || v === "0" || v === false ? false : null);
const first = (...vals: unknown[]): number | null => { for (const v of vals) { const n = num(v); if (n !== null) return n; } return null; };

/** Un token de GMGN puede venir de los trenches, del ranking o de ambos; `rank` marca que la fila trae datos del ranking. */
export interface GmgnRecord { row: Pair; rank?: Pair; categories: string[] }

export const toGmgnData = (r: GmgnRecord): GmgnData => {
  const row = { ...r.row, ...(r.rank ?? {}) };
  const created = num(r.row.complete_timestamp ?? r.rank?.complete_timestamp);
  return {
    progress: num(row.progress), holders: num(row.holder_count), top10_rate: num(row.top_10_holder_rate), rug_ratio: num(row.rug_ratio),
    bundler_rate: first(row.bundler_trader_amount_rate, row.bundler_rate), sniper_count: num(row.sniper_count),
    insider_rate: num(row.suspected_insider_hold_rate), bot_rate: num(row.bot_degen_rate), fresh_wallet_rate: num(row.fresh_wallet_rate),
    smart_degen_count: num(row.smart_degen_count), renowned_count: num(row.renowned_count),
    honeypot: flag(row.is_honeypot), buy_tax: num(row.buy_tax), sell_tax: num(row.sell_tax),
    renounced_mint: flag(row.renounced_mint), renounced_freeze: flag(row.renounced_freeze_account), wash_trading: flag(row.is_wash_trading),
    dev_hold_rate: first(row.creator_balance_rate, row.dev_team_hold_rate), dev_created_count: num(row.creator_created_count),
    dev_open_ratio: num(row.creator_created_open_ratio), dev_status: row.creator_token_status ? String(row.creator_token_status) : null,
    creator: row.creator ? String(row.creator) : null, launchpad: row.launchpad_platform ? String(row.launchpad_platform) : null,
    complete_timestamp: created && created > 0 ? created : null,
  };
};

const social = (type: string, v: unknown, base: string): { type: string; url: string }[] => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return [];
  return [{ type, url: /^https?:\/\//i.test(s) ? s : `${base}${s.replace(/^@/, "")}` }];
};

/** Convierte un registro de GMGN (trenches y/o ranking) al modelo común del radar. Nombres de campo verificados con una respuesta real. */
export function normalizeGmgn(rec: GmgnRecord, nowMs: number, cfg: Cfg): Token {
  const t = rec.row, k = rec.rank, any = { ...t, ...(k ?? {}) };
  const address = String(any.address);
  const createdS = first(t.created_timestamp, k?.creation_timestamp, t.creation_timestamp, k?.open_timestamp);
  const ageMin = createdS && createdS > 0 ? Math.max(0, (nowMs / 1000 - createdS) / 60) : null;

  // Ventanas: el ranking trae 1 h; los trenches traen 24 h. Un token de menos de 1 h tiene toda su vida dentro de la ventana de 24 h,
  // así que para él esas cifras valen también como "1 h". Las ventanas que GMGN no informa quedan en null (no se inventan).
  const young = ageMin !== null && ageMin < 60;
  const v24 = num(t.volume_24h), b24 = num(t.buys_24h), s24 = num(t.sells_24h);
  const volume = { m5: null, h1: k ? num(k.volume) : young ? v24 : null, h6: null, h24: v24 };
  const buys = { m5: null, h1: k ? num(k.buys) : young ? b24 : null, h6: null, h24: b24 };
  const sells = { m5: null, h1: k ? num(k.sells) : young ? s24 : null, h6: null, h24: s24 };

  const pool = any.pool_address ? String(any.pool_address) : "";
  const exchange = any.exchange ? String(any.exchange) : any.launchpad_platform ? String(any.launchpad_platform) : "";
  const links = buildLinks(cfg.links, address, pool || address);
  const web = typeof any.website === "string" && any.website.trim() ? any.website.trim() : null;

  return {
    address, symbol: String(any.symbol ?? "?").trim() || "?", name: String(any.name ?? "?"), pair_address: pool, dex_id: exchange,
    url: links.gmgn ?? "", image_url: any.logo ?? null, price_usd: num(any.price), market_cap: num(any.market_cap) || null, fdv: null,
    liquidity_usd: k ? num(k.liquidity) : null,        // en los trenches `liquidity` no viene en dólares (valores sin sentido): solo se confía en el ranking
    volume, buys, sells,
    price_change: { m5: k ? num(k.price_change_percent5m) : null, h1: k ? num(k.price_change_percent1h) : null, h6: null, h24: null },
    pair_created_at: createdS && createdS > 0 ? Math.round(createdS * 1000) : null, age_min: ageMin,
    website: web, socials: [...social("twitter", any.twitter_username ?? any.twitter, "https://x.com/"), ...social("telegram", any.telegram, "https://t.me/")],
    boosts_active: 0, sources: [...rec.categories, ...(k ? ["trending"] : [])], stages: [], first_seen: null,
    links: links as Token["links"], gmgn: toGmgnData(rec),
  };
}

/** Etapas del radar a partir de las categorías de GMGN. */
export function classifyGmgn(t: Token, rec: GmgnRecord, nowMs: number, cfg: Cfg): string[] {
  const s = cfg.stages, out: string[] = [];
  if (rec.categories.includes("new_creation") && t.age_min !== null && t.age_min <= s.new_creation.max_age_min) out.push("new_creation");
  if (rec.categories.includes("near_completion")) out.push("near_graduation");
  if (rec.categories.includes("completed")) {
    const done = t.gmgn?.complete_timestamp;                    // para "recién graduados" cuenta cuándo se graduó, no cuándo se creó
    const since = done ? (nowMs / 1000 - done) / 60 : t.age_min;
    if (since !== null && since <= s.graduated.max_age_min) out.push("graduated");
  }
  if (rec.rank) out.push("trending");
  return out;
}
