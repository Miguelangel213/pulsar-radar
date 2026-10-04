"use client";
import { useEffect, useRef, useState } from "react";
import { STATIC } from "@/lib/api";
import type { GmgnStatus } from "@/lib/types";

const hhmm = (epochS: number) => new Date(epochS * 1000).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });

function Inner({ source, status, onApplied }: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);

  const apply = async (key: string | null) => {
    const { setGmgnKey } = await import("@/lib/engine");
    setGmgnKey(key);
    setValue(""); setProblem(null);
    onApplied();
  };
  const connect = () => {
    const key = value.trim();
    if (key.length < 12) { setProblem("La key parece vacía o demasiado corta."); return; }
    void apply(key);
  };

  const enabled = status?.enabled ?? false;
  const dot = source === "GMGN" ? "bg-solid" : enabled ? "bg-high" : "bg-faint";
  let msg: { text: string; tone: string };
  if (!enabled) msg = { text: "Usando DexScreener, sin key.", tone: "text-dim" };
  else if (status?.error === "invalid_key") msg = { text: "GMGN rechazó la key. Revísala o pega otra.", tone: "text-extreme" };
  else if (status?.paused_until) msg = { text: `GMGN pidió esperar hasta las ${hhmm(status.paused_until)} (límite de uso). Mientras tanto ves DexScreener y vuelve solo.${(status.strikes ?? 0) > 1 ? ` Ya van ${status.strikes} avisos seguidos: la espera se alarga a propósito para no empeorarlo.` : ""}`, tone: "text-high" };
  else if (status?.error === "unreachable") msg = { text: "No se pudo contactar con GMGN; ves DexScreener hasta que responda.", tone: "text-high" };
  else if (status?.active) msg = { text: "GMGN conectado: tokens desde sus primeros minutos, con seguridad, holders y smart money.", tone: "text-solid" };
  else msg = { text: "Conectando con GMGN…", tone: "text-dim" };

  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Fuente de datos" className="h-8 px-3 border border-line hover:text-ink text-dim text-[12px] flex items-center gap-2">
        <span className={`size-2 rounded-full ${dot}`} aria-hidden />
        <span className="hidden sm:inline">Fuente:</span> {source === "GMGN" ? "GMGN" : "DexScreener"}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-[360px] max-w-[calc(100vw-24px)] bg-panel border border-line-strong shadow-[0_12px_40px_rgba(0,0,0,.7)] p-4 space-y-3 text-[13px]">
          <div className="font-medium">Fuente de datos</div>
          <p className="text-dim leading-relaxed">Por defecto se usa DexScreener. Con tu propia API key de GMGN ves los tokens desde sus primeros minutos, con señales de seguridad, holders, dev y smart money.</p>
          <p className={msg.tone} role="status">{msg.text}</p>
          {status?.paused_until && status.reason && <p className="text-[12px] text-dim leading-relaxed">Motivo según GMGN: {status.reason}. Mantén una sola pestaña abierta y no recargues mientras esperas.</p>}
          <form onSubmit={(e) => { e.preventDefault(); connect(); }} className="space-y-2">
            <label className="block text-[12px] text-dim" htmlFor="gmgn-key">API key de GMGN</label>
            <input id="gmgn-key" name="gmgn-key" type="password" autoComplete="off" spellCheck={false} value={value} onChange={(e) => { setValue(e.target.value); setProblem(null); }}
              placeholder={enabled ? "Pega otra key para cambiarla" : "Pega tu key aquí"} className="w-full h-9 bg-void border border-line focus:border-flame outline-none px-2 num text-[13px]" />
            {problem && <p className="text-extreme text-[12px]">{problem}</p>}
            <div className="flex gap-2">
              <button type="submit" className="h-8 px-3 bg-flame text-black text-[12px] font-medium">{enabled ? "Cambiar key" : "Conectar GMGN"}</button>
              {enabled && <button type="button" onClick={() => void apply(null)} className="h-8 px-3 border border-line hover:border-extreme text-dim hover:text-ink text-[12px]">Quitar key</button>}
            </div>
          </form>
          <p className="text-[11px] text-faint leading-relaxed">La key se guarda solo en este navegador y solo se envía a GMGN. Nunca pasa por ningún otro servidor. Consigue una en gmgn.ai/ai.</p>
        </div>
      )}
    </div>
  );
}

interface Props { source: "GMGN" | "DEXSCREENER" | undefined; status: GmgnStatus | undefined; onApplied: () => void }

/** Solo existe en la versión estática (sin backend): ahí cada visitante usa su propia key. */
export function SourceSettings(props: Props) { return STATIC ? <Inner {...props} /> : null; }
