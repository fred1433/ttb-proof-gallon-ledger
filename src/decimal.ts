// Exact decimal arithmetic on BigInt. The ledger never touches a binary float:
// 0.1 + 0.2 is 0.3 here, and every rounding step is named and explicit.
//
// A value is u / 10^s (u: bigint mantissa, s: scale >= 0).

export type Dec = { readonly u: bigint; readonly s: number };

const p10 = (n: number): bigint => 10n ** BigInt(n);

export function dec(x: string | bigint | number | Dec): Dec {
  if (typeof x === 'object') return x;
  if (typeof x === 'bigint') return { u: x, s: 0 };
  if (typeof x === 'number') {
    if (!Number.isSafeInteger(x)) throw new Error(`dec(): refusing non-integer number ${x}; pass a string`);
    return { u: BigInt(x), s: 0 };
  }
  const m = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(x.trim());
  if (!m) throw new Error(`dec(): not a decimal string: "${x}"`);
  const frac = m[3] ?? '';
  const u = BigInt((m[2] ?? '0') + frac);
  return { u: m[1] === '-' ? -u : u, s: frac.length };
}

const ZERO: Dec = { u: 0n, s: 0 };
export const zero = (): Dec => ZERO;

function align(a: Dec, b: Dec): [bigint, bigint, number] {
  const s = Math.max(a.s, b.s);
  return [a.u * p10(s - a.s), b.u * p10(s - b.s), s];
}

export function add(a: Dec, b: Dec): Dec {
  const [x, y, s] = align(a, b);
  return { u: x + y, s };
}
export function sub(a: Dec, b: Dec): Dec {
  const [x, y, s] = align(a, b);
  return { u: x - y, s };
}
export const neg = (a: Dec): Dec => ({ u: -a.u, s: a.s });
export const abs = (a: Dec): Dec => ({ u: a.u < 0n ? -a.u : a.u, s: a.s });
/** Exact product: the scale of the result is the sum of the scales. */
export const mul = (a: Dec, b: Dec): Dec => ({ u: a.u * b.u, s: a.s + b.s });
/** Exact division by 10^n (moves the decimal point). */
export const shift = (a: Dec, n: number): Dec => ({ u: a.u, s: a.s + n });

export function cmp(a: Dec, b: Dec): -1 | 0 | 1 {
  const [x, y] = align(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}
export const eq = (a: Dec, b: Dec): boolean => cmp(a, b) === 0;
export const isZero = (a: Dec): boolean => a.u === 0n;
export const sum = (xs: readonly Dec[]): Dec => xs.reduce(add, ZERO);

/**
 * Round to `places` decimals, a remaining digit of five or more adding a unit
 * (27 CFR 30.23: "if the hundredths decimal is less than five, it will be dropped;
 * if it is five or over, a unit will be added"). Halves move away from zero, so a
 * reversal (the exact negative of an entry) rounds to the exact negative.
 * This is NOT banker's rounding: 12.25 -> 12.3, 0.25 -> 0.3.
 */
export function roundHalfUp(a: Dec, places: number): Dec {
  if (a.s <= places) return { u: a.u * p10(places - a.s), s: places };
  const d = p10(a.s - places);
  const sign = a.u < 0n ? -1n : 1n;
  const m = a.u * sign;
  let q = m / d;
  if ((m % d) * 2n >= d) q += 1n;
  return { u: q * sign, s: places };
}

/** a / b rounded half up to `places` (used only for display ratios such as lot proof). */
export function divRound(a: Dec, b: Dec, places: number): Dec {
  if (b.u === 0n) throw new Error('divRound(): division by zero');
  // a/b = (a.u / 10^a.s) / (b.u / 10^b.s); compute with two guard digits then round.
  const guard = places + 2;
  const num = a.u * p10(b.s + guard);
  const den = b.u * p10(a.s);
  return roundHalfUp({ u: num / den, s: guard }, places); // truncation in guard digits only
}

/** Fixed-point string. Throws if that would drop a non-zero digit: display never rounds silently. */
export function toFixed(a: Dec, places: number): string {
  let v = a;
  if (a.s > places) {
    const r = roundHalfUp(a, places);
    if (!eq(r, a)) throw new Error(`toFixed(): ${raw(a)} has more than ${places} decimals; round it explicitly first`);
    v = r;
  }
  const u = v.u * p10(places - v.s);
  const sign = u < 0n ? '-' : '';
  const digits = (u < 0n ? -u : u).toString().padStart(places + 1, '0');
  return places === 0 ? sign + digits : `${sign}${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

/** Shortest exact string (trailing zeros removed). */
export function raw(a: Dec): string {
  let { u, s } = a;
  while (s > 0 && u % 10n === 0n) { u /= 10n; s -= 1; }
  return toFixed({ u, s }, s);
}

export const isNeg = (a: Dec): boolean => a.u < 0n;
