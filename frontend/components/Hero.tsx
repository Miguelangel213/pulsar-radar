import type { RadarItem, RadarResponse } from "@/lib/types";
import { HeroField } from "./HeroField";

export function Hero({ items, meta }: { items: RadarItem[]; meta?: RadarResponse["meta"] }) {
  const live = items.filter((i) => i.entry.verdict !== "rejected");
  const avg = (f: (i: RadarItem) => number) => (live.length ? live.reduce((s, i) => s + f(i), 0) / live.length : null);
  const stats: [string, string, string?][] = [
    ["En el cuadrante", String(live.filter((i) => i.quadrant).length), "text-solid"],
    ["Tokens vivos", String(live.length)],
    ["Potencial medio", avg((i) => i.potential.score)?.toFixed(0) ?? "—"],
    ["Riesgo medio", avg((i) => i.risk.score)?.toFixed(0) ?? "—"],
  ];
  return (
    <section aria-label="Resumen del radar" className="relative h-[150px] sm:h-[210px] overflow-hidden border-b border-line bg-void">
      <HeroField items={items} meta={meta} />
      <div className="absolute inset-0 bg-gradient-to-t from-void/70 via-transparent to-void/40 pointer-events-none" />
      <h1 className="absolute left-4 sm:left-6 bottom-0 font-serif text-flame leading-[0.78] tracking-[-0.03em] select-none pointer-events-none translate-y-[0.06em] [text-shadow:0_0_28px_#000,0_0_10px_#000,0_0_3px_#000]"
        style={{ fontSize: "clamp(92px, 21vw, 224px)" }}>RADAR</h1>
      <dl className="absolute right-4 sm:right-6 top-4 hidden sm:grid gap-y-1.5 text-right text-[12px]">
        {stats.map(([k, v, c]) => (
          <div key={k} className="flex items-baseline justify-end gap-3 bg-void/60 px-1.5"><dt className="text-dim">{k}</dt><dd className={`num text-[15px] w-9 ${c ?? "text-ink"}`}>{v}</dd></div>
        ))}
      </dl>
    </section>
  );
}
