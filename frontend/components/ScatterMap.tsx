"use client";
import { useEffect, useRef, useState } from "react";
import { riskKey, usd } from "@/lib/format";
import type { RadarItem, RadarResponse } from "@/lib/types";

const COLOR: Record<string, string> = { solid: "#26d29a", moderate: "#e9cf47", high: "#ff8f1f", extreme: "#ff2d55" };
const PAD = { l: 48, r: 20, t: 20, b: 44 };

export function ScatterMap({ items, meta, onSelect, selected }: { items: RadarItem[]; meta: RadarResponse["meta"]; onSelect: (i: RadarItem) => void; selected?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const [hover, setHover] = useState<RadarItem | null>(null);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const h = w < 520 ? 380 : 540;
  const iw = w - PAD.l - PAD.r, ih = h - PAD.t - PAD.b;
  const x = (risk: number) => PAD.l + (risk / 100) * iw;
  const y = (pot: number) => PAD.t + (1 - pot / 100) * ih;
  const maxVol = Math.max(1, ...items.map((i) => i.entry.token.volume.h1 ?? 0));
  const rad = (v: number) => 4 + Math.sqrt(v / maxVol) * 16;
  const q = meta.quadrant;
  const sorted = [...items].sort((a, b) => (b.entry.token.volume.h1 ?? 0) - (a.entry.token.volume.h1 ?? 0)); // los grandes atrás

  return (
    <div ref={wrap} className="relative px-4 sm:px-6 py-5 pb-14">
      <svg width={w} height={h} role="img" aria-label="Mapa de potencial contra riesgo" className="block max-w-full">
        <rect x={x(0)} y={y(100)} width={x(q.max_risk) - x(0)} height={y(q.min_potential) - y(100)} fill="rgba(38,210,154,.08)" stroke="rgba(38,210,154,.55)" strokeDasharray="4 4" />
        <text x={x(0) + 8} y={y(100) + 18} fill="#26d29a" fontSize="12">Alto potencial, bajo riesgo</text>
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={y(0)} y2={y(100)} stroke="#1d1d20" />
            <line x1={x(0)} x2={x(100)} y1={y(v)} y2={y(v)} stroke="#1d1d20" />
            <text x={x(v)} y={h - 22} fill="#86868d" fontSize="11" textAnchor="middle" className="num">{v}</text>
            <text x={PAD.l - 10} y={y(v) + 4} fill="#86868d" fontSize="11" textAnchor="end" className="num">{v}</text>
          </g>
        ))}
        <text x={x(50)} y={h - 4} fill="#86868d" fontSize="12" textAnchor="middle">Riesgo →</text>
        <text transform={`translate(12 ${y(50)}) rotate(-90)`} fill="#86868d" fontSize="12" textAnchor="middle">Potencial →</text>
        {sorted.map((it) => {
          const t = it.entry.token, c = COLOR[riskKey(it.risk.level)], sel = selected === t.address;
          return (
            <circle key={t.address} cx={x(it.risk.score)} cy={y(it.potential.score)} r={rad(t.volume.h1 ?? 0)} fill={c} fillOpacity={sel ? 0.9 : 0.35} stroke={sel ? "#fff" : c}
              strokeWidth={sel ? 2 : 1} tabIndex={0} role="button" aria-label={`${t.symbol}, potencial ${it.potential.score.toFixed(0)}, riesgo ${it.risk.score.toFixed(0)}`}
              className="cursor-pointer outline-none focus-visible:stroke-white" style={{ transition: "cx .6s, cy .6s, r .6s" }}
              onClick={() => onSelect(it)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(it); } }}
              onMouseEnter={() => setHover(it)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(it)} onBlur={() => setHover(null)} />
          );
        })}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute z-10 bg-raise border border-line-strong px-3 py-2 text-[12px] whitespace-nowrap"
          style={{ left: Math.min(Math.max(x(hover.risk.score) + 28, 8), w - 190), top: Math.max(y(hover.potential.score) - 6, 8) }}>
          <div className="font-medium">{hover.entry.token.symbol} <span className="text-dim font-normal">{hover.entry.token.name}</span></div>
          <div className="num text-dim mt-1">Pot. {hover.potential.score.toFixed(0)} · Riesgo {hover.risk.score.toFixed(0)} ({hover.risk.level})</div>
          <div className="num text-dim">Vol. 1h {usd(hover.entry.token.volume.h1)}</div>
        </div>
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-[12px] text-dim">
        {(["Sólido", "Moderado", "Alto", "Extremo"] as const).map((l) => <span key={l} className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: COLOR[riskKey(l)] }} />{l}</span>)}
        <span>Tamaño del punto = volumen en 1 h</span>
      </div>
    </div>
  );
}
