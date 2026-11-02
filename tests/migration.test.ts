import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toFixed } from '../src/decimal.ts';
import { Ledger } from '../src/ledger.ts';
import { importBarrelsCsv } from '../src/migration.ts';
import { plant, records } from '../src/scenario.ts';
import { openingEntry } from '../src/events.ts';

const csv = readFileSync(new URL('../examples/migration/legacy-barrels.csv', import.meta.url), 'utf8');
const ctx = { plant, recordedOn: '2026-09-30', asOf: '2026-09-30', source: 'legacy-barrels.csv' };

test('migration: a duplicate is recognised, a row with no unit or an unconvertible unit is rejected, totals agree', () => {
  const l = new Ledger();
  const r = importBarrelsCsv(l, csv, ctx);
  assert.deepEqual(r.booked.map((b) => b.serial), ['K-501', 'K-502', 'K-505']);
  assert.deepEqual(r.duplicates, [{ line: 5, serial: 'K-502', why: 'repeated in file' }]);
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
  assert.deepEqual(again.duplicates.map((d) => d.why), ['already imported', 'already imported', 'repeated in file', 'already imported']);
  assert.equal(toFixed(again.ledgerDelta, 1), '0.0');
  assert.ok(again.totalsAgree);
});

test('migration: quoted cells, header case, a conflicting repeat, a bad proof and a barrel already in stock, with nothing thrown and nothing half-booked', () => {
  const l = new Ledger();
  l.post(openingEntry(records.opening, { plant, recordedOn: '2026-09-30' }));
  const messy = [
    ' BARREL , Client,Quantity,Unit,Proof,Received_On,Distillation_Proof',
    '"M-1","Client, A",48.0,PG,110.0,2023-01-01,128.0',
    'M-2,house,50.0,PG,110.0,2023-01-01,128.0',
    'M-2,house,51.0,PG,110.0,2023-01-01,128.0',
    'M-3,house,47.0,PG,110.0,2023-01-01,abc',
    'A-201,client-a,49.2,PG,110.0,2023-01-01,135.0',
  ].join('\n');
  const r = importBarrelsCsv(l, messy, ctx);
  assert.deepEqual(r.booked.map((b) => b.serial), ['M-1']);
  assert.equal(l.entries.at(-1)!.postings[0]!.client, 'Client, A');
  assert.deepEqual(r.rejected.map((x) => `${x.line} ${x.serial}: ${x.why.split(':')[0]}`), [
    '3 M-2: conflicts with line 4', '4 M-2: conflicts with line 3', '5 M-3: distillation proof "abc" is not a number; column unknown', '6 A-201: already in storage (E001); not imported twice',
  ]);
  assert.deepEqual(r.duplicates, []);
  assert.ok(r.totalsAgree);
  assert.equal(toFixed(r.ledgerDelta, 1), '48.0');
});
