"use client";
import { useEffect, useState } from "react";

export function StatusBar({ updatedAt, error, count, quadrant }: { updatedAt: number | null; error: boolean; count: number | null; quadrant: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const secs = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;
  return (
    <footer className="fixed bottom-0 inset-x-0 h-9 bg-panel border-t border-line flex items-center gap-5 px-4 sm:px-6 text-[12px] text-dim z-20 overflow-hidden whitespace-nowrap">
      <span className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${error ? "bg-extreme" : "bg-solid pulse-dot"}`} />
        {error ? "Sin conexión" : "En vivo"}
      </span>
      <span>Actualizado <span className="num text-ink">{secs === null ? "—" : `hace ${secs}s`}</span></span>
      <span>Tokens <span className="num text-ink">{count ?? "—"}</span></span>
      <span className="hidden sm:inline">Alto potencial, bajo riesgo <span className="num text-solid">{quadrant}</span></span>
      <span className="ml-auto hidden md:inline text-faint">Datos de DexScreener · el potencial es una probabilidad por señales, no una recomendación</span>
    </footer>
  );
}
