"use client";
import { useEffect, useRef } from "react";
import { DEX_LABEL, age, pct, price, riskKey, usd } from "@/lib/format";
import type { RadarItem, Win } from "@/lib/types";
import { RiskBadge } from "./RiskBadge";

const RISK_LABEL: Record<string, string> = { liquidity: "Liquidez", age: "Edad del par", sell_pressure: "Presión de venta", drop: "Caída de precio 1 h", contract: "Seguridad del contrato" };
const POT_LABEL: Record<string, string> = { liquidity: "Liquidez", volume: "Volumen", market_cap: "Espacio por market cap", age: "Edad del par", buy_sell: "Ratio compras/ventas" };
const GATE_LABEL: Record<string, string> = { min_liquidity: "Liquidez mínima", min_activity: "Actividad mínima", dump_h1: "Caída brusca en 1 h", sell_wall: "Muro de ventas" };
const RISK_BAR: Record<string, string> = { solid: "bg-solid", moderate: "bg-moderate", high: "bg-high", extreme: "bg-extreme" };
const WINDOWS: [keyof Win, string][] = [["m5", "5m"], ["h1", "1h"], ["h6", "6h"], ["h24", "24h"]];

function Row({ label, value, bar, unavailable }: { label: string; value: number; bar: string; unavailable?: boolean }) {
  return (
    <div className="flex items-center gap-3 text-[13px]">
      <span className="w-44 text-dim shrink-0">{label}</span>
      <div className="h-[5px] flex-1 bg-line"><div className={`h-full ${unavailable ? "bg-faint" : bar} transition-[width] duration-500`} style={{ width: `${value}%` }} /></div>
      <span className={`num w-14 text-right ${unavailable ? "text-faint text-[11px]" : ""}`}>{unavailable ? "sin dato" : value.toFixed(0)}</span>
    </div>
  );
}

