"use client";
import { useLayoutEffect, useRef } from "react";
import { age, int, shortAddr, usd } from "@/lib/format";
import type { RadarItem, SortKey } from "@/lib/types";
import { RiskBadge } from "./RiskBadge";
import { ScoreBar } from "./ScoreBar";

interface Col { label: string; sort?: SortKey; align?: "right"; wide?: boolean }
const COLS: Col[] = [
  { label: "#" }, { label: "Token", sort: "adjusted" }, { label: "Edad", wide: true, sort: "age", align: "right" },
  { label: "Market cap", wide: true, sort: "market_cap", align: "right" }, { label: "Liquidez", wide: true, sort: "liquidity", align: "right" },
  { label: "Volumen", wide: true, sort: "volume", align: "right" }, { label: "Holders", wide: true, sort: "holders", align: "right" },
  { label: "Potencial", sort: "potential" }, { label: "Riesgo", sort: "risk" },
];

export function RadarTable({ items, sort, onSort, onSelect, selected }: { items: RadarItem[]; sort: SortKey; onSort: (s: SortKey) => void; onSelect: (i: RadarItem) => void; selected?: string }) {
  const rows = useRef(new Map<string, HTMLElement>());
  const tops = useRef(new Map<string, number>());

  // Animación sutil (FLIP) cuando un token cambia de posición.
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
      <div role="table" aria-label="Tokens ordenados del mejor al más riesgoso" className="sm:min-w-[1020px]">
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
          return (
            <div key={t.address} role="row" tabIndex={0} onClick={() => onSelect(it)} onKeyDown={(e) => { if (e.key === "Enter") onSelect(it); }} aria-selected={selected === t.address} ref={(el) => { if (el) rows.current.set(t.address, el); else rows.current.delete(t.address); }}
              className={`radar-grid px-4 sm:px-6 py-3 border-b border-line cursor-pointer hover:bg-raise transition-colors ${selected === t.address ? "bg-raise" : ""} ${rejected ? "opacity-45" : ""} ${it.quadrant ? "shadow-[inset_2px_0_0_var(--color-solid)]" : ""}`}>
              <div role="cell" className="num text-[12px] text-faint">{i + 1}</div>
              <div role="cell" className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-[14px] font-medium shrink-0">{t.symbol}</span>
                  <span className="text-[12px] text-dim truncate">{t.name}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 whitespace-nowrap">
                  <span className="num text-[11px] text-faint shrink-0">{shortAddr(t.address)}</span>
                  {it.quadrant && <span className="text-[10px] text-solid border border-solid/40 px-1">alto potencial, bajo riesgo</span>}
                  {it.entry.verdict === "red_flags" && <span className="text-[10px] text-high border border-high/40 px-1">{it.entry.failed.length} marca{it.entry.failed.length > 1 ? "s" : ""} roja{it.entry.failed.length > 1 ? "s" : ""}</span>}
                </div>
              </div>
              <div role="cell" className="max-sm:hidden num text-[13px] text-right">{age(t.age_min)}</div>
              <div role="cell" className="max-sm:hidden num text-[13px] text-right">{usd(t.market_cap)}</div>
              <div role="cell" className="max-sm:hidden num text-[13px] text-right text-dim">{usd(t.liquidity)}</div>
              <div role="cell" className="max-sm:hidden num text-[13px] text-right text-dim">{usd(t.volume)}</div>
              <div role="cell" className="max-sm:hidden num text-[13px] text-right text-dim">{int(t.holders)}</div>
              <div role="cell"><ScoreBar value={it.potential.score} dim={rejected} /></div>
              <div role="cell"><RiskBadge level={it.risk.level} score={it.risk.score} rejected={rejected} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
