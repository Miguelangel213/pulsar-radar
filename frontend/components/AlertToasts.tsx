"use client";
import { useEffect } from "react";
import type { AlertEvent } from "@/lib/types";

const TONE: Record<string, string> = { quadrant: "border-l-solid", test: "border-l-dim" };
const LABEL: Record<string, string> = { quadrant: "Cuadrante", test: "Prueba" };

function Toast({ ev, onClose, onOpen }: { ev: AlertEvent; onClose: () => void; onOpen: () => void }) {
  useEffect(() => { const id = setTimeout(onClose, 9000); return () => clearTimeout(id); }, [onClose]);
  return (
    <div className={`toast-in bg-raise border border-line-strong border-l-[3px] ${TONE[ev.type]} shadow-[0_8px_30px_rgba(0,0,0,.6)] w-[340px] max-w-[calc(100vw-24px)]`}>
      <button onClick={onOpen} disabled={!ev.address} className="block w-full text-left px-4 py-3 disabled:cursor-default">
        <div className="text-[11px] text-dim mb-1">{LABEL[ev.type]}</div>
        <div className="text-[13px] leading-snug">{ev.message}</div>
      </button>
      <button onClick={onClose} aria-label="Cerrar aviso" className="absolute top-1.5 right-2 text-faint hover:text-ink text-[12px]">✕</button>
    </div>
  );
}

export function AlertToasts({ toasts, onClose, onOpen }: { toasts: AlertEvent[]; onClose: (id: number) => void; onOpen: (e: AlertEvent) => void }) {
  return (
    <div role="status" aria-live="polite" className="fixed bottom-12 right-3 z-50 flex flex-col-reverse gap-2 items-end">
      {toasts.map((t) => (
        <div key={t.id} className="relative">
          <Toast ev={t} onClose={() => onClose(t.id)} onOpen={() => { onOpen(t); onClose(t.id); }} />
        </div>
      ))}
    </div>
  );
}
