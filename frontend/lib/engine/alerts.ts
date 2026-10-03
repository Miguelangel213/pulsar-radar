import { pyFixed } from "./pyfmt";
import type { RadarService } from "./service";
import type { AlertEvent } from "../types";

/** Detecta entradas al cuadrante comparando cada escaneo con el anterior. El primero solo fija la línea base. */
export class AlertService {
  private events_: AlertEvent[] = [];
  private fired = new Set<string>();
  private inQuadrant = new Set<string>();
  private baselineDone = false;
  private nextId = 1;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private service: RadarService, private clock: () => number = () => Date.now() / 1000) {}

  private async scan(): Promise<void> {
    const a = this.service.cfg.alerts, nowQ = new Set<string>(), queued = new Set<string>();
    const pending = [];
    for (const st of a.stages) {
      for (const s of await this.service.scored(st)) {
        const t = s.entry.token;
        if (s.entry.verdict === "rejected" || !s.quadrant) continue;
        nowQ.add(t.address);
        if (a.quadrant_entry && !this.inQuadrant.has(t.address) && !this.fired.has(t.address) && !queued.has(t.address)) { queued.add(t.address); pending.push(s); }
      }
    }
    if (this.baselineDone) {
      for (const s of pending) {
        const t = s.entry.token;
        this.events_.push({
          id: this.nextId++, type: "quadrant", ts: this.clock(), address: t.address, symbol: t.symbol,
          stage: (a.stages.find((x: string) => (t.stages as string[]).includes(x)) ?? t.stages[0] ?? "") as AlertEvent["stage"],
          message: `${t.symbol} entró a alto potencial, bajo riesgo (potencial ${pyFixed(s.potential.score, 0)}, riesgo ${pyFixed(s.risk.score, 0)})`,
          potential: s.potential.score, risk: s.risk.score, age_min: t.age_min || 0,
        });
      }
      this.events_ = this.events_.slice(-a.max_stored);
    }
    for (const s of pending) this.fired.add(s.entry.token.address);
    this.inQuadrant = nowQ;
    this.baselineDone = true;
  }

  events(after: number | null): Promise<{ events: AlertEvent[]; last_id: number; config: { sound: { quadrant: number[]; volume: number } } }> {
    const run = this.chain.then(async () => {
      await this.scan();
      let evs = this.events_.filter((e) => after === null || e.id > after);
      if (after === null) evs = evs.slice(-20);
      return { events: evs, last_id: this.nextId - 1, config: { sound: this.service.cfg.alerts.sound as { quadrant: number[]; volume: number } } };
    });
    this.chain = run.catch(() => undefined);   // un fallo no bloquea las siguientes llamadas
    return run;
  }
}
