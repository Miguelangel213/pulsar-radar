import { pyFixed } from "./pyfmt";
import type { RadarService } from "./service";
import type { ScoredEntry } from "./types";
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

  private lastSource: string | undefined;

  private async scan(): Promise<void> {
    const a = this.service.cfg.alerts, nowQ = new Set<string>(), queued = new Set<string>();
    const pending: { type: "quadrant" | "smart_money"; s: ScoredEntry }[] = [];
    const sm = a.smart_money;
    for (const st of a.stages) {
      for (const s of await this.service.scored(st)) {
        const t = s.entry.token;
        if (s.entry.verdict === "rejected") continue;
        if (s.quadrant) {
          nowQ.add(t.address);
          const key = `quadrant:${t.address}`;
          if (a.quadrant_entry && !this.inQuadrant.has(t.address) && !this.fired.has(key) && !queued.has(key)) { queued.add(key); pending.push({ type: "quadrant", s }); }
        }
        // Smart money: solo con datos de GMGN. Entra smart money a un token con menos de X minutos de vida.
        const smart = t.gmgn?.smart_degen_count ?? 0, key = `smart_money:${t.address}`;
        if (sm.enabled && t.gmgn && smart >= sm.min_buyers && t.age_min !== null && t.age_min <= sm.max_age_min && !this.fired.has(key) && !queued.has(key)) { queued.add(key); pending.push({ type: "smart_money", s }); }
      }
    }
    const source = this.service.scanner.sourceId;
    if (this.lastSource !== undefined && source !== this.lastSource) { this.baselineDone = false; this.inQuadrant = new Set(); }   // cambió de fuente: nueva línea base
    this.lastSource = source;
    if (this.baselineDone) {
      for (const { type, s } of pending) {
        const t = s.entry.token;
        const age = (t.age_min ?? 0) < 1 ? "menos de 1 min" : `${pyFixed(t.age_min ?? 0, 0)} min`;
        const n = t.gmgn?.smart_degen_count ?? 0;
        this.events_.push({
          id: this.nextId++, type, ts: this.clock(), address: t.address, symbol: t.symbol,
          stage: (a.stages.find((x: string) => (t.stages as string[]).includes(x)) ?? t.stages[0] ?? "") as AlertEvent["stage"],
          message: type === "quadrant"
            ? `${t.symbol} entró a alto potencial, bajo riesgo (potencial ${pyFixed(s.potential.score, 0)}, riesgo ${pyFixed(s.risk.score, 0)})`
            : `Smart money entró a ${t.symbol} con ${age} de vida (${n} wallet${n > 1 ? "s" : ""})`,
          potential: s.potential.score, risk: s.risk.score, age_min: t.age_min || 0,
        });
      }
      this.events_ = this.events_.slice(-a.max_stored);
    }
    for (const { type, s } of pending) this.fired.add(`${type}:${s.entry.token.address}`);
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
