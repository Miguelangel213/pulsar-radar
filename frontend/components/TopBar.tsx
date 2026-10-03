import type { ReactNode } from "react";

export function TopBar({ ready, children }: { ready: boolean; children?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-4 px-4 sm:px-6 h-14 border-b border-line">
      <div className="flex items-center gap-2.5 text-[13px]">
        <span className="size-2 bg-flame" aria-hidden />
        <span className="font-medium">Radar de Memecoins</span>
        <span className="hidden md:inline text-dim">Solana · solo lectura</span>
      </div>
      <div className="flex items-center gap-3 text-[12px]">
        {children}
        <span className="num h-8 px-2 inline-flex items-center border border-solid text-solid text-[11px]">{ready ? "DATOS REALES" : "…"}</span>
      </div>
    </header>
  );
}
