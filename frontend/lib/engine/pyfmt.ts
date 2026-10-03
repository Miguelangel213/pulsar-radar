// Python y JavaScript redondean distinto los empates EXACTOS (p. ej. 40.5 -> Python "40", JS "41").
// Estas funciones replican a Python para que el motor dé los mismos números y textos.
// Un empate solo es exacto si la expansión decimal del double termina justo en "5000…": se comprueba sobre la expansión
// completa (toFixed usa el valor exacto del double), no multiplicando, que puede redondear y fingir un empate.

/** Equivale a f"{x:.{d}f}" de Python. */
export function pyFixed(x: number, d: number): string {
  const neg = x < 0 || Object.is(x, -0);
  const ax = Math.abs(x);
  const full = ax.toFixed(Math.min(100, d + 30));
  const dot = full.indexOf(".");
  const tail = full.slice(dot + 1 + d);
  let body: string;
  if (/^50*$/.test(tail)) {                      // empate exacto: half-even
    let n = BigInt(full.slice(0, dot) + full.slice(dot + 1, dot + 1 + d));
    if (n % 2n === 1n) n += 1n;
    const s = n.toString().padStart(d + 1, "0");
    body = d ? `${s.slice(0, s.length - d)}.${s.slice(s.length - d)}` : s;
  } else {
    body = ax.toFixed(d);
  }
  return (neg ? "-" : "") + body;
}

/** Equivale a f"{x:+.{d}f}". */
export const pySigned = (x: number, d: number): string => (x < 0 || Object.is(x, -0) ? "" : "+") + pyFixed(x, d);

/** Equivale a f"{x:,.0f}". */
export function pyMoney0(x: number): string {
  const s = pyFixed(Math.abs(x), 0);
  return (x < 0 ? "-" : "") + s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Equivale a round(x, 1) de Python. */
export const pyRound1 = (x: number): number => Number(pyFixed(x, 1));
