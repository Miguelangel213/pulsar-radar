import { describe, expect, it } from "vitest";
import { pyFixed, pyMoney0, pyRound1, pySigned } from "../lib/engine/pyfmt";

// Valores comprobados contra Python 3 (f"{x:.0f}", round(x, 1), etc.)
describe("pyfmt replica el redondeo de Python", () => {
  it("empates exactos van al par (half-even)", () => {
    expect(pyFixed(40.5, 0)).toBe("40"); expect(pyFixed(41.5, 0)).toBe("42"); expect(pyFixed(0.5, 0)).toBe("0");
    expect(pyFixed(2.5, 0)).toBe("2"); expect(pyFixed(-40.5, 0)).toBe("-40"); expect(pyFixed(0.125, 2)).toBe("0.12");
    expect(pyRound1(0.25)).toBe(0.2); expect(pyRound1(0.75)).toBe(0.8);
  });
  it("NO trata como empate lo que solo lo parece al multiplicar", () => {
    expect(pyRound1(19.05)).toBe(19.1);      // 19.05 = 19.0500000000000007… en binario
    expect(pyRound1(62.65)).toBe(62.6); expect(pyFixed(2.675, 2)).toBe("2.67"); expect(pyFixed(1.005, 2)).toBe("1.00");
  });
  it("signo y formatos", () => {
    expect(pySigned(-60, 0)).toBe("-60"); expect(pySigned(12.4, 0)).toBe("+12"); expect(pySigned(-0.4, 0)).toBe("-0");
    expect(pyMoney0(1234567.5)).toBe("1,234,568"); expect(pyMoney0(1500)).toBe("1,500"); expect(pyFixed(2.25, 2)).toBe("2.25");
  });
});
