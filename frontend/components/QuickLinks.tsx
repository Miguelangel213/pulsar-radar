"use client";
import { useState } from "react";
import type { Token } from "@/lib/types";

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* sin permiso: método alternativo */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

/** Enlaces rápidos de un token. `compact` = solo emoji (tabla); si no, con etiqueta (panel). */
export function QuickLinks({ token, compact }: { token: Token; compact?: boolean }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const items = [
    ...(token.links.gmgn ? [{ key: "gmgn", emoji: "🟢", label: "GMGN", href: token.links.gmgn }] : []),
    { key: "dex", emoji: "📈", label: "DexScreener", href: token.links.dexscreener },
    { key: "chart", emoji: "📊", label: "Chart", href: token.links.dexscreener_chart },
    { key: "solscan", emoji: "🔍", label: "Solscan", href: token.links.solscan },
    { key: "birdeye", emoji: "🦅", label: "Birdeye", href: token.links.birdeye },
  ];
  const base = compact
    ? "size-7 inline-flex items-center justify-center border border-line hover:border-flame hover:bg-raise text-[13px]"
    : "h-8 px-3 inline-flex items-center gap-1.5 border border-flame/50 text-flame hover:bg-flame hover:text-black transition-colors text-[12px]";
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className="flex flex-wrap items-center gap-1.5" onClick={stop} onKeyDown={stop}>
      {items.map((i) => (
        <a key={i.key} href={i.href} target="_blank" rel="noopener noreferrer" className={base} title={`${i.label} (se abre en otra pestaña)`} aria-label={`${i.label} de ${token.symbol}`}>
          <span aria-hidden>{i.emoji}</span>{!compact && i.label}
        </a>
      ))}
      <button
        type="button" className={`${base} ${state === "ok" ? "!border-solid !text-solid !bg-transparent" : ""} ${state === "fail" ? "!border-extreme !text-extreme !bg-transparent" : ""}`}
        title={`Copiar contract address de ${token.symbol}`} aria-label={`Copiar contract address de ${token.symbol}`}
        onClick={async (e) => { e.stopPropagation(); setState((await copyText(token.address)) ? "ok" : "fail"); setTimeout(() => setState("idle"), 1600); }}>
        <span aria-hidden>{state === "ok" ? "✓" : "📋"}</span>{!compact && (state === "ok" ? "Copiado" : state === "fail" ? "No se pudo copiar" : "Copy CA")}
      </button>
    </div>
  );
}
