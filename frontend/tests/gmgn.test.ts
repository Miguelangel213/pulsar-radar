import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import CONFIG from "../lib/engine/config.generated.json";
import { AlertService } from "../lib/engine/alerts";
import { buildEntry } from "../lib/engine/gates";
import { GmgnAuthError, GmgnClient, GmgnError, GmgnPausedError, type GmgnKeyStore } from "../lib/engine/gmgn-client";
import { classifyGmgn, normalizeGmgn, type GmgnRecord } from "../lib/engine/gmgn-normalize";
import { GmgnScanner } from "../lib/engine/gmgn-scanner";
import { scoreEntry } from "../lib/engine/scoring";
import { RadarService } from "../lib/engine/service";
import { SourceManager } from "../lib/engine/sources";
import { TokenScanner } from "../lib/engine/scanner";
import type { Cfg, Pair } from "../lib/engine/types";
import { ReplayClient } from "./helpers";
import { pair } from "./pair-helper";

const cfg = CONFIG as Cfg;
const dir = new URL("./fixtures/gmgn/", import.meta.url);
const trenches = JSON.parse(readFileSync(new URL("trenches.sample.json", dir), "utf8"));
const rank = JSON.parse(readFileSync(new URL("rank.sample.json", dir), "utf8"));
const NEW: Pair[] = trenches.data.new_creation, NEAR: Pair[] = trenches.data.near_completion, DONE: Pair[] = trenches.data.completed;
const RANK: Pair[] = rank.data.data.rank;
const NOW = Math.max(...NEW.map((r) => r.created_timestamp)) + 90;   // segundos: ~1,5 min después del token más nuevo de la muestra
const SECRET = "gmgn_TEST_KEY_0123456789abcdef0123456789";

const memKeys = (initial: string | null = SECRET): GmgnKeyStore & { v: string | null } => ({ v: initial, get() { return this.v; }, set(k) { this.v = k; } });
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers });

interface Call { url: string; init: RequestInit }
function setup(handler?: (c: Call) => Response) {
  const calls: Call[] = [], t = { ms: NOW * 1000 }, keys = memKeys();
  const fetchFn = (async (url: string, init: RequestInit) => {
    const c = { url: String(url), init }; calls.push(c);
    if (handler) return handler(c);
    return json(c.url.includes("/v1/trenches") ? trenches : rank);
  }) as unknown as typeof fetch;
  let n = 0;
  const client = new GmgnClient(cfg, keys, fetchFn, () => t.ms, () => `u${++n}`);
  return { client, calls, t, keys };
}

const rec = (row: Pair, extra: Partial<GmgnRecord> = {}): GmgnRecord => ({ row, categories: ["new_creation"], ...extra });
const base = (over: Pair = {}): Pair => ({ ...NEW[0], ...over });

