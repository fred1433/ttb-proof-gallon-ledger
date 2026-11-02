import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toFixed } from '../src/decimal.ts';
import { Ledger } from '../src/ledger.ts';
import { importBarrelsCsv } from '../src/migration.ts';
import { plant } from '../src/scenario.ts';

const csv = readFileSync(new URL('../examples/migration/legacy-barrels.csv', import.meta.url), 'utf8');
const ctx = { plant, recordedOn: '2026-09-30', asOf: '2026-09-30', source: 'legacy-barrels.csv' };

test('migration: a duplicate is recognised, a row with no unit or an unconvertible unit is rejected, totals agree', () => {
  const l = new Ledger();
  const r = importBarrelsCsv(l, csv, ctx);
  assert.deepEqual(r.booked.map((b) => b.serial), ['K-501', 'K-502', 'K-505']);
  assert.deepEqual(r.duplicates, [{ line: 4, serial: 'K-502', why: 'repeated in file' }]);
  assert.deepEqual(r.rejected.map((x) => `${x.serial}: ${x.why}`), ['K-503: quantity has no unit', 'K-504: unit "WG" needs a gauge to convert; not guessed']);
  assert.equal(toFixed(r.fileTotal, 1), '146.7');
  assert.equal(toFixed(r.ledgerDelta, 1), '146.7');
  assert.ok(r.totalsAgree);
});

test('migration: importing the same file again books nothing', () => {
  const l = new Ledger();
  importBarrelsCsv(l, csv, ctx);
  const n = l.entries.length;
  const again = importBarrelsCsv(l, csv, { ...ctx, recordedOn: '2026-10-01' });
  assert.equal(l.entries.length, n);
  assert.equal(again.booked.length, 0);
  assert.deepEqual(again.duplicates.map((d) => d.why), ['already in ledger', 'already in ledger', 'repeated in file', 'already in ledger']);
  assert.equal(toFixed(again.ledgerDelta, 1), '0.0');
  assert.ok(again.totalsAgree);
});
