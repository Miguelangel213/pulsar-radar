import type { StageKey } from "@/lib/types";

export function LoadingRows() {
  return (
    <div aria-busy="true" aria-label="Cargando tokens" className="divide-y divide-line">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="px-4 sm:px-6 py-4"><div className="skeleton h-9" style={{ opacity: 1 - i * 0.08 }} /></div>
      ))}
    </div>
  );
}

const EMPTY: Partial<Record<StageKey, string>> = {
  near_graduation: "Ningún token de pump.fun está cerca de graduarse ahora mismo. Se llena solo cuando uno se acerca.",
  trending: "Ningún token tiene boost activo en este momento.",
};

export function EmptyState({ filtered, stage }: { filtered: boolean; stage: StageKey }) {
  return (
    <div className="py-24 text-center px-6">
      <p className="font-serif text-[34px] text-ink">{filtered ? "Nada pasa estos filtros" : "Aún no hay tokens en esta etapa"}</p>
      <p className="text-dim text-[14px] mt-2 max-w-md mx-auto">{filtered ? "Amplía la edad máxima, baja la liquidez mínima o muestra los descartados." : EMPTY[stage] ?? "El radar se actualiza solo cada 5 segundos."}</p>
    </div>
  );
}

export function ErrorState({ message, hasData }: { message: string; hasData: boolean }) {
  return (
    <div role="alert" className={`${hasData ? "border-b" : "m-6 border"} border-extreme/50 bg-extreme/10 text-[13px] px-4 py-3`}>
      <span className="text-extreme font-medium">{message}.</span>{" "}
      <span className="text-dim">{hasData ? "Mostrando los últimos datos recibidos; reintenta solo." : "Si el backend está apagado, arráncalo con: python3 -m uvicorn api.main:app --port 8000"}</span>
    </div>
  );
}