describe("cliente de GMGN (navegador)", () => {
  it("envía la key SOLO en la cabecera y pide timestamp y client_id; trenches es POST con las 3 categorías", async () => {
    const { client, calls } = setup();
    const d = (await client.trenches()) as Record<string, Pair[]>;
    expect(Object.keys(d).sort()).toEqual(["completed", "near_completion", "new_creation"]);
    const c = calls[0];
    expect(c.url).toMatch(/^https:\/\/openapi\.gmgn\.ai\/v1\/trenches\?/);
    expect(c.url).not.toContain(SECRET);
    expect(c.url).toContain("chain=sol"); expect(c.url).toContain("client_id=u1"); expect(c.url).toContain(`timestamp=${NOW}`);
    expect((c.init.headers as Record<string, string>)["X-APIKEY"]).toBe(SECRET);
    expect(c.init.method).toBe("POST");
    expect(JSON.parse(c.init.body as string)).toMatchObject({ version: "v2", new_creation: { limit: 80 }, near_completion: {}, completed: {} });
  });

  it("rank es GET, pide el intervalo configurado y desanida data.data.rank", async () => {
    const { client, calls } = setup();
    const rows = await client.rank();
    expect(rows.length).toBe(RANK.length);
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].url).toContain("/v1/market/rank?"); expect(calls[0].url).toContain("interval=1h"); expect(calls[0].url).toContain("order_by=volume");
  });

  it("sin key no llama a GMGN y lo dice", async () => {
    const { client, calls, keys } = setup(); keys.v = null;
    await expect(client.trenches()).rejects.toBeInstanceOf(GmgnAuthError);
    expect(calls.length).toBe(0);
  });

  it("401/403 = key inválida", async () => {
    const { client } = setup(() => json({}, 401));
    await expect(client.rank()).rejects.toBeInstanceOf(GmgnAuthError);
    const b = setup(() => json({}, 403));
    await expect(b.client.rank()).rejects.toBeInstanceOf(GmgnAuthError);
  });

  it("la caché de 15 s y la agrupación evitan llamadas repetidas", async () => {
    const { client, calls, t } = setup();
    await Promise.all([client.trenches(), client.trenches(), client.trenches()]);
    expect(calls.length).toBe(1);
    t.ms += 14_000; await client.trenches();
    expect(calls.length).toBe(1);
    t.ms += 2_000; await client.trenches();
    expect(calls.length).toBe(2);
  });

  it("tras un 429/ban espera lo que GMGN indica (acotado) y NO insiste", async () => {
    const reset = NOW + 200;
    const { client, calls, t } = setup(() => json({ code: 429, error: "RATE_LIMIT_BANNED", reset_at: reset }, 429));
    await expect(client.trenches()).rejects.toMatchObject({ untilEpochS: reset });
    expect(calls.length).toBe(1);
    for (let i = 0; i < 10; i++) await expect(client.rank()).rejects.toBeInstanceOf(GmgnPausedError);
    expect(calls.length).toBe(1);                                              // ni una llamada más durante la pausa
    t.ms += 201_000;
    await expect(client.trenches()).rejects.toBeInstanceOf(GmgnPausedError);   // terminó la pausa: vuelve a intentar (y GMGN vuelve a decir 429)
    expect(calls.length).toBe(2);
  });

  it("la pausa se acota entre el mínimo y el máximo configurados", async () => {
    const soon = setup(() => json({ reset_at: NOW + 1 }, 429));
    await expect(soon.client.trenches()).rejects.toBeInstanceOf(GmgnPausedError);
    expect(soon.client.pausedUntilMs).toBe(NOW * 1000 + cfg.gmgn.min_pause_s * 1000);
    const far = setup(() => json({ reset_at: NOW + 999_999 }, 429));
    await expect(far.client.trenches()).rejects.toBeInstanceOf(GmgnPausedError);
    expect(far.client.pausedUntilMs).toBe(NOW * 1000 + cfg.gmgn.max_pause_s * 1000);
  });

  it("durante la pausa sirve el último dato bueno, y reset() olvida todo (cambio de key)", async () => {
    let limited = false;
    const { client, calls, t } = setup(() => (limited ? json({ reset_at: NOW + 300 }, 429) : json(trenches)));
    await client.trenches();
    t.ms += 20_000; limited = true;
    await expect(client.trenches()).resolves.toBeTruthy();                       // 429 pero hay dato previo: se sirve
    t.ms += 1_000; await expect(client.trenches()).resolves.toBeTruthy();
    expect(calls.length).toBe(2);
    client.reset();
    expect(client.pausedUntilMs).toBe(0);
  });

  it("fallos de red o 5xx = error puntual; respuestas con code != 0 se rechazan", async () => {
    const net = new GmgnClient(cfg, memKeys(), (async () => { throw new TypeError("x"); }) as unknown as typeof fetch);
    await expect(net.rank()).rejects.toBeInstanceOf(GmgnError);
    await expect(setup(() => json({}, 503)).client.rank()).rejects.toBeInstanceOf(GmgnError);
    await expect(setup(() => json({ code: 1, message: "no" })).client.rank()).rejects.toBeInstanceOf(GmgnError);
  });
});

