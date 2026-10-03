import { STATIC } from "@/lib/api";

export function ModeBanner({ ready }: { ready: boolean }) {
  return (
    <div role="status" className="bg-solid/12 border-b border-solid/40 text-center text-[12px] py-1.5 px-4 text-solid">
      {!ready ? "Conectando con DexScreener…"
        : STATIC ? <>DEMO <span className="text-dim">· Próximamente: versión completa con histórico y más funciones</span></>
        : <>DATOS REALES · DexScreener, solo lectura</>}
    </div>
  );
}
