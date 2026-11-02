import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dec, raw, toFixed } from '../src/decimal.ts';
import { caseGauge, table4Quantity, proofGallonsExact, wholeGallons, LITERS_TO_WINE_GALLONS, gaugeConsistent } from '../src/units.ts';

test('[METRIC_AFTER_MULTIPLYING] [LEDGER_PG_TENTH] 10 cases of 12 x 750 mL at 90 proof: 90 L, 23.775480, 23.78 WG, 21.402 PG, 21.4 in the ledger, 24 whole WG', () => {
  const g = caseGauge({ cases: 10, bottlesPerCase: 12, bottleMl: 750, proof: '90.0', method: 'after-multiplying' });
  assert.equal(raw(g.liters), '90');
  assert.equal(toFixed(g.wineGallonsUnrounded, 6), '23.775480');
  assert.equal(toFixed(g.wineGallons, 2), '23.78');
  assert.equal(toFixed(g.proofGallonsUnrounded, 3), '21.402');
  assert.equal(toFixed(g.proofGallons, 1), '21.4');
  assert.equal(toFixed(wholeGallons(g.wineGallons), 0), '24'); // Part IV (d) is whole wine gallons
});

test('[METRIC_FACTOR] [METRIC_PER_CASE] one case of 12 x 750 mL is 2.377548 gallons, as in the TTB conversion table', () => {
  assert.equal(raw(LITERS_TO_WINE_GALLONS), '0.264172');
  const g = caseGauge({ cases: 1, bottlesPerCase: 12, bottleMl: 750, proof: '100.0', method: 'per-case' });
  assert.equal(toFixed(g.wineGallons, 6), '2.377548');
  const ten = caseGauge({ cases: 10, bottlesPerCase: 12, bottleMl: 750, proof: '90.0', method: 'per-case' });
  assert.equal(toFixed(ten.wineGallons, 6), '23.775480'); // per-case path keeps six decimals
  assert.equal(toFixed(ten.proofGallons, 1), '21.4');
});

test('[PG_FROM_WG] at 100 proof wine and proof gallons coincide, at 90 proof they do not', () => {
  assert.equal(raw(proofGallonsExact(dec('23.78'), dec('100.0'))), '23.78');
  assert.equal(raw(proofGallonsExact(dec('23.78'), dec('90.0'))), '21.402');
});

test('[TABLE4_TENTH] the 27 CFR 30.64 example: 81,000 lb x 0.14718 = 11,921.6 WG; x 0.27964 = 22,650.8 PG', () => {
  assert.equal(toFixed(table4Quantity(dec('81000'), dec('0.14718')), 1), '11921.6');
  assert.equal(toFixed(table4Quantity(dec('81000'), dec('0.27964')), 1), '22650.8');
  assert.equal(toFixed(table4Quantity(dec('100'), dec('0.0005')), 1), '0.1'); // 0.05 is added as 0.1
  assert.equal(toFixed(table4Quantity(dec('100'), dec('0.00049')), 1), '0.0');
});

test('[LEDGER_PG_TENTH] rounding happens once, on the lot: 53 bottles of 750 mL at 100 proof', () => {
  // per lot: 39.75 L -> 10.5008 WG -> 10.50 -> 10.5 PG. Rounding each bottle first would give 53 x 0.2 = 10.6.
  const lot = caseGauge({ cases: 53, bottlesPerCase: 1, bottleMl: 750, proof: '100.0', method: 'after-multiplying' });
  assert.equal(toFixed(lot.proofGallons, 1), '10.5');
  const bottle = caseGauge({ cases: 1, bottlesPerCase: 1, bottleMl: 750, proof: '100.0', method: 'after-multiplying' });
  assert.equal(toFixed(bottle.proofGallons, 1), '0.2');
});

test('gauge plausibility catches a misread figure, not a rounding difference', () => {
  assert.ok(gaugeConsistent(dec('40.1'), dec('117.0'), dec('46.9')).ok);
  assert.ok(!gaugeConsistent(dec('40.1'), dec('117.0'), dec('48.9')).ok);
  assert.ok(!gaugeConsistent(dec('46.9'), dec('117.0'), dec('40.1')).ok); // units swapped
});
