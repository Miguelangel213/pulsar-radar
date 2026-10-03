import { expect } from "vitest";
import type { DexClient, Pair } from "../lib/engine/types";

/** Compara estructuras exigiendo las mismas claves y textos idénticos; los números, con tolerancia mínima. */
export function expectSame(actual: unknown, expected: unknown, path = "$"): void {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    expect(Math.abs((actual as number) - expected), `${path}: ${actual} vs ${expected}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(expected)));
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, `${path} longitud`).toBe(expected.length);
    expected.forEach((e, i) => expectSame((actual as unknown[])[i], e, `${path}[${i}]`));
  } else if (expected && typeof expected === "object") {
    expect(actual && typeof actual === "object", path).toBeTruthy();
    const a = actual as Record<string, unknown>, e = expected as Record<string, unknown>;
    expect(Object.keys(a).sort(), `${path} claves`).toEqual(Object.keys(e).sort());
    for (const k of Object.keys(e)) expectSame(a[k], e[k], `${path}.${k}`);
  } else {
    expect(actual, path).toEqual(expected);
  }
}

/** Cliente falso: reproduce feeds y pares de una grabación. */
export class ReplayClient implements DexClient {
  chain = "solana";
  calls = { tokenInfo: [] as string[][] };
  constructor(public feeds: { boosts_latest?: Pair[]; boosts_top?: Pair[]; profiles?: Pair[] }, public pairs: Pair[]) {}
  async boostsLatest() { return structuredClone(this.feeds.boosts_latest ?? []); }
  async boostsTop() { return structuredClone(this.feeds.boosts_top ?? []); }
  async profilesLatest() { return structuredClone(this.feeds.profiles ?? []); }
  async search() { return []; }
  async tokenInfo(addrs: string[]) { this.calls.tokenInfo.push(addrs); return structuredClone(this.pairs.filter((p) => addrs.includes(p.baseToken.address))); }
}
