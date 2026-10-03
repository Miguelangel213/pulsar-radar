export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
export function price(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1) return `$${n.toFixed(3)}`;
  const digits = Math.min(10, Math.max(4, 2 - Math.floor(Math.log10(n))));
  return `$${n.toFixed(digits)}`;
}
export function pct(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(Math.abs(n) >= 100 ? 0 : 1)}%`;
}
export function age(min: number | null | undefined): string {
  if (min === null || min === undefined) return "—";
  if (min < 1) return `${Math.max(1, Math.round(min * 60))}s`;
  if (min < 60) return `${Math.floor(min)}m`;
  const h = Math.floor(min / 60), m = Math.floor(min % 60);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}m`;
}
export const int = (n: number) => n.toLocaleString("es");
export const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
export const riskKey = (l: string) => ({ "Sólido": "solid", Moderado: "moderate", Alto: "high", Extremo: "extreme" }[l] ?? "moderate");
export const DEX_LABEL: Record<string, string> = { pumpfun: "pump.fun", pumpswap: "PumpSwap", raydium: "Raydium", meteoradbc: "Meteora", meteora: "Meteora" };
