"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAlerts } from "@/lib/api";
import { audioReady, playTones } from "@/lib/sound";
import type { AlertEvent, AlertsResponse } from "@/lib/types";

const POLL_MS = 5000;
const FALLBACK_SOUND = { quadrant: [660, 990], volume: 0.12 };

export function useAlerts(muted: boolean) {
  const [history, setHistory] = useState<AlertEvent[]>([]);
  const [toasts, setToasts] = useState<AlertEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const [config, setConfig] = useState<AlertsResponse["config"] | null>(null);
  const lastId = useRef<number | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const cfgRef = useRef<AlertsResponse["config"] | null>(null);

  const push = useCallback((evs: AlertEvent[]) => {
    if (!evs.length) return;
    setHistory((h) => [...evs.slice().reverse(), ...h].slice(0, 30));
    setToasts((t) => [...evs.slice().reverse(), ...t].slice(0, 4));
    setUnread((u) => u + evs.length);
    if (!mutedRef.current && audioReady()) {
      const snd = cfgRef.current?.sound ?? FALLBACK_SOUND;
      const e = evs[evs.length - 1];
      playTones(snd.quadrant, snd.volume);
    }
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    const load = async () => {
      try {
        const d = await fetchAlerts(lastId.current, ctl.signal);
        setConfig(d.config); cfgRef.current = d.config;
        if (lastId.current === null) setHistory(d.events.slice().reverse());   // historial previo: sin avisos ni sonido
        else push(d.events);
        lastId.current = d.last_id;
      } catch { /* el radar principal ya informa de la desconexión */ }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => { ctl.abort(); clearInterval(id); };
  }, [push]);

  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) Radar de Memecoins` : "Radar de Memecoins";
  }, [unread]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const markRead = useCallback(() => setUnread(0), []);
  const test = useCallback(() => {
    push([{ id: -Date.now(), type: "test", ts: Date.now() / 1000, address: "", symbol: "PRUEBA", stage: "new_creation", potential: 0, risk: 0, age_min: 0,
      message: "Así suena y se ve una entrada a alto potencial, bajo riesgo" }]);
  }, [push]);

  return { history, toasts, unread, config, dismiss, markRead, test };
}
