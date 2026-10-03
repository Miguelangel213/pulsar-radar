"use client";
import { useEffect, useRef } from "react";
import { age, int, riskKey, usd } from "@/lib/format";
import type { RadarItem, RadarResponse } from "@/lib/types";
import { RiskBadge } from "./RiskBadge";

const RISK_LABEL: Record<string, string> = { contract: "Seguridad del contrato", liquidity: "Liquidez", holders: "Distribución de holders", dev: "Dev", age: "Edad" };
const POT_LABEL: Record<string, string> = { velocity: "Velocidad", buyers: "Calidad de compradores", pressure: "Presión compra/venta", dev: "Dev", narrative: "Narrativa" };
const GATE_LABEL: Record<string, string> = {
  honeypot: "Honeypot", buy_tax: "Impuesto de compra", sell_tax: "Impuesto de venta", mint_authority: "Mint sin renunciar",
  freeze_authority: "Freeze sin renunciar", rug_ratio: "Rug ratio", bundlers: "Bundlers", snipers: "Snipers",
  top10_concentration: "Concentración top 10", dev_holding: "Holding del dev", dev_rug_history: "Historial de rugs del dev",
};
const RISK_BAR: Record<string, string> = { solid: "bg-solid", moderate: "bg-moderate", high: "bg-high", extreme: "bg-extreme" };

function Row({ label, value, bar }: { label: string; value: number; bar: string }) {
  return (
    <div className="flex items-center gap-3 text-[13px]">
      <span className="w-44 text-dim shrink-0">{label}</span>
      <div className="h-[5px] flex-1 bg-line"><div className={`h-full ${bar} transition-[width] duration-500`} style={{ width: `${value}%` }} /></div>
      <span className="num w-8 text-right">{value.toFixed(0)}</span>
    </div>
  );
}

export function DetailPanel({ item, meta, mode, onClose }: { item: RadarItem; meta: RadarResponse["meta"]; mode: "MOCK" | "REAL" | undefined; onClose: () => void }) {
  const t = item.entry.token, rejected = item.entry.verdict === "rejected";
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, t.address]);

  const gates = [...item.entry.gates].sort((a, b) => (a.status === "fail" ? 0 : a.status === "unknown" ? 1 : 2) - (b.status === "fail" ? 0 : b.status === "unknown" ? 1 : 2));
  const link = meta.gmgn_token_url.replace("{address}", t.address);

  return (
    <>
      <div className="fixed inset-0 bg-black/55 z-30 sm:bg-black/40" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" aria-label={`Detalle de ${t.symbol}`}
        className="panel-in fixed right-0 top-0 bottom-0 z-40 w-full sm:w-[460px] bg-panel border-l border-line-strong overflow-y-auto pb-10">
        <div className="sticky top-0 bg-panel border-b border-line px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2"><span className="font-serif text-[30px] leading-none">{t.symbol}</span><span className="text-dim text-[13px] truncate">{t.name}</span></div>
            <div className="num text-[11px] text-faint mt-1 break-all">{t.address}</div>
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Cerrar panel" className="size-8 border border-line hover:border-flame text-dim hover:text-ink shrink-0">✕</button>
        </div>

        <div className="px-5 py-5 space-y-7">
          <div className="grid grid-cols-2 gap-px bg-line border border-line">
            <div className="bg-panel p-4">
              <div className="text-[12px] text-dim">Potencial</div>
              <div className="num text-[34px] leading-none mt-1">{item.potential.score.toFixed(0)}<span className="text-[14px] text-faint">/100</span></div>
              <div className="text-[11px] text-faint mt-2">probabilidad por señales</div>
            </div>
            <div className="bg-panel p-4">
              <div className="text-[12px] text-dim">Riesgo</div>
              <div className="num text-[34px] leading-none mt-1">{item.risk.score.toFixed(0)}<span className="text-[14px] text-faint">/100</span></div>
              <div className="mt-2"><RiskBadge level={item.risk.level} score={item.risk.score} rejected={rejected} /></div>
            </div>
          </div>
          {rejected && <p className="text-[13px] text-extreme border border-extreme/40 bg-extreme/10 px-3 py-2">Descartado por un gate de rechazo. Queda fuera del ranking.</p>}

          <section>
            <h3 className="text-[13px] font-medium mb-3">Por qué este riesgo</h3>
            <ul className="space-y-1.5 text-[13px] text-dim list-disc pl-4 marker:text-flame">{item.risk.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          </section>

          <section className="space-y-2.5">
            <h3 className="text-[13px] font-medium mb-3">Subpuntajes de riesgo <span className="text-faint font-normal">(más alto = más riesgo)</span></h3>
            {Object.entries(item.risk.subscores).map(([k, v]) => <Row key={k} label={RISK_LABEL[k] ?? k} value={v} bar={RISK_BAR[riskKey(v <= 25 ? "Sólido" : v <= 50 ? "Moderado" : v <= 75 ? "Alto" : "Extremo")]} />)}
          </section>

          <section className="space-y-2.5">
            <h3 className="text-[13px] font-medium mb-3">Subpuntajes de potencial <span className="text-faint font-normal">(más alto = más señales)</span></h3>
            {Object.entries(item.potential.subscores).map(([k, v]) => <Row key={k} label={POT_LABEL[k] ?? k} value={v} bar="bg-ink" />)}
          </section>

          <section>
            <h3 className="text-[13px] font-medium mb-3">Hard gates <span className="text-faint font-normal">({item.entry.failed.length} fallidos)</span></h3>
            <ul className="divide-y divide-line border border-line text-[13px]">
              {gates.map((g) => (
                <li key={g.name} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className={`size-2 rounded-full ${g.status === "fail" ? (g.severity === "reject" ? "bg-extreme" : "bg-high") : g.status === "unknown" ? "bg-faint" : "bg-solid"}`} />
                    {GATE_LABEL[g.name] ?? g.name}
                  </span>
                  <span className={`num text-[12px] text-right ${g.status === "fail" ? "text-ink" : "text-dim"}`}>
                    {g.status === "fail" && <span className="text-[10px] mr-2 text-dim">{g.severity === "reject" ? "descarte" : "marca roja"}</span>}{g.detail}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
            {([["Edad", age(t.age_min)], ["Market cap", usd(t.market_cap)], ["Liquidez", usd(t.liquidity)], ["Volumen", usd(t.volume)], ["Holders", int(t.holders)], ["Curva", `${(t.curve_progress * 100).toFixed(0)}%`],
               ["Compras / ventas", `${t.buys} / ${t.sells}`], ["Narrativa", t.narrative_tags.join(", ") || "—"]] as const).map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-line pb-1.5"><span className="text-dim">{k}</span><span className="num">{v}</span></div>
            ))}
          </section>

          {mode === "MOCK"
            ? <p className="text-[12px] text-faint border border-line px-3 py-2">Dirección simulada (MOCK): no existe en GMGN, por eso no hay enlace.</p>
            : <a href={link} target="_blank" rel="noopener noreferrer" className="block text-center border border-flame text-flame hover:bg-flame hover:text-black transition-colors py-2.5 text-[13px]">Abrir en GMGN</a>}
          <p className="text-[11px] text-faint leading-relaxed">{item.potential.note}</p>
        </div>
      </aside>
    </>
  );
}