describe("conversión de campos de GMGN (verificada con una respuesta real)", () => {
  it("normaliza TODAS las filas reales sin errores y con los campos básicos", () => {
    const all: [Pair, boolean][] = [...NEW, ...NEAR, ...DONE].map((r) => [r, false] as [Pair, boolean]).concat(RANK.map((r) => [r, true] as [Pair, boolean]));
    for (const [row, isRank] of all) {
      const t = normalizeGmgn(isRank ? { row, rank: row, categories: [] } : rec(row), NOW * 1000, cfg);
      expect(t.address).toBe(row.address);
      expect(t.symbol.length).toBeGreaterThan(0);
      expect(t.age_min === null || t.age_min >= 0).toBe(true);
      expect(t.links.gmgn).toBe(`https://gmgn.ai/sol/token/${row.address}`);
      expect(t.gmgn).toBeTruthy();
    }
  });

  it("trenches: la liquidez NO se usa (no viene en dólares) y el market cap sí", () => {
    const t = normalizeGmgn(rec(NEW[0]), NOW * 1000, cfg);
    expect(t.liquidity_usd).toBeNull();
    expect(t.market_cap).toBe(NEW[0].market_cap);
    expect(t.price_usd).toBe(NEW[0].price);
  });

  it("ranking: la liquidez sí viene en dólares y trae ventana de 1 h y cambios de precio", () => {
    const r = RANK[0], t = normalizeGmgn({ row: r, rank: r, categories: [] }, NOW * 1000, cfg);
    expect(t.liquidity_usd).toBe(r.liquidity);
    expect(t.volume.h1).toBe(r.volume); expect(t.buys.h1).toBe(r.buys); expect(t.sells.h1).toBe(r.sells);
    expect(t.price_change.h1).toBe(r.price_change_percent1h); expect(t.price_change.m5).toBe(r.price_change_percent5m);
    expect(t.stages).toEqual([]);                                              // las etapas las decide classifyGmgn
  });

  it("token de menos de 1 h: sus cifras de 24 h valen también como 1 h; con más edad, la ventana 1 h queda sin dato (no se inventa)", () => {
    const young = normalizeGmgn(rec(base({ created_timestamp: NOW - 600, volume_24h: 500, buys_24h: 7, sells_24h: 3 })), NOW * 1000, cfg);
    expect(young.volume.h1).toBe(500); expect(young.buys.h1).toBe(7); expect(young.sells.h1).toBe(3);
    const old = normalizeGmgn(rec(base({ created_timestamp: NOW - 7200, volume_24h: 500, buys_24h: 7, sells_24h: 3 })), NOW * 1000, cfg);
    expect(old.volume.h1).toBeNull(); expect(old.buys.h1).toBeNull(); expect(old.volume.h24).toBe(500);
    expect(old.volume.m5).toBeNull(); expect(old.price_change.h1).toBeNull();
  });

  it("banderas y valores raros de GMGN: '1'/1/true, 'unknown', '' y números como texto", () => {
    const d = (over: Pair) => normalizeGmgn(rec(base(over)), NOW * 1000, cfg).gmgn!;
    expect(d({ renounced_mint: "1" }).renounced_mint).toBe(true);
    expect(d({ renounced_mint: 0 }).renounced_mint).toBe(false);
    expect(d({ renounced_mint: "" }).renounced_mint).toBeNull();
    expect(d({ is_honeypot: "unknown" }).honeypot).toBeNull();
    expect(d({ is_honeypot: 1 }).honeypot).toBe(true);
    expect(d({ buy_tax: "" }).buy_tax).toBeNull();
    expect(d({ buy_tax: "0.03" }).buy_tax).toBe(0.03);
    expect(d({ bundler_trader_amount_rate: 0.2 }).bundler_rate).toBe(0.2);
    expect(d({ complete_timestamp: 0 }).complete_timestamp).toBeNull();
  });

  it("redes sociales: usuario -> URL, URL se respeta, vacío se omite", () => {
    const s = (over: Pair) => normalizeGmgn(rec(base({ twitter: "", telegram: "", website: "", ...over })), NOW * 1000, cfg);
    expect(s({ twitter: "@abc" }).socials).toEqual([{ type: "twitter", url: "https://x.com/abc" }]);
    expect(s({ twitter: "https://x.com/zzz", telegram: "https://t.me/q" }).socials.map((x) => x.url)).toEqual(["https://x.com/zzz", "https://t.me/q"]);
    expect(s({}).socials).toEqual([]); expect(s({}).website).toBeNull();
    expect(s({ website: " https://a.io " }).website).toBe("https://a.io");
  });

  it("etapas: categorías de GMGN; graduados cuentan desde que se graduaron; tendencias = viene del ranking", () => {
    const stage = (r: GmgnRecord) => classifyGmgn(normalizeGmgn(r, NOW * 1000, cfg), r, NOW * 1000, cfg);
    expect(stage(rec(base({ created_timestamp: NOW - 120 })))).toEqual(["new_creation"]);
    expect(stage(rec(base({ created_timestamp: NOW - 200 * 60 })))).toEqual([]);                       // demasiado viejo para "recién creado"
    expect(stage(rec(base(), { categories: ["near_completion"] }))).toEqual(["near_graduation"]);
    const grad = (done: number) => rec(base({ created_timestamp: NOW - 100_000, complete_timestamp: done }), { categories: ["completed"] });
    expect(stage(grad(NOW - 600))).toEqual(["graduated"]);                                              // nació hace días, se graduó hace 10 min
    expect(stage(grad(NOW - 3 * 86400))).toEqual([]);
    expect(stage({ row: RANK[0], rank: RANK[0], categories: ["new_creation"] })).toContain("trending");
  });
});

