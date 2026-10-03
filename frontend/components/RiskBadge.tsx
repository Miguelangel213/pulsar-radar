import { riskKey } from "@/lib/format";
import type { RiskLevel } from "@/lib/types";

const TONE: Record<string, string> = {
  solid: "text-solid border-solid/50 bg-solid/10", moderate: "text-moderate border-moderate/50 bg-moderate/10",
  high: "text-high border-high/50 bg-high/10", extreme: "text-extreme border-extreme/50 bg-extreme/10",
};

export function RiskBadge({ level, score, rejected }: { level: RiskLevel; score: number; rejected?: boolean }) {
  if (rejected) return <span className="inline-flex items-center gap-2"><span className="px-2 py-0.5 text-[11px] border border-faint text-dim line-through decoration-faint">Descartado</span></span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`px-2 py-0.5 text-[11px] border ${TONE[riskKey(level)]}`}>{level}</span>
      <span className="num text-[12px] text-dim">{score.toFixed(0)}</span>
    </span>
  );
}
