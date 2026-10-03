export function ModeBanner({ ready }: { ready: boolean }) {
  return (
    <div role="status" className="bg-solid/12 border-b border-solid/40 text-center text-[12px] py-1.5 px-4 text-solid">
      {ready
        ? <>DATOS REALES · DexScreener, solo lectura <span className="text-dim">· sin análisis del contrato, holders ni smart money</span></>
        : "Conectando con DexScreener…"}
    </div>
  );
}
