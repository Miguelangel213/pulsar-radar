// Sonido generado en el navegador (Web Audio): sin archivos de audio ni servicios externos.
let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") void ctx.resume();
  } catch { /* sin audio disponible */ }
}
export const audioReady = () => ctx?.state === "running";

export function playTones(freqs: number[], volume: number): void {
  if (!ctx || ctx.state !== "running") return;
  const t0 = ctx.currentTime;
  freqs.forEach((f, i) => {
    const osc = ctx!.createOscillator(), gain = ctx!.createGain();
    osc.type = "sine"; osc.frequency.value = f;
    const s = t0 + i * 0.14;
    gain.gain.setValueAtTime(0.0001, s);
    gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.001), s + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, s + 0.22);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(s); osc.stop(s + 0.25);
  });
}

const KEY = "radar.muted";
export function loadMuted(): boolean { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } }
export function saveMuted(m: boolean): void { try { localStorage.setItem(KEY, m ? "1" : "0"); } catch { /* ignorar */ } }