describe("escáner de GMGN con datos reales", () => {
  it("une trenches y ranking, asigna etapas y puntúa todo", async () => {
    const { client } = setup();
    const sc = new GmgnScanner(client, cfg, () => NOW);
    const es = await sc.scan(true);
    const count = (st: string) => es.filter((e) => (e.entry.token.stages as string[]).includes(st)).length;
    expect(es.length).toBe(new Set([...NEW, ...NEAR, ...DONE, ...RANK].map((r) => r.address)).size);
    expect(count("new_creation")).toBeGreaterThan(10); expect(count("near_graduation")).toBe(NEAR.length); expect(count("graduated")).toBeGreaterThan(5); expect(count("trending")).toBe(RANK.length);
    for (const e of es) {
      expect(Number.isFinite(e.potential.score) && Number.isFinite(e.risk.score) && Number.isFinite(e.adjusted)).toBe(true);
      expect(e.potential.score).toBeGreaterThanOrEqual(0); expect(e.risk.score).toBeLessThanOrEqual(100);
      expect(e.entry.token.gmgn).toBeTruthy();
    }
    expect(es.filter((e) => e.entry.verdict === "rejected").length).toBeGreaterThan(0);       // hay rug_ratio ~1 en la muestra real
    expect(es.filter((e) => e.entry.verdict === "clean").length).toBeGreaterThan(0);
  });

  it("un token que sale en trenches y en ranking se fusiona en uno solo con ambas etapas", async () => {
    const shared: Pair = { ...NEAR[0] }, r: Pair = { ...RANK[0], address: shared.address };
    const { client } = setup((c) => json(c.url.includes("/v1/trenches") ? { code: 0, data: { new_creation: [], near_completion: [shared], completed: [] } } : { code: 0, data: { code: 0, data: { rank: [r] } } }));
    const es = await new GmgnScanner(client, cfg, () => NOW).scan(true);
    expect(es.length).toBe(1);
    expect(es[0].entry.token.stages).toEqual(["near_graduation", "trending"]);
    expect(es[0].entry.token.liquidity_usd).toBe(r.liquidity);                                // al estar en el ranking, la liquidez es fiable
  });

  it("si el ranking falla, los trenches siguen funcionando; si GMGN pide esperar, el error sube", async () => {
    const { client } = setup((c) => (c.url.includes("/v1/trenches") ? json(trenches) : json({}, 503)));
    const sc = new GmgnScanner(client, cfg, () => NOW);
    const es = await sc.scan(true);
    expect(es.length).toBeGreaterThan(0); expect(sc.lastError).toBe("ranking no disponible");
    const limited = setup(() => json({ reset_at: NOW + 100 }, 429));
    await expect(new GmgnScanner(limited.client, cfg, () => NOW).scan(true)).rejects.toBeInstanceOf(GmgnPausedError);
  });
});

