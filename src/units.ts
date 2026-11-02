// Unit conversions, each with the rounding its source prescribes. See src/rules.ts.
import { type Dec, dec, mul, shift, roundHalfUp, sub, abs, cmp } from './decimal.ts';

/** [METRIC_FACTOR] 27 CFR 19.582 */
export const LITERS_TO_WINE_GALLONS: Dec = dec('0.264172');

/** [PROOF_TENTH] 27 CFR 30.31(a), 30.23 */
export const roundProof = (p: Dec): Dec => roundHalfUp(p, 1);

/** [TABLE4_TENTH] 27 CFR 30.64: net weight (lb) x Table 4 factor, to the first decimal.
 *  The factor is read from TTB Table 4 by the gauger; this prototype does not embed the table. */
export const table4Quantity = (netPounds: Dec, factorPerPound: Dec): Dec => roundHalfUp(mul(netPounds, factorPerPound), 1);

/** [PG_FROM_WG] 27 CFR 30.52, exact (no rounding). */
export const proofGallonsExact = (wineGallons: Dec, proof: Dec): Dec => shift(mul(wineGallons, proof), 2);

/** [LEDGER_PG_TENTH] assumption: the ledger carries proof gallons to the tenth. */
export const ledgerPG = (pg: Dec): Dec => roundHalfUp(pg, 1);

export type CaseMethod = 'per-case' | 'after-multiplying';

export type CaseGauge = {
  cases: number;
  bottlesPerCase: number;
  bottleMl: number;
  proof: Dec;
  method: CaseMethod;
  liters: Dec; // total liters
  wineGallonsUnrounded: Dec;
  wineGallons: Dec; // after the 19.582 rounding of the chosen method
  proofGallonsUnrounded: Dec;
  proofGallons: Dec; // ledger precision (tenth)
};

/** Gauge of cased metric bottles of one proof. */
export function caseGauge(o: { cases: number; bottlesPerCase: number; bottleMl: number; proof: Dec | string; method: CaseMethod }): CaseGauge {
  const proof = dec(o.proof);
  if (!Number.isInteger(o.cases) || o.cases < 0) throw new Error('cases must be a whole number >= 0');
  const litersPerCase = shift(dec(o.bottleMl * o.bottlesPerCase), 3);
  const liters = mul(litersPerCase, dec(o.cases));
  let wgRaw: Dec;
  let wg: Dec;
  if (o.method === 'per-case') {
    // [METRIC_PER_CASE] 19.582(a): convert one case, round to the sixth decimal, then multiply.
    const perCase = roundHalfUp(mul(litersPerCase, LITERS_TO_WINE_GALLONS), 6);
    wgRaw = mul(perCase, dec(o.cases));
    wg = wgRaw;
  } else {
    // [METRIC_AFTER_MULTIPLYING] 19.582(b): multiply first, convert, round to the hundredth.
    wgRaw = mul(liters, LITERS_TO_WINE_GALLONS);
    wg = roundHalfUp(wgRaw, 2);
  }
  const pgRaw = proofGallonsExact(wg, proof);
  return {
    cases: o.cases, bottlesPerCase: o.bottlesPerCase, bottleMl: o.bottleMl, proof, method: o.method,
    liters, wineGallonsUnrounded: wgRaw, wineGallons: wg, proofGallonsUnrounded: pgRaw, proofGallons: ledgerPG(pgRaw),
  };
}

/** Whole gallons for Part IV, half up. */
export const wholeGallons = (x: Dec): Dec => roundHalfUp(x, 0);

/** Gauge plausibility: |PG - WG x proof / 100| within `tol`. Catches swapped units or a misread
 *  figure; it does not prove a gauge right. Used on reviewed extractions. */
export function gaugeConsistent(wg: Dec, proof: Dec, pg: Dec, tol: Dec = dec('0.2')): { ok: boolean; expected: Dec; gap: Dec } {
  const expected = proofGallonsExact(wg, proof);
  const gap = abs(sub(pg, expected));
  return { ok: cmp(gap, tol) <= 0, expected, gap };
}
