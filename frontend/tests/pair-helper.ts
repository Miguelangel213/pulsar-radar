/** Par de DexScreener mínimo para las pruebas de selección de fuente. */
export function pair(addr: string): Record<string, unknown> {
  return {
    chainId: "solana", dexId: "pumpswap", url: `https://dexscreener.com/solana/pair${addr}`, pairAddress: `pair${addr}`,
    baseToken: { address: addr, name: `${addr} coin`, symbol: addr },
    priceUsd: "0.00005", txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 60, sells: 30 }, h6: { buys: 200, sells: 100 }, h24: { buys: 600, sells: 300 } },
    volume: { h24: 80000, h6: 40000, h1: 10000, m5: 800 }, priceChange: { m5: 1, h1: 5, h6: 3, h24: 1 }, liquidity: { usd: 30000 },
    fdv: 50000, marketCap: 50000, pairCreatedAt: (1791132052 - 20 * 60) * 1000,
  };
}
