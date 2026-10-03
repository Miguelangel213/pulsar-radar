"use client";
import { useLayoutEffect, useRef } from "react";
import { DEX_LABEL, age, pct, shortAddr, usd } from "@/lib/format";
import type { RadarItem, SortKey } from "@/lib/types";
import { RiskBadge } from "./RiskBadge";
import { ScoreBar } from "./ScoreBar";

interface Col { label: string; sort?: SortKey; align?: "right"; wide?: boolean }
const COLS: Col[] = [
  { label: "#" }, { label: "Token", sort: "adjusted" }, { label: "Edad", sort: "age", align: "right", wide: true },
  { label: "Market cap", sort: "market_cap", align: "right", wide: true }, { label: "Liquidez", sort: "liquidity", align: "right", wide: true },
  { label: "Vol. 1h", sort: "volume", align: "right", wide: true }, { label: "Compras / ventas 1h", sort: "txns", align: "right", wide: true },
  { label: "Cambio 1h", sort: "change", align: "right", wide: true },
  { label: "Potencial", sort: "potential" }, { label: "Riesgo", sort: "risk" },
];

export function RadarTable({ items, sort, onSort, onSelect, selected }: { items: RadarItem[]; sort: SortKey; onSort: (s: SortKey) => void; onSelect: (i: RadarItem) => void; selected?: string }) {
  const rows = useRef(new Map<string, HTMLElement>());
  const tops = useRef(new Map<string, number>());

  // Animación sutil (FLIP) cuando un token cambia de posición; los tokens nuevos se resaltan un instante.
  useLayoutEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hadPrev = tops.current.size > 0;
    rows.current.forEach((el, key) => {
      const top = el.getBoundingClientRect().top;
      const prev = tops.current.get(key);
      if (!reduce && prev !== undefined && Math.abs(prev - top) > 1) {
        el.animate([{ transform: `translateY(${prev - top}px)` }, { transform: "none" }], { duration: 380, easing: "cubic-bezier(.2,.7,.2,1)" });
      } else if (!reduce && prev === undefined && hadPrev) {
        el.animate([{ backgroundColor: "rgba(255,69,36,.18)" }, { backgroundColor: "transparent" }], { duration: 1200 });
      }
      tops.current.set(key, top);
    });
    tops.current.forEach((_, k) => { if (!rows.current.has(k)) tops.current.delete(k); });
  }, [items]);

  return (
    <div className="overflow-x-auto pb-12">
      <div role="table" aria-label="Tokens ordenados del mejor al más riesgoso" className="sm:min-w-[1100px]">
        <div role="row" className="radar-grid sticky top-0 z-10 bg-void border-b border-line px-4 sm:px-6 h-9 text-[12px] text-dim">
          {COLS.map((c) => (
            <div key={c.label} role="columnheader" className={`${c.align === "right" ? "text-right" : ""} ${c.wide ? "max-sm:hidden" : ""}`}>
              {c.sort ? (
                <button onClick={() => onSort(c.sort!)} className={`hover:text-ink ${sort === c.sort ? "text-flame" : ""}`}>
                  {c.label}{sort === c.sort ? " ↓" : ""}
                </button>
              ) : c.label}
            </div>
          ))}
        </div>
        {items.map((it, i) => {
          const t = it.entry.token, rejected = it.entry.verdict === "rejected";
          const total = t.buys.h1 + t.sells.h1, buyShare = total ? (t.buys.h1 / total) * 100 : 50;
          const chg = t.price_change.h1;
          return (
            <div key={t.address} role="row" tabIndex={0} onClick={() => onSelect(it)} onKeyDown={(e) => { if (e.key === "Enter") onSelect(it); }} aria-selected={selected === t.address}
              ref={(el) => { if (el) rows.current.set(t.address, el); else rows.current.delete(t.address); }}
              className={`radar-grid px-4 sm:px-6 py-3 border-b border-line cursor-pointer hover:bg-raise transition-colors ${selected === t.address ? "bg-raise" : ""} ${rejected ? "opacity-45" : ""} ${it.quadrant ? "shadow-[inset_2px_0_0_var(--color-solid)]" : ""}`}>
              <div role="cell" className="num text-[12px] text-faint">{i + 1}</div>
              <div role="cell" className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-[14px] font-medium shrink-0 max-w-[140px] truncate">{t.symbol}</span>
                  <span className="text-[12px] text-dim truncate">{t.name}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 whitespace-nowrap overflow-hidden">
                  <span className="text-[10px] text-dim border border-line px-1 shrink-0">{DEX_LABEL[t.dex_id] ?? t.dex_id}</span>
                  <span className="num text-[11px] text-faint shrink-0">{shortAddr(t.address)}</span>
                  {t.boosts_active > 0 && <span className="num text-[10px] text-flame border border-flame/40 px-1 shrink-0">boost {t.boosts_active}</span>}
                  {it.quadrant && <span className="text-[10px] text-solid border border-solid/40 px-1 shrink-0">alto potencial, bajo riesgo</span>}
                  {it.entry.verdict === "red_flags" && <span className="text-[10px] text-high border border-high/40 px-1 shrink-0">{it.entry.failed.length} marca{it.entry.failed.length > 1 ? "s" : ""} roja{it.entry.failed.length > 1 ? "s" : ""}</span>}
                </div>
              </div>
              <div role="cell" className="max-sm:hidden num text-[13px] text-right">{age(t.age_min)}</div>
              <div role="cell" className="max-sm:hidden num text-[13px] text-right">{usd(t.market_cap)}</div>
              <div role="cell" className="max-sm:hidden num text-[13px] text-right text-dim" title={t.liquidity_usd === null ? "Par en bonding curve: DexScreener no informa liquidez" : undefined}>{t.liquidity_usd === null ? "curva" : usd(t.liquidity_usd)}</div>
              <div role="cell" className="max-sm:hidden num text-[13px] text-right text-dim">{usd(t.volume.h1)}</div>
              <div role="cell" className="max-sm:hidden">
                <div className="num text-[12px] text-right"><span className="text-solid">{t.buys.h1}</span><span className="text-faint"> / </span><span className="text-extreme">{t.sells.h1}</span></div>
                <div className="h-[3px] mt-1 bg-extreme/50"><div className="h-full bg-solid" style={{ width: `${buyShare}%` }} /></div>
              </div>
              <div role="cell" className={`max-sm:hidden num text-[13px] text-right ${chg === null ? "text-faint" : chg >= 0 ? "text-solid" : "text-extreme"}`}>{pct(chg)}</div>
              <div role="cell"><ScoreBar value={it.potential.score} dim={rejected} /></div>
              <div role="cell"><RiskBadge level={it.risk.level} score={it.risk.score} rejected={rejected} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
