"use client";
import { useEffect, useRef } from "react";
import type { RadarItem, RadarResponse } from "@/lib/types";

const RAMP = " .·:-=+*#%@";
const CW = 10, CH = 15;

/** Campo ASCII: cada token se "pinta" en el plano potencial (vertical) vs. riesgo (horizontal).
 *  La línea de barrido cruza la franja de vez en cuando e ilumina lo que encuentra. */
export function HeroField({ items, meta }: { items: RadarItem[]; meta?: RadarResponse["meta"] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const itemsRef = useRef(items); itemsRef.current = items;
  const metaRef = useRef(meta); metaRef.current = meta;

  useEffect(() => {
    const cv = ref.current!; const g = cv.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cols = 0, rows = 0, dens = new Float32Array(0), raf = 0, last = 0;
    const t0 = performance.now();

    const resize = () => {
      const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = r.width * dpr; cv.height = r.height * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(r.width / CW); rows = Math.ceil(r.height / CH); dens = new Float32Array(cols * rows);
    };
    const ro = new ResizeObserver(resize); ro.observe(cv); resize();

    const target = () => {
      const t = new Float32Array(cols * rows);
      const list = itemsRef.current.filter((i) => i.entry.verdict !== "rejected");
      const maxVol = Math.max(1, ...list.map((i) => i.entry.token.volume.h1 ?? 0));
      for (const it of list) {
        const cx = 2 + (it.risk.score / 100) * (cols - 4), cy = 1 + (1 - it.potential.score / 100) * (rows - 2);
        const w = 0.35 + 0.65 * Math.sqrt((it.entry.token.volume.h1 ?? 0) / maxVol), sig = 3.2;
        for (let y = Math.max(0, Math.floor(cy - 9)); y < Math.min(rows, cy + 9); y++)
          for (let x = Math.max(0, Math.floor(cx - 14)); x < Math.min(cols, cx + 14); x++) {
            const dx = (x - cx) / 2, dy = y - cy; // las celdas son más altas que anchas: compensa
            t[y * cols + x] += w * 0.75 * Math.exp(-(dx * dx + dy * dy) / (2 * sig * sig));
          }
      }
      return t;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 45) return; last = now;
      const tg = target(), time = (now - t0) / 1000, q = metaRef.current?.quadrant;
      const r = cv.getBoundingClientRect();
      g.clearRect(0, 0, r.width, r.height);
      g.font = "12px ui-monospace, Menlo, monospace"; g.textBaseline = "top";
      const sweepX = reduce ? -99 : ((time % 9) / 9 * 1.5 - 0.25) * cols;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        dens[i] += (tg[i] - dens[i]) * 0.07;
        const noise = reduce ? 0 : 0.08 + 0.06 * Math.sin(time * 0.9 + x * 0.35 + y * 0.6);
        const d = x - sweepX, trail = d <= 0 && d > -16 ? 1 + d / 16 : 0;
        const edge = Math.abs(d) < 0.8;
        const v = Math.min(1, dens[i] + noise * (dens[i] > 0.04 ? 0.6 : 1) + trail * (0.12 + dens[i] * 0.8));
        const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(v * RAMP.length))];
        if (ch === " " && !edge) continue;
        const inQ = q && (x / cols) * 100 <= q.max_risk && (1 - y / rows) * 100 >= q.min_potential;
        const a = Math.min(1, 0.28 + v * 0.9);
        g.fillStyle = edge ? "rgba(255,69,36,.85)" : inQ ? `rgba(38,210,154,${a})` : `rgba(235,232,228,${a * 0.8})`;
        g.fillText(edge && ch === " " ? "|" : ch, x * CW, y * CH);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={ref} aria-hidden className="absolute inset-0 w-full h-full" />;
}
