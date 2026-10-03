import { describe, expect, it } from "vitest";
import CONFIG from "../lib/engine/config.generated.json";
import { DexScreenerClient, DexScreenerError, RateLimiter } from "../lib/engine/client";
import type { Cfg } from "../lib/engine/types";

const cfg = CONFIG as Cfg;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function make(handler: (url: string) => Response, clock = { t: 1_000_000 }) {
  const seen: string[] = [], waits: number[] = [];
  const fetchFn = (async (u: string) => { seen.push(u); return handler(u); }) as unknown as typeof fetch;
  const c = new DexScreenerClient(cfg, fetchFn, () => clock.t, async (ms) => { waits.push(ms); });
  return { c, seen, waits, clock };
}

describe("cliente DexScreener del navegador", () => {
  it("usa los endpoints de DexScreener, sin cabeceras de autenticación", async () => {
    const { c, seen } = make((u) => json(u.includes("search") ? { pairs: [] } : []));
    await c.search("pump coin"); await c.tokenInfo(["A", "B"]); await c.tokenPairs("A"); await c.boostsLatest(); await c.boostsTop(); await c.profilesLatest();
    expect(seen.map((u) => u.replace("https://api.dexscreener.com", ""))).toEqual([
      "/latest/dex/search?q=pump%20coin", "/tokens/v1/solana/A,B", "/token-pairs/v1/solana/A", "/token-boosts/latest/v1", "/token-boosts/top/v1", "/token-profiles/latest/v1"]);
  });

  it("la caché evita llamadas repetidas", async () => {
    const { c, seen } = make(() => json([{ x: 1 }]));
    await c.boostsLatest(); await c.boostsLatest();
    expect(seen.length).toBe(1);
  });

  it("reintenta con backoff ante 429 y luego responde", async () => {
    let n = 0;
    const { c, waits } = make(() => (++n < 3 ? json({}, 429) : json([{ ok: 1 }])));
    expect(await c.boostsTop()).toEqual([{ ok: 1 }]);
    expect(waits).toEqual([500, 1000]);
  });

  it("si la API cae sirve el último dato (aunque esté caducado)", async () => {
    let fail = false;
    const { c, clock } = make(() => (fail ? json({}, 500) : json([{ v: 1 }])));
    expect(await c.boostsLatest()).toEqual([{ v: 1 }]);
    clock.t += 500_000; fail = true;
    expect(await c.boostsLatest()).toEqual([{ v: 1 }]);
  });

  it("sin caché y con la API caída lanza un error claro", async () => {
    const { c } = make(() => json({}, 503));
    await expect(c.boostsLatest()).rejects.toBeInstanceOf(DexScreenerError);
  });

  it("un error de red (fetch falla) se trata como transitorio", async () => {
    const fetchFn = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    const c = new DexScreenerClient(cfg, fetchFn, () => 1, async () => undefined);
    await expect(c.boostsLatest()).rejects.toThrow("no responde");
  });

  it("un 404 no se reintenta", async () => {
    const { c, seen } = make(() => json({}, 404));
    await expect(c.tokenPairs("X")).rejects.toBeInstanceOf(DexScreenerError);
    expect(seen.length).toBe(1);
  });

  it("el limitador bloquea cuando la ventana se llena", async () => {
    const t = { now: 0 }, waits: number[] = [];
    const rl = new RateLimiter(2, 60_000, () => t.now, async (ms) => { waits.push(ms); t.now += ms; });
    await rl.acquire(); await rl.acquire();
    expect(waits).toEqual([]);
    await rl.acquire();
    expect(waits).toEqual([60_000]);
  });
});
