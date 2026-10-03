import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import CONFIG from "../lib/engine/config.generated.json";
import { AlertService } from "../lib/engine/alerts";
import { buildEntry } from "../lib/engine/gates";
import { classify, normalizePair, TokenScanner } from "../lib/engine/scanner";
import { scoreEntry } from "../lib/engine/scoring";
import { RadarService } from "../lib/engine/service";
import type { Cfg } from "../lib/engine/types";
import { ReplayClient, expectSame } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(resolve(here, "fixtures/parity.json"), "utf8"));
const live = JSON.parse(readFileSync(resolve(here, "fixtures/live.json"), "utf8"));
const cfg = CONFIG as Cfg;

describe("paridad con el motor Python", () => {
  it("la configuración generada coincide con backend/config/radar.yaml", () => {
    expect(cfg).toEqual(fx.config);
  });

  it("puntúa los 196 casos (límites y aleatorios) igual que Python", () => {
    for (const c of fx.cases) {
      const t = normalizePair(c.pair, fx.now * 1000, cfg.links);
      if (c.token_only) { expectSame(t, c.token_only, `token ${c.pair.baseToken.address}`); continue; }
      t.sources = c.sources;
      t.stages = classify(t, cfg) as typeof t.stages;
      expectSame(scoreEntry(buildEntry(t, cfg), cfg), c.expected, `caso ${c.pair.baseToken.address}`);
    }
  });

  it("escanea una captura REAL de DexScreener y da las mismas listas por etapa", async () => {
    const client = new ReplayClient(live, live.pairs);
    const sc = new TokenScanner(client, cfg, () => live.captured_at);
    await sc.scan(true);
    expect([...sc.tracked.keys()].sort()).toEqual(fx.live.tracked);
    const svc = new RadarService(sc, cfg);
    for (const [stage, expected] of Object.entries(fx.live.stages)) {
      expectSame(await svc.query({ stage, includeRejected: true }), expected, `etapa ${stage}`);
    }
  });

  it("filtros y órdenes devuelven el mismo orden de tokens que Python", async () => {
    const sc = new TokenScanner(new ReplayClient(live, live.pairs), cfg, () => live.captured_at);
    await sc.scan(true);
    const svc = new RadarService(sc, cfg);
    expect(fx.live.variants.length).toBeGreaterThan(50);
    for (const v of fx.live.variants) {
      const got = (await svc.query(v.q)).map((s) => s.entry.token.address);
      expect(got, JSON.stringify(v.q)).toEqual(v.addresses);
    }
  });

  it("las alertas reproducen la secuencia de Python (línea base, una sola vez por token, descartados fuera)", async () => {
    const client = new ReplayClient({}, []);
    let t = fx.alerts.base;
    const sc = new TokenScanner(client, cfg, () => t);
    const alerts = new AlertService(new RadarService(sc, cfg), () => 100);
    let last: number | null = null;
    for (const step of fx.alerts.steps) {
      t = fx.alerts.base + step.t;
      client.pairs = step.pairs;
      client.feeds = { boosts_latest: step.pairs.map((p: { baseToken: { address: string } }) => ({ chainId: "solana", tokenAddress: p.baseToken.address })) };
      const got = await alerts.events(last);
      last = got.last_id;
      expectSame(got, step.expected, `paso t=${step.t}`);
    }
  });
});
