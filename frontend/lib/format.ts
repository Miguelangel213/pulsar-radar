export function usd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
export function age(min: number): string {
  if (min < 1) return `${Math.max(1, Math.round(min * 60))}s`;
  if (min < 60) return `${Math.floor(min)}m`;
  const h = Math.floor(min / 60), m = Math.floor(min % 60);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}m`;
}
export const int = (n: number) => n.toLocaleString("es");
export const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-8)}`;
export const riskKey = (l: string) => ({ "Sólido": "solid", Moderado: "moderate", Alto: "high", Extremo: "extreme" }[l] ?? "moderate");
