import { RISK_LEVELS, type Filters, type RiskLevel } from "@/lib/types";

const field = "bg-panel border border-line focus:border-flame outline-none h-8 px-2 text-[13px] num text-ink placeholder:text-faint";

export function FilterBar({ f, onChange, view, onView }: { f: Filters; onChange: (f: Filters) => void; view: "table" | "map"; onView: (v: "table" | "map") => void }) {
  const set = (p: Partial<Filters>) => onChange({ ...f, ...p });
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-6 py-3 border-b border-line text-[12px] text-dim">
      <label className="flex items-center gap-2">Riesgo
        <select className={field} value={f.riskLevel} onChange={(e) => set({ riskLevel: e.target.value as RiskLevel | "" })}>
          <option value="">Todos</option>
          {RISK_LEVELS.map((l) => <option key={l}>{l}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2">Edad máx. (min)
        <input className={`${field} w-20`} inputMode="decimal" placeholder="∞" value={f.maxAge} onChange={(e) => set({ maxAge: e.target.value.replace(/[^\d.]/g, "") })} />
      </label>
      <label className="flex items-center gap-2">Liquidez mín. ($)
        <input className={`${field} w-24`} inputMode="decimal" placeholder="0" value={f.minLiquidity} onChange={(e) => set({ minLiquidity: e.target.value.replace(/[^\d.]/g, "") })} />
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" className="accent-[var(--color-flame)]" checked={f.includeRejected} onChange={(e) => set({ includeRejected: e.target.checked })} />
        Mostrar descartados
      </label>
      <div role="group" aria-label="Vista" className="ml-auto flex border border-line">
        {([["table", "Tabla"], ["map", "Mapa"]] as const).map(([v, l]) => (
          <button key={v} aria-pressed={view === v} onClick={() => onView(v)} className={`h-8 px-3 text-[13px] ${view === v ? "bg-flame text-black" : "text-dim hover:text-ink"}`}>{l}</button>
        ))}
      </div>
    </div>
  );
}