export function DetailPanel({ item, onClose }: { item: RadarItem; onClose: () => void }) {
  const t = item.entry.token, rejected = item.entry.verdict === "rejected";
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, t.address]);

  const rank = (s: string) => (s === "fail" ? 0 : s === "unknown" ? 1 : 2);
  const gates = [...item.entry.gates].sort((a, b) => rank(a.status) - rank(b.status));
  const links = [
    { label: "DexScreener", href: t.url },
    ...(t.website ? [{ label: "Sitio web", href: t.website }] : []),
    ...t.socials.map((s) => ({ label: s.type === "twitter" ? "X / Twitter" : s.type === "telegram" ? "Telegram" : s.type, href: s.url })),
  ];

  return (
    <>
      <div className="fixed inset-0 bg-black/55 z-30 sm:bg-black/40" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" aria-label={`Detalle de ${t.symbol}`}
        className="panel-in fixed right-0 top-0 bottom-0 z-40 w-full sm:w-[480px] bg-panel border-l border-line-strong overflow-y-auto pb-10">
        <div className="sticky top-0 bg-panel border-b border-line px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2"><span className="font-serif text-[30px] leading-none truncate">{t.symbol}</span><span className="text-dim text-[13px] truncate">{t.name}</span></div>
            <div className="num text-[11px] text-faint mt-1 break-all">{t.address}</div>
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Cerrar panel" className="size-8 border border-line hover:border-flame text-dim hover:text-ink shrink-0">✕</button>
        </div>

        <div className="px-5 py-5 space-y-7">
          <div className="flex flex-wrap gap-2">
            {links.map((l) => <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="text-[12px] border border-flame/50 text-flame hover:bg-flame hover:text-black transition-colors px-3 py-1.5">{l.label}</a>)}
          </div>

          <div className="grid grid-cols-2 gap-px bg-line border border-line">
            <div className="bg-panel p-4">
              <div className="text-[12px] text-dim">Potencial</div>
              <div className="num text-[34px] leading-none mt-1">{item.potential.score.toFixed(0)}<span className="text-[14px] text-faint">/100</span></div>
              <div className="text-[11px] text-faint mt-2">probabilidad por señales</div>
            </div>
            <div className="bg-panel p-4">
              <div className="text-[12px] text-dim">Riesgo de mercado</div>
              <div className="num text-[34px] leading-none mt-1">{item.risk.score.toFixed(0)}<span className="text-[14px] text-faint">/100</span></div>
              <div className="mt-2"><RiskBadge level={item.risk.level} score={item.risk.score} rejected={rejected} /></div>
            </div>
          </div>
          {rejected && <p className="text-[13px] text-extreme border border-extreme/40 bg-extreme/10 px-3 py-2">Descartado por un gate de rechazo. Queda fuera del ranking.</p>}
          <p className="text-[12px] text-dim border border-line px-3 py-2 leading-relaxed">Este riesgo mide solo el mercado (liquidez, edad, ventas, caída). DexScreener no informa si el contrato es seguro, quién tiene los tokens ni qué hace el dev: revísalo por tu cuenta antes de decidir nada.</p>

          <section>
            <h3 className="text-[13px] font-medium mb-3">Por qué este riesgo</h3>
            <ul className="space-y-1.5 text-[13px] text-dim list-disc pl-4 marker:text-flame">{item.risk.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          </section>

          <section className="space-y-2.5">
            <h3 className="text-[13px] font-medium mb-3">Subpuntajes de riesgo <span className="text-faint font-normal">(más alto = más riesgo)</span></h3>
            {Object.entries(item.risk.subscores).map(([k, v]) => <Row key={k} label={RISK_LABEL[k] ?? k} value={v} unavailable={item.risk.unavailable.includes(k)} bar={RISK_BAR[riskKey(v <= 20 ? "Sólido" : v <= 35 ? "Moderado" : v <= 50 ? "Alto" : "Extremo")]} />)}
          </section>

          <section className="space-y-2.5">
            <h3 className="text-[13px] font-medium mb-3">Subpuntajes de potencial <span className="text-faint font-normal">(más alto = más señales)</span></h3>
            {Object.entries(item.potential.subscores).map(([k, v]) => <Row key={k} label={POT_LABEL[k] ?? k} value={v} unavailable={item.potential.unavailable.includes(k)} bar="bg-ink" />)}
            {item.potential.unavailable.length > 0 && <p className="text-[11px] text-faint">«Sin dato» = DexScreener no lo informa o la muestra es muy pequeña; en el cálculo cuenta como neutro (50).</p>}
          </section>

          <section>
            <h3 className="text-[13px] font-medium mb-3">Hard gates <span className="text-faint font-normal">({item.entry.failed.length} fallidos)</span></h3>
            <ul className="divide-y divide-line border border-line text-[13px]">
              {gates.map((g) => (
                <li key={g.name} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className={`size-2 rounded-full shrink-0 ${g.status === "fail" ? (g.severity === "reject" ? "bg-extreme" : "bg-high") : g.status === "unknown" ? "bg-faint" : "bg-solid"}`} />
                    {GATE_LABEL[g.name] ?? g.name}
                  </span>
                  <span className={`num text-[12px] text-right ${g.status === "fail" ? "text-ink" : "text-dim"}`}>
                    {g.status === "fail" && <span className="text-[10px] mr-2 text-dim">{g.severity === "reject" ? "descarte" : "marca roja"}</span>}{g.detail}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-[13px] font-medium mb-3">Mercado</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] mb-4">
              {([["Precio", price(t.price_usd)], ["Edad del par", age(t.age_min)], ["Market cap", usd(t.market_cap)], ["FDV", usd(t.fdv)],
                 ["Liquidez", t.liquidity_usd === null ? "curva (sin dato)" : usd(t.liquidity_usd)], ["Mercado", DEX_LABEL[t.dex_id] ?? t.dex_id],
                 ["Boosts activos", String(t.boosts_active)], ["Descubierto por", t.sources.join(", ") || "—"]] as const).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 border-b border-line pb-1.5"><span className="text-dim">{k}</span><span className="num text-right truncate">{v}</span></div>
              ))}
            </div>
            <table className="w-full text-[12px] num">
              <thead><tr className="text-dim text-right"><th className="text-left font-normal pb-1.5"></th>{WINDOWS.map(([, l]) => <th key={l} className="font-normal pb-1.5">{l}</th>)}</tr></thead>
              <tbody className="[&_td]:py-1 [&_td]:text-right [&_tr]:border-t [&_tr]:border-line">
                <tr><td className="!text-left text-dim">Volumen</td>{WINDOWS.map(([k]) => <td key={k}>{usd(t.volume[k])}</td>)}</tr>
                <tr><td className="!text-left text-dim">Compras</td>{WINDOWS.map(([k]) => <td key={k} className="text-solid">{t.buys[k]}</td>)}</tr>
                <tr><td className="!text-left text-dim">Ventas</td>{WINDOWS.map(([k]) => <td key={k} className="text-extreme">{t.sells[k]}</td>)}</tr>
                <tr><td className="!text-left text-dim">Precio</td>{WINDOWS.map(([k]) => <td key={k} className={(t.price_change[k] ?? 0) >= 0 ? "text-solid" : "text-extreme"}>{pct(t.price_change[k])}</td>)}</tr>
              </tbody>
            </table>
          </section>

          <p className="text-[11px] text-faint leading-relaxed">{item.potential.note}</p>
        </div>
      </aside>
    </>
  );
}
