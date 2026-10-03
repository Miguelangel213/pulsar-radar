export function ModeBanner({ mode }: { mode: "MOCK" | "REAL" | undefined }) {
  if (mode === "REAL") {
    return <div role="status" className="bg-solid/15 border-b border-solid/40 text-solid text-center text-[12px] py-1.5">DATOS REALES · conectado a GMGN en modo solo lectura</div>;
  }
  return (
    <div role="status" className="bg-flame text-black text-center text-[13px] font-medium py-1.5 px-4">
      {mode === "MOCK" ? "MOCK: datos simulados, sin conexión a GMGN. Nada de esto es mercado real." : "Conectando con el backend…"}
    </div>
  );
}
