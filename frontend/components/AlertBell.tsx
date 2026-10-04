"use client";
import { useEffect, useRef, useState } from "react";
import { audioReady } from "@/lib/sound";
import type { AlertEvent } from "@/lib/types";

function ago(ts: number): string {
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  return s < 60 ? `hace ${s}s` : s < 3600 ? `hace ${Math.floor(s / 60)}m` : `hace ${Math.floor(s / 3600)}h`;
}

export function AlertBell({ history, unread, muted, onToggleMute, onOpenPanel, onSelect, onTest }: {
  history: AlertEvent[]; unread: number; muted: boolean; onToggleMute: () => void; onOpenPanel: () => void;
  onSelect: (e: AlertEvent) => void; onTest: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);

  useEffect(() => { if (open && unread > 0) onOpenPanel(); }, [open, unread, onOpenPanel]);

  return (
    <div ref={box} className="relative">
      <button onClick={() => { setOpen(!open); if (!open) onOpenPanel(); }} aria-expanded={open} aria-label={`Alertas${unread ? `, ${unread} nuevas` : ""}`}
        className={`h-8 px-3 border text-[12px] flex items-center gap-2 ${unread ? "border-flame text-ink" : "border-line text-dim hover:text-ink"}`}>
        Alertas
        {unread > 0 && <span className="num bg-flame text-black px-1.5 text-[11px] font-medium">{unread}</span>}
        <span aria-hidden title={muted ? "Sonido silenciado" : "Sonido activo"} className="text-[11px]">{muted ? "🔇" : "🔔"}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-[360px] max-w-[calc(100vw-24px)] bg-panel border border-line-strong shadow-[0_12px_40px_rgba(0,0,0,.7)]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <span className="text-[13px] font-medium">Alertas</span>
            <button onClick={onToggleMute} aria-pressed={muted} className={`text-[12px] px-2 py-1 border ${muted ? "border-faint text-dim" : "border-solid/60 text-solid"}`}>
              {muted ? "Sonido silenciado" : "Sonido activo"}
            </button>
          </div>
          <ul className="max-h-[320px] overflow-y-auto divide-y divide-line">
            {history.length === 0 && <li className="px-4 py-8 text-center text-[13px] text-dim">Aún no hay alertas. Te avisaré cuando un token entre a alto potencial, bajo riesgo (y, con GMGN, cuando entre smart money a un token recién creado).</li>}
            {history.map((e) => (
              <li key={e.id}>
                <button onClick={() => { if (e.address) { onSelect(e); setOpen(false); } }} disabled={!e.address} className="w-full text-left px-4 py-2.5 hover:bg-raise disabled:cursor-default">
                  <div className="flex items-center justify-between text-[11px] text-dim"><span>{e.type === "quadrant" ? "Cuadrante" : e.type === "smart_money" ? "Smart money" : "Prueba"}</span><span className="num">{ago(e.ts)}</span></div>
                  <div className="text-[13px] mt-0.5 leading-snug">{e.message}</div>
                </button>
              </li>
            ))}
          </ul>
          <div className="px-4 py-3 border-t border-line flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-dim">Probar:</span>
            <button onClick={onTest} className="border border-line hover:border-solid px-2 py-1">alerta de cuadrante</button>
            {!audioReady() && <p className="basis-full text-faint text-[11px]">El navegador activa el sonido tras tu primer clic en la página.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
