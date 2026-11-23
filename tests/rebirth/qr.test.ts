import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatBits, qrGrid, qrPath, QrTooLongError, qrSvg, rsDivisor, rsRemainder } from "@/lib/rebirth/qr";

/** The format information read from both places it is written; each must be one of the 8 valid words. */
function formats(grid: boolean[][]) {
  const n = grid.length;
  const word = (cells: [number, number][]) => cells.reduce((acc, [x, y], i) => acc | ((grid[y][x] ? 1 : 0) << i), 0);
  const first = word([
    ...[0, 1, 2, 3, 4, 5].map((i): [number, number] => [8, i]),
    [8, 7], [8, 8], [7, 8],
    ...[9, 10, 11, 12, 13, 14].map((i): [number, number] => [14 - i, 8]),
  ]);
  const second = word([
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i): [number, number] => [n - 1 - i, 8]),
    ...[8, 9, 10, 11, 12, 13, 14].map((i): [number, number] => [8, n - 15 + i]),
  ]);
  return { first, second };
}

describe("qr encoder", () => {
  it("sizes the grid by version: 21 modules for a short text, growing with the text", () => {
    expect(qrGrid("Hola")).toHaveLength(21);
    expect(qrGrid("x".repeat(30))).toHaveLength(29);
    expect(qrGrid("x".repeat(213))).toHaveLength(57);
    expect(() => qrGrid("x".repeat(214))).toThrow(QrTooLongError);
  });

  it("draws the three finder patterns, the timing lines, the dark module and a valid format word twice", () => {
    for (const text of ["Hola", "https://phantom-line.vercel.app/call/barberia-paco", "é".repeat(60)]) {
      const g = qrGrid(text);
      const n = g.length;
      for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
        for (let d = 0; d < 7; d++) {
          expect(g[oy][ox + d]).toBe(true);
          expect(g[oy + 6][ox + d]).toBe(true);
          expect(g[oy + d][ox]).toBe(true);
          expect(g[oy + d][ox + 6]).toBe(true);
        }
        expect(g[oy + 3][ox + 3]).toBe(true);
        expect(g[oy + 1][ox + 1]).toBe(false);
      }
      for (let i = 8; i < n - 8; i++) expect(g[6][i]).toBe(i % 2 === 0);
      expect(g[n - 8][8]).toBe(true);
      const valid = [0, 1, 2, 3, 4, 5, 6, 7].map(formatBits);
      const { first, second } = formats(g);
      expect(valid).toContain(first);
      expect(second).toBe(first);
    }
  });

  it("Reed-Solomon: data plus its error-correction words leave a zero remainder", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 60 }), fc.integer({ min: 7, max: 30 }), (data, deg) => {
        const divisor = rsDivisor(deg);
        const ecc = rsRemainder([...data], divisor);
        expect(rsRemainder([...data, ...ecc], divisor).every((b) => b === 0)).toBe(true);
      }),
    );
  });

  it("is deterministic and always square, for any text that fits", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (s) => {
        const a = qrGrid(s);
        expect(qrGrid(s)).toEqual(a);
        expect(a.every((row) => row.length === a.length)).toBe(true);
      }),
    );
  });

  it("the SVG is one path, with no script and no external reference", () => {
    const svg = qrSvg("https://example.com/call/x", { label: 'A "QR" <b>' });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toMatch(/<script|href=|onload|javascript:/i);
    expect(svg.match(/<path/g)).toHaveLength(1);
    expect(svg).toContain('aria-label="A QR b"');
    const { d, side } = qrPath(qrGrid("Hola"));
    expect(side).toBe(21 + 8);
    expect(d.startsWith("M")).toBe(true);
  });
});
