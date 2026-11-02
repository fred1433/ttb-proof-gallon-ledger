import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { dec, add, sub, mul, neg, roundHalfUp, toFixed, eq, raw, divRound } from '../src/decimal.ts';

test('[PROOF_TENTH] half up, not half even: 12.25 -> 12.3, 0.25 -> 0.3, 12.35 -> 12.4', () => {
  assert.equal(toFixed(roundHalfUp(dec('12.25'), 1), 1), '12.3');
  assert.equal(toFixed(roundHalfUp(dec('0.25'), 1), 1), '0.3');
  assert.equal(toFixed(roundHalfUp(dec('12.35'), 1), 1), '12.4');
  assert.equal(toFixed(roundHalfUp(dec('12.249'), 1), 1), '12.2');
});

test('[PROOF_TENTH] the worked example of 27 CFR 30.23: 189.972 -> 190.0', () => {
  const p = sub(add(dec('189.1'), dec('0.902')), dec('0.03'));
  assert.equal(raw(p), '189.972');
  assert.equal(toFixed(roundHalfUp(p, 1), 1), '190.0');
});

test('binary floats get these wrong; the ledger never uses them', () => {
  assert.notEqual(0.1 + 0.2, 0.3);
  assert.equal((1.005).toFixed(2), '1.00'); // float 1.005 is 1.00499999...
  assert.equal(toFixed(roundHalfUp(dec('1.005'), 2), 2), '1.01');
  assert.ok(eq(add(dec('0.1'), dec('0.2')), dec('0.3')));
  assert.throws(() => dec(0.1), /non-integer/);
});

test('rounding is symmetric, so a reversal rounds to the exact negative', () => {
  fc.assert(fc.property(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), fc.integer({ min: 0, max: 6 }), fc.integer({ min: 0, max: 4 }), (u, s, places) => {
    const x = { u, s };
    return eq(roundHalfUp(neg(x), places), neg(roundHalfUp(x, places)));
  }), { numRuns: 500 });
});

test('addition is exact: (a + b) - b = a, and sums do not depend on order', () => {
  const d = fc.record({ u: fc.bigInt({ min: -(10n ** 9n), max: 10n ** 9n }), s: fc.integer({ min: 0, max: 4 }) });
  fc.assert(fc.property(d, d, d, (a, b, c) => eq(sub(add(a, b), b), a) && eq(add(add(a, b), c), add(a, add(b, c)))), { numRuns: 500 });
});

test('display never rounds silently', () => {
  assert.throws(() => toFixed(dec('21.402'), 1), /round it explicitly/);
  assert.equal(toFixed(dec('21.4'), 2), '21.40');
  assert.equal(raw(mul(dec('23.78'), dec('0.9'))), '21.402');
  assert.equal(toFixed(divRound(dec('131.4'), dec('114.6'), 3), 3), '1.147');
});
