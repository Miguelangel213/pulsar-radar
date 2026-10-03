import { STAGES, type StageKey } from "@/lib/types";

export function Tabs({ stage, onChange, count }: { stage: StageKey; onChange: (s: StageKey) => void; count: number | null }) {
  return (
    <div role="tablist" aria-label="Etapa" className="flex gap-1 px-4 sm:px-6 border-b border-line overflow-x-auto">
      {STAGES.map((s) => {
        const active = s.key === stage;
        return (
          <button key={s.key} role="tab" aria-selected={active} onClick={() => onChange(s.key)}
            className={`relative px-3 py-3 text-[14px] whitespace-nowrap transition-colors ${active ? "text-ink" : "text-dim hover:text-ink"}`}>
            {s.label}
            {active && count !== null && <span className="num ml-2 text-[11px] text-flame">{count}</span>}
            {active && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-flame" />}
          </button>
        );
      })}
    </div>
  );
}