describe("hard gates y puntaje con datos de GMGN", () => {
  const entry = (over: Pair, cats: string[] = ["new_creation"]) => {
    const r = rec(base({ created_timestamp: NOW - 120, ...over }), { categories: cats });
    const t = normalizeGmgn(r, NOW * 1000, cfg); t.stages = classifyGmgn(t, r, NOW * 1000, cfg) as typeof t.stages;
    return scoreEntry(buildEntry(t, cfg), cfg);
  };
  const gate = (s: ReturnType<typeof entry>, name: string) => s.entry.gates.find((g) => g.name === name)!;
  const CLEAN = { rug_ratio: 0.02, bundler_trader_amount_rate: 0.01, top_10_holder_rate: 0.05, creator_balance_rate: 0, suspected_insider_hold_rate: 0, bot_degen_rate: 0.02, renounced_mint: "1", renounced_freeze_account: "1", buy_tax: 0, sell_tax: 0, is_wash_trading: false, creator_created_count: 3, creator_created_open_ratio: 0.5 };

  it("un token limpio pasa todos los gates de GMGN", () => {
    const s = entry(CLEAN);
    expect(s.entry.gates.filter((g) => g.status === "fail")).toEqual([]);
    expect(s.entry.gates.map((g) => g.name)).toEqual(expect.arrayContaining(["honeypot", "tax", "mint_authority", "freeze_authority", "wash_trading", "rug_ratio", "bundlers", "top10", "snipers", "insiders", "dev_holding", "serial_deployer"]));
  });

  it("descartes (reject): honeypot, impuestos altos, wash trading, rug ratio extremo", () => {
    for (const [over, name] of [[{ is_honeypot: 1 }, "honeypot"], [{ buy_tax: 0.2 }, "tax"], [{ sell_tax: 0.5 }, "tax"], [{ is_wash_trading: true }, "wash_trading"], [{ rug_ratio: 0.9 }, "rug_ratio"]] as [Pair, string][]) {
      const s = entry({ ...CLEAN, ...over });
      expect(gate(s, name).status, name).toBe("fail"); expect(gate(s, name).severity).toBe("reject");
      expect(s.entry.verdict).toBe("rejected"); expect(s.adjusted).toBe(0); expect(s.quadrant).toBe(false);
    }
  });

  it("marcas rojas (no descartan): rug ratio medio, mint/freeze sin renunciar, bundlers, top 10, snipers, insiders, dev, lanzador en serie", () => {
    for (const [over, name] of [[{ rug_ratio: 0.5 }, "rug_ratio"], [{ renounced_mint: "0" }, "mint_authority"], [{ renounced_freeze_account: 0 }, "freeze_authority"],
      [{ bundler_trader_amount_rate: 0.5 }, "bundlers"], [{ top_10_holder_rate: 0.5 }, "top10"], [{ sniper_count: 11 }, "snipers"], [{ suspected_insider_hold_rate: 0.2 }, "insiders"],
      [{ creator_balance_rate: 0.2 }, "dev_holding"], [{ creator_created_count: 50, creator_created_open_ratio: 0.02 }, "serial_deployer"]] as [Pair, string][]) {
      const s = entry({ ...CLEAN, ...over });
      expect(gate(s, name).status, name).toBe("fail"); expect(gate(s, name).severity, name).toBe("red_flag");
      expect(s.entry.verdict).toBe("red_flags"); expect(s.adjusted).toBeGreaterThan(0);
    }
  });

  it("dato ausente = 'sin dato', nunca falla", () => {
    const s = entry({ ...CLEAN, rug_ratio: null, top_10_holder_rate: null, buy_tax: "", sell_tax: "", creator_created_open_ratio: null });
    for (const n of ["rug_ratio", "top10", "tax", "serial_deployer", "snipers", "honeypot"]) expect(gate(s, n).status, n).toBe("unknown");
    expect(s.entry.verdict).toBe("clean");
  });

  it("el riesgo con GMGN suma seguridad, holders y dev, y 'contract' ya no es 'sin dato'", () => {
    const s = entry(CLEAN);
    expect(Object.keys(s.risk.subscores)).toEqual(["liquidity", "age", "sell_pressure", "drop", "contract", "holders", "dev"]);
    expect(s.risk.unavailable).not.toContain("contract");
    const bad = entry({ ...CLEAN, rug_ratio: 0.45, renounced_mint: "0", bundler_trader_amount_rate: 0.45, top_10_holder_rate: 0.5, creator_balance_rate: 0.25 });
    expect(bad.risk.subscores.contract).toBeGreaterThan(s.risk.subscores.contract + 30);
    expect(bad.risk.subscores.holders).toBeGreaterThan(s.risk.subscores.holders + 40);
    expect(bad.risk.subscores.dev).toBeGreaterThan(s.risk.subscores.dev);
    expect(bad.risk.score).toBeGreaterThan(s.risk.score + 8);
    expect(bad.risk.reasons.length).toBeGreaterThan(0);
  });

  it("el smart money y los KOLs suben el potencial", () => {
    const none = entry({ ...CLEAN, smart_degen_count: 0, renowned_count: 0 }), many = entry({ ...CLEAN, smart_degen_count: 10, renowned_count: 3 });
    expect(Object.keys(many.potential.subscores)).toContain("smart_money");
    expect(many.potential.subscores.smart_money).toBe(100); expect(none.potential.subscores.smart_money).toBe(0);
    expect(many.potential.score).toBeGreaterThan(none.potential.score + 15);
    expect(many.risk.score).toBe(none.risk.score);                                            // potencial y riesgo siguen separados
  });

  it("el cuadrante usa los umbrales propios de GMGN", () => {
    const q = cfg.scoring.ranking.quadrant_gmgn;
    const s = entry({ ...CLEAN, smart_degen_count: 10, renowned_count: 3, volume_24h: 20000, buys_24h: 300, sells_24h: 100, market_cap: 8000 });
    expect(s.potential.score >= q.min_potential && s.risk.score <= q.max_risk).toBe(s.quadrant);
    expect(s.quadrant).toBe(true);
  });
});

