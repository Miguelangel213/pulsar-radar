export function ScoreBar({ value, dim }: { value: number; dim?: boolean }) {
  return (
    <div className="flex items-center gap-2" title="Probabilidad basada en señales, no una predicción">
      <div className="h-[6px] flex-1 bg-line relative overflow-hidden">
        <div className={`absolute inset-y-0 left-0 transition-[width] duration-500 ${dim ? "bg-faint" : "bg-ink"}`} style={{ width: `${value}%` }} />
      </div>
      <span className="num text-[12px] w-7 text-right">{value.toFixed(0)}</span>
    </div>
  );
}
