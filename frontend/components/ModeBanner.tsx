import type { GmgnStatus } from "@/lib/types";

const hhmm = (epochS: number) => new Date(epochS * 1000).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });

export function ModeBanner({ ready, source, gmgn }: { ready: boolean; source?: "GMGN" | "DEXSCREENER"; gmgn?: GmgnStatus }) {
  const note = gmgn?.error === "invalid_key" ? "key de GMGN inválida"
    : gmgn?.paused_until ? `GMGN en pausa hasta las ${hhmm(gmgn.paused_until)}` : null;
  return (
    <div role="status" className="bg-solid/12 border-b border-solid/40 text-center text-[12px] py-1.5 px-4 text-solid">
      {ready ? <>DATOS REALES · {source === "GMGN" ? "GMGN" : "DexScreener"}{note && <span className="text-dim"> · {note}</span>}</> : "Conectando con DexScreener…"}
    </div>
  );
}
