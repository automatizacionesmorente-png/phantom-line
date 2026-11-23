/**
 * A small QR Code encoder (byte mode, error correction level M, versions 1 to 10, so up to 213
 * bytes), with no dependency. Follows ISO/IEC 18004: Reed-Solomon over GF(256) with 0x11D,
 * interleaved blocks, the eight masks scored by the four penalty rules. Pure: text in, a square
 * grid of dark modules out. `qrSvg` turns the grid into an inline SVG (one path, no script).
 */

export const MAX_VERSION = 10;
/** Error-correction codewords per block, and number of blocks, for level M, indexed by version. */
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

export type QrGrid = boolean[][];

function rawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

const dataCodewords = (ver: number) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];

/** Product in GF(256), reducing by x^8 + x^4 + x^3 + x^2 + 1. */
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

export function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

/** The remainder of `data` divided by `divisor`: the error-correction codewords. */
export function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= gfMul(coef, factor)));
  }
  return result;
}

/** Data bits (mode, count, bytes, terminator, padding) filled to the version's capacity. */
function dataBits(bytes: readonly number[], ver: number): number[] {
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacity = dataCodewords(ver) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  return bits;
}

function addEccAndInterleave(data: readonly number[], ver: number): number[] {
  const blocks = NUM_BLOCKS[ver];
  const eccLen = ECC_PER_BLOCK[ver];
  const raw = Math.floor(rawDataModules(ver) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const divisor = rsDivisor(eccLen);
  const dataBlocks: number[][] = [];
  const eccBlocks: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const len = shortLen - eccLen + (i < shortBlocks ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    dataBlocks.push(dat);
    eccBlocks.push(rsRemainder(dat, divisor));
  }
  const out: number[] = [];
  for (let i = 0; i < dataBlocks[blocks - 1].length; i++) dataBlocks.forEach((b) => i < b.length && out.push(b[i]));
  for (let i = 0; i < eccLen; i++) eccBlocks.forEach((b) => out.push(b[i]));
  return out;
}

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const num = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (num * 2 - 2)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 10; result.length < num; pos -= step) result.splice(1, 0, pos);
  return result;
}

/** The 15 format bits for level M and `mask` (BCH, masked), as a number. */
export function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask; // level M = 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function versionBits(ver: number): number {
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (ver << 12) | rem;
}

interface Matrix {
  size: number;
  modules: boolean[][];
  isFunction: boolean[][];
}

function drawFunctionPatterns(ver: number): Matrix {
  const size = ver * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark;
    isFunction[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const align = alignmentPositions(ver);
  align.forEach((ax, i) =>
    align.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  // Reserve the format areas (drawn per mask) and the version areas.
  drawFormat(modules, isFunction, 0, size);
  if (ver >= 7) {
    const bits = versionBits(ver);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }
  return { size, modules, isFunction };
}

function drawFormat(modules: boolean[][], isFunction: boolean[][], mask: number, size: number) {
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >>> i) & 1) !== 0;
  const set = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark;
    isFunction[y][x] = true;
  };
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
}

function drawCodewords(m: Matrix, codewords: readonly number[]) {
  let i = 0;
  for (let right = m.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < m.size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? m.size - 1 - vert : vert;
        if (!m.isFunction[y][x] && i < codewords.length * 8) {
          m.modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(m: Matrix, mask: number) {
  for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (!m.isFunction[y][x] && MASKS[mask](x, y)) m.modules[y][x] = !m.modules[y][x];
}

function penalty(m: Matrix): number {
  const { size, modules } = m;
  let result = 0;
  const runPenalty = (line: boolean[]) => {
    let run = 1;
    let p = 0;
    for (let i = 1; i < line.length; i++) {
      if (line[i] === line[i - 1]) {
        run++;
        if (run === 5) p += 3;
        else if (run > 5) p++;
      } else run = 1;
    }
    // Finder-like 1:1:3:1:1 patterns with at least four light modules on one side (the border counts as light).
    const padded = `0000${line.map((d) => (d ? "1" : "0")).join("")}0000`;
    for (const pat of ["000010111010", "010111010000"]) for (let i = padded.indexOf(pat); i !== -1; i = padded.indexOf(pat, i + 1)) p += 40;
    return p;
  };
  for (let y = 0; y < size; y++) result += runPenalty(modules[y]);
  for (let x = 0; x < size; x++) result += runPenalty(modules.map((row) => row[x]));
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += 3;
    }
  const dark = modules.reduce((n, row) => n + row.filter(Boolean).length, 0);
  const total = size * size;
  result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return result;
}

/** UTF-8 bytes of `text` (no TextEncoder needed, so it runs anywhere). */
function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

export class QrTooLongError extends Error {
  constructor() {
    super("The text does not fit in a QR code of version 10");
    this.name = "QrTooLongError";
  }
}

/** The dark-module grid of `text` (level M, the smallest version that fits). Throws QrTooLongError past 213 bytes. */
export function qrGrid(text: string): QrGrid {
  const bytes = utf8(text);
  let ver = 1;
  const fits = (v: number) => 4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCodewords(v) * 8;
  while (ver <= MAX_VERSION && !fits(ver)) ver++;
  if (ver > MAX_VERSION) throw new QrTooLongError();

  const codewords = addEccAndInterleave(
    (() => {
      const bits = dataBits(bytes, ver);
      const out: number[] = [];
      for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
      return out;
    })(),
    ver,
  );
  let best: Matrix | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = drawFunctionPatterns(ver);
    drawCodewords(m, codewords);
    applyMask(m, mask);
    drawFormat(m.modules, m.isFunction, mask, m.size);
    const score = penalty(m);
    if (score < bestScore) {
      best = m;
      bestScore = score;
    }
  }
  return (best as Matrix).modules;
}

/** The SVG path of the dark modules of `grid`, offset by the quiet zone (4 modules), and the side of the viewBox. */
export function qrPath(grid: QrGrid): { d: string; side: number } {
  const quiet = 4;
  let d = "";
  grid.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }),
  );
  return { d, side: grid.length + quiet * 2 };
}

/** An inline SVG of the grid: one path, a four-module quiet zone, ink on ivory. No scripts, no external references. */
export function qrSvg(text: string, opts: { size?: number; dark?: string; light?: string; label?: string } = {}): string {
  const { d, side: n } = qrPath(qrGrid(text));
  const dark = opts.dark ?? "#14110C";
  const light = opts.light ?? "#FFFDF8";
  const px = opts.size ?? 224;
  const label = (opts.label ?? "QR").replace(/[<>&"']/g, "");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${px}" height="${px}" role="img" aria-label="${label}" shape-rendering="crispEdges">` +
    `<rect width="${n}" height="${n}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`
  );
}