describe("selección de fuente: GMGN con key, DexScreener si no", () => {
  function manager(handler?: (c: Call) => Response, key: string | null = SECRET) {
    const s = setup(handler); s.keys.v = key;
    const dex = new TokenScanner(new ReplayClient({ boosts_latest: [{ chainId: "solana", tokenAddress: "DEXTOKEN" }] }, [pair("DEXTOKEN")]), cfg, () => NOW);
    const gmgn = new GmgnScanner(s.client, cfg, () => NOW);
    return { ...s, dex, gmgn, mgr: new SourceManager(dex, gmgn, s.keys, s.client, cfg) };
  }

  it("sin key usa DexScreener y no toca GMGN", async () => {
    const m = manager(undefined, null);
    const es = await m.mgr.scan(true);
    expect(m.mgr.active).toBe("dexscreener"); expect(es.map((e) => e.entry.token.address)).toEqual(["DEXTOKEN"]);
    expect(m.calls.length).toBe(0); expect(m.mgr.gmgnStatus()).toMatchObject({ enabled: false, active: false, error: null });
  });

  it("con key válida usa GMGN", async () => {
    const m = manager();
    const es = await m.mgr.scan(true);
    expect(m.mgr.active).toBe("gmgn"); expect(es.length).toBeGreaterThan(50);
    expect(m.mgr.gmgnStatus()).toMatchObject({ enabled: true, active: true, paused_until: null, error: null });
  });

  it("key inválida: cae a DexScreener y avisa", async () => {
    const m = manager(() => json({}, 401));
    const es = await m.mgr.scan(true);
    expect(m.mgr.active).toBe("dexscreener"); expect(es[0].entry.token.address).toBe("DEXTOKEN");
    expect(m.mgr.gmgnStatus()).toMatchObject({ enabled: true, active: false, error: "invalid_key" });
  });

  it("límite/ban de GMGN: cae a DexScreener, no insiste y vuelve a GMGN cuando termina", async () => {
    let banned = true;
    const m = manager(() => (banned ? json({ reset_at: NOW + 120 }, 429) : json(c_ok())));
    function c_ok() { return trenches; }
    await m.mgr.scan(true);
    expect(m.mgr.active).toBe("dexscreener");
    const st = m.mgr.gmgnStatus();
    expect(st.error).toBe("rate_limited");
    const callsBefore = m.calls.length;
    for (let i = 0; i < 5; i++) await m.mgr.scan(true);
    expect(m.calls.length).toBe(callsBefore);                                                 // durante la pausa no se llama a GMGN
    banned = false; m.t.ms += 200_000;
    await m.mgr.scan(true);
    expect(m.mgr.active).toBe("gmgn"); expect(m.mgr.gmgnStatus().error).toBeNull();
  });

  it("poner o quitar la key cambia de fuente y limpia el estado", async () => {
    const m = manager(undefined, null);
    await m.mgr.scan(true); expect(m.mgr.active).toBe("dexscreener");
    m.mgr.setKey("  " + SECRET + "  ");
    expect(m.keys.v).toBe(SECRET);                                                            // se guarda sin espacios
    await m.mgr.scan(true); expect(m.mgr.active).toBe("gmgn");
    m.mgr.setKey(null);
    expect(m.keys.v).toBeNull(); expect(m.mgr.active).toBe("dexscreener");
    expect(m.mgr.gmgnStatus().enabled).toBe(false);
  });
});

