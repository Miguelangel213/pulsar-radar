"use client";
import { useEffect, useRef, useState } from "react";
import { fetchRadar } from "@/lib/api";
import type { Filters, RadarResponse, SortKey, StageKey } from "@/lib/types";

const REFRESH_MS = 5000;

export function useRadar(stage: StageKey, filters: Filters, sort: SortKey, order: "asc" | "desc" | undefined, reload = 0) {
  const [data, setData] = useState<RadarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const key = JSON.stringify([stage, filters, sort, order, reload]);
  const lastKey = useRef(key);

  useEffect(() => {
    const ctl = new AbortController();
    if (lastKey.current !== key) { setLoading(true); setData(null); lastKey.current = key; }
    const load = async () => {
      try {
        const d = await fetchRadar(stage, filters, sort, order, ctl.signal);
        setData(d); setError(null); setUpdatedAt(Date.now());
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message === "Failed to fetch" ? "Sin conexión con el backend" : (e as Error).message);
      } finally { if (!ctl.signal.aborted) setLoading(false); }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { ctl.abort(); clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, error, loading, updatedAt };
}
