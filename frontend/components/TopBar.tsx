export function TopBar({ mode }: { mode: "MOCK" | "REAL" | undefined }) {
  return (
    <header className="flex items-center justify-between gap-4 px-4 sm:px-6 h-14 border-b border-line">
      <div className="flex items-baseline gap-3">
        <span className="font-serif text-[30px] leading-none tracking-tight text-ink">Radar</span>
        <span className="hidden sm:inline text-[12px] text-dim">memecoins desde el minuto cero</span>
      </div>
      <div className="flex items-center gap-3 text-[12px]">
        <span className="hidden md:inline text-dim">Solo lectura · sin órdenes</span>
        <span className={`num px-2 py-1 border text-[11px] ${mode === "REAL" ? "border-solid text-solid" : "border-flame text-flame"}`}>
          {mode === "REAL" ? "DATOS REALES" : mode === "MOCK" ? "MOCK" : "…"}
        </span>
      </div>
    </header>
  );
}