describe("alerta de smart money (solo con GMGN)", () => {
  it("avisa una sola vez cuando entra smart money a un token de menos de X minutos; la primera pasada es solo línea base", async () => {
    const t = { ms: NOW * 1000 }, keys = memKeys();
    let rows: Pair[] = [base({ address: "OLD1", smart_degen_count: 0 })];
    const fetchFn = (async (u: string) => json(String(u).includes("/v1/trenches") ? { code: 0, data: { new_creation: rows, near_completion: [], completed: [] } } : { code: 0, data: { code: 0, data: { rank: [] } } })) as unknown as typeof fetch;
    const client = new GmgnClient(cfg, keys, fetchFn, () => t.ms, () => "u");
    const gmgn = new GmgnScanner(client, cfg, () => t.ms / 1000);
    const mgr = new SourceManager(new TokenScanner(new ReplayClient({}, []), cfg, () => t.ms / 1000), gmgn, keys, client, cfg);
    const alerts = new AlertService(new RadarService(mgr, cfg), () => 100);
    const fresh = (over: Pair) => base({ created_timestamp: Math.floor(t.ms / 1000) - 60, ...over });

    expect((await alerts.events(null)).events).toEqual([]);                                  // línea base
    rows = [rows[0], fresh({ address: "SM1", symbol: "SMT", smart_degen_count: 3 }), fresh({ address: "OLDSM", smart_degen_count: 5, created_timestamp: Math.floor(t.ms / 1000) - 3000 })];
    t.ms += 30_000;
    const r1 = await alerts.events(0);
    const sm = r1.events.filter((e) => e.type === "smart_money");
    expect(sm.map((e) => e.address)).toEqual(["SM1"]);                                       // el token de 50 min queda fuera (X = 10)
    expect(sm[0].message).toContain("Smart money entró a SMT"); expect(sm[0].message).toContain("3 wallets");
    t.ms += 30_000;
    expect((await alerts.events(r1.last_id)).events.filter((e) => e.type === "smart_money")).toEqual([]);   // no se repite
  });
});
