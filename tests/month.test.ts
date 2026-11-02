import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dec, toFixed } from '../src/decimal.ts';
import { Ledger } from '../src/ledger.ts';
import { buildReports, figures } from '../src/reports.ts';
import { dumpEntry, bottlingEntry, openingEntry, removalEntry } from '../src/events.ts';
import { buildStatements } from '../src/statements.ts';
import { correct, approve } from '../src/review.ts';
import { buildMonth, bookRecords, evaluate, initialDraft, expected, period, plant, records, prior } from '../src/scenario.ts';
import { runChecks } from '../src/checks.ts';
import { register, monthEndCount } from '../src/scenario.ts';

const approvedDraft = () => {
  const l = bookRecords();
  let d = correct(initialDraft(), { 'rows.1.proof': '117.0', 'rows.1.pg': '46.9' }, 'reviewer', '2026-11-02');
  const r = approve(d, 'reviewer', '2026-11-02', { ledger: l, plant });
  assert.ok(r.ok);
  return r.draft;
};
const failing = (m: ReturnType<typeof buildMonth>) => m.checks.filter((c) => !c.pass).map((c) => c.id).sort();

test('the demo month, every record booked, equals the month worked out by hand (fixtures/2026-10/expected.json)', () => {
  const m = buildMonth(approvedDraft());
  const fig = figures(m.reports);
  for (const [k, v] of Object.entries(expected.figures)) assert.equal(fig[k], v, k);
  assert.deepEqual(failing(m), []);
});

test('with the gauge sheet unreviewed, the draft still shows, and the independent checks say what is missing', () => {
  const m = buildMonth();
  assert.equal(figures(m.reports)['5110.11:17:b'], '131.4');
  assert.deepEqual(failing(m), ['barrel-count', 'expected-month', 'register']);
  const reg = m.checks.find((c) => c.id === 'register')!;
  assert.deepEqual(reg.toExamine, ['DR-1028']);
  assert.deepEqual(m.checks.find((c) => c.id === 'barrel-count')!.toExamine, ['B-301', 'B-302']);
  // the form arithmetic passes: a balanced draft can still be incomplete
  for (const id of ['5110.11-l6-l24', '5110.28-l8-l26', '5110.28-l31-l47', '5110.28-l9-l28']) assert.ok(m.checks.find((c) => c.id === id)!.pass, id);
});

test('[CHECK_5110_11_L6_L24] [CHECK_5110_28_L8_L26] [CHECK_5110_28_L31_L47] [CHECK_L9_EQ_L28] totals agree on the demo month', () => {
  const r = buildMonth(approvedDraft()).reports;
  const v = (id: string) => toFixed(r.line(id).value, 1);
  assert.equal(v('5110.11:6:b'), v('5110.11:24:b'));
  assert.equal(v('5110.28:8:c'), v('5110.28:26:c'));
  assert.equal(v('5110.28:31:b'), v('5110.28:47:b'));
  assert.equal(v('5110.28:9:c'), v('5110.28:28:b'));
});

test('[CHECK_5110_11_L6_L24] a storage movement with no report line breaks line 6 = line 24', () => {
  const l = bookRecords();
  const e = l.entries.find((x) => x.doc === 'RC-1006')!;
  l.post({ ...e, doc: 'X-1', kind: 'migration', date: '2026-10-07', memo: 'unmapped movement' });
  const m = evaluate(l);
  assert.ok(!m.checks.find((c) => c.id === '5110.11-l6-l24')!.pass);
});

test('[CHECK_CONTINUITY] an opening that differs from last month as filed is reported', () => {
  const m = buildMonth(approvedDraft());
  const c = runChecks({ ...m, plant, prior: { ...prior, processing46: '57.2' }, register, transfers: records.transfers, count: monthEndCount, expected });
  const k = c.find((x) => x.id === 'continuity')!;
  assert.ok(!k.pass);
  assert.deepEqual(k.toExamine, ['5110.28:27:b']);
});

test('[CHECK_L17_IN_L2] line 17 = line 2 is marked as true for this scenario only', () => {
  const k = buildMonth(approvedDraft()).checks.find((c) => c.id === 'l17-l2')!;
  assert.ok(k.pass && k.scenarioOnly);
});

test('[LOSS_AT_DUMP] storage losses appear only on dumps; barrels still in storage carry no loss', () => {
  const r = buildMonth(approvedDraft()).reports;
  const l22 = r.line('5110.11:22:b');
  assert.ok(l22.contributions.every((c) => c.kind === 'dump'));
  assert.deepEqual(l22.contributions.map((c) => `${c.pkg}:${toFixed(c.pg, 1)}`), ['A-201:4.9', 'A-202:4.8', 'A-203:4.8', 'B-301:4.5', 'B-302:4.4']);
  assert.equal(toFixed(l22.value, 1), '23.4');
});

test('[BOTTLING_LOSS_PART_I] line 9 is what was bottled; the remainder of the lot is a Part I loss', () => {
  const r = buildMonth(approvedDraft()).reports;
  assert.equal(toFixed(r.line('5110.28:9:c').value, 1), '130.5');
  assert.equal(toFixed(r.line('5110.28:24:c').value, 1), '0.9');
});

test('[PART_IV_WHOLE_AFTER_SUM] [PART_IV_B_FIRST_DUMP] Part IV adds the lots, then rounds: 40.4 + 38.4 = 78.8 -> 79, not 40 + 38', () => {
  const l = new Ledger();
  const ctx = { plant, recordedOn: '2026-10-01' };
  l.post(openingEntry({ id: 'OB', date: '2026-09-30', source: 'test', bottled: [], barrels: [
    { serial: 'X1', client: 'house', pg: '44.0', distilledAtProof: '130.0', receivedOn: '2025-01-01', from: 'test' },
    { serial: 'X2', client: 'house', pg: '41.0', distilledAtProof: '130.0', receivedOn: '2025-01-01', from: 'test' },
  ] }, ctx));
  l.post(dumpEntry({ id: 'D1', date: '2026-10-03', lot: 'L1', tank: 't', gauger: 'g', barrels: [{ serial: 'X1', proof: '110.0', wg: '36.7', pg: '40.4' }] }, l, ctx));
  l.post(dumpEntry({ id: 'D2', date: '2026-10-04', lot: 'L2', tank: 't', gauger: 'g', barrels: [{ serial: 'X2', proof: '110.0', wg: '34.9', pg: '38.4' }] }, l, ctx));
  const iv = buildReports(l, period).line('5110.28:55:b');
  assert.equal(toFixed(iv.unrounded!, 1), '78.8');
  assert.equal(toFixed(iv.value, 0), '79');
  assert.equal(iv.unit, 'whole PG');
});

test('[NO_BOTTLED_IN_BOND_INFERENCE] a 100 proof bottling goes to Part IV (d) unless its record says bottled in bond', () => {
  const run = (bib: boolean) => {
    const l = new Ledger();
    const ctx = { plant, recordedOn: '2026-10-01' };
    l.post(openingEntry({ id: 'OB', date: '2026-09-30', source: 'test', bottled: [], barrels: [{ serial: 'X1', client: 'house', pg: '30.0', distilledAtProof: '125.0', receivedOn: '2020-01-01', from: 'test' }] }, ctx));
    l.post(dumpEntry({ id: 'D1', date: '2026-10-03', lot: 'L1', tank: 't', gauger: 'g', barrels: [{ serial: 'X1', proof: '100.0', wg: '24.0', pg: '24.0' }] }, l, ctx));
    l.post(bottlingEntry({ id: 'B1', date: '2026-10-04', lot: 'L1', cases: 10, bottlesPerCase: 12, bottleMl: 750, proof: '100.0', method: 'after-multiplying', bottledInBond: bib, forExport: false, label: 't' }, l, ctx));
    const r = buildReports(l, period);
    return [toFixed(r.line('5110.28:55:d').value, 0), toFixed(r.line('5110.28:55:e').value, 0)];
  };
  assert.deepEqual(run(false), ['24', '0']);
  assert.deepEqual(run(true), ['0', '24']);
});

test('[COLUMN_FROM_DISTILLATION_PROOF] right quantity, wrong column: the totals still balance, the hand-worked month does not', () => {
  const l = new Ledger();
  const ctx = { plant, recordedOn: '2026-10-01' };
  const o = structuredClone(records.opening);
  o.barrels[0]!.distilledAtProof = '165.0'; // keyed wrongly
  l.post(openingEntry(o, ctx));
  const m = evaluate(l);
  assert.equal(toFixed(m.reports.line('5110.11:1:c').value, 1), '49.2');
  assert.ok(m.checks.find((c) => c.id === '5110.11-l6-l24')!.pass, 'balanced per column');
  const k = m.checks.find((c) => c.id === 'expected-month')!;
  assert.ok(!k.pass);
  assert.ok(k.toExamine.includes('5110.11:1:b'));
});

test('[REMOVAL_REGIME_EXPLICIT] a removal is booked only under the regime its record states; nothing is inferred', () => {
  const l = bookRecords();
  const r = { ...records.removals[0]!, id: 'RM-X', regime: 'transfer-in-bond' };
  assert.throws(() => l.post(removalEntry(r, l, { plant, recordedOn: '2026-10-30' })), /outside this prototype/);
});

test('[OPERATOR_OWN_RECORDS] entries of another operator never reach this operator\'s report', () => {
  const l = bookRecords();
  const other = { ...plant, operator: 'DSP-KY-00002', plantNumber: 'DSP-KY-00002' };
  l.post(openingEntry({ ...records.opening, id: 'OB-OTHER' }, { plant: other, recordedOn: '2026-10-01' }));
  const a = figures(evaluate(l).reports);
  const b = figures(evaluate(bookRecords()).reports);
  assert.deepEqual(a, b);
  assert.equal(toFixed(buildReports(l, { ...period, operator: 'DSP-KY-00002' }).line('5110.11:1:b').value, 1), '345.7');
});

test('an operation for one client changes that client\'s statement only', () => {
  const before = buildMonth().statements;
  const after = buildMonth(approvedDraft()).statements;
  const show = (s: typeof before, id: string) => JSON.stringify(s.find((x) => x.client === id)!.rows.map((r) => toFixed(r.pg, 1)));
  assert.equal(show(before, 'client-a'), show(after, 'client-a'));
  assert.equal(show(before, 'house'), show(after, 'house'));
  assert.notEqual(show(before, 'client-b'), show(after, 'client-b'));
  const b = after.find((x) => x.client === 'client-b')!;
  assert.equal(toFixed(b.rows.find((r) => r.key === 'bulk.close')!.pg, 1), '95.0');
});

test('client statements are filters of the same postings: they add up to the plant lines without copies', () => {
  const m = buildMonth(approvedDraft());
  assert.ok(m.checks.find((c) => c.id === 'statements')!.pass);
  const sts = buildStatements(m.ledger, period, plant);
  const removed = sts.map((s) => s.rows.find((r) => r.key === 'removed')!);
  assert.deepEqual(removed.map((r) => r.cases), [40, undefined, 10]);
});

test('the case count catches a removal keyed with the wrong number of cases', () => {
  const run = (cases: number) => {
    const l = new Ledger();
    const ctx = { plant, recordedOn: '2026-10-01' };
    l.post(openingEntry(records.opening, ctx));
    l.post(removalEntry({ ...records.removals[1]!, cases }, l, ctx));
    const m = evaluate(l);
    const count = { ...monthEndCount, cases: monthEndCount.cases.filter((c) => c.lot === 'H-0925') };
    return runChecks({ ...m, plant, prior, register, transfers: records.transfers, count, expected }).find((c) => c.id === 'case-count')!.pass;
  };
  assert.equal(run(10), true);
  assert.equal(run(12), false);
});

test('figures stay the same when computed twice (deterministic)', () => {
  assert.deepEqual(figures(buildMonth().reports), figures(buildMonth().reports));
  assert.equal(dec('1').s, 0);
});

test('[RECEIPT_RECORD_FIELDS] a transfer shipped at 214.0 PG, received and booked at 204.0, needs review and names both records', () => {
  const m = buildMonth(approvedDraft());
  const t0 = records.transfers[0]!;
  const shipped = { ...t0.transfer, packages: t0.transfer.packages.map((p, i) => (i === 0 ? { ...p, pg: '61.4' } : p)) };
  const c = runChecks({ ...m, plant, prior, register, transfers: [{ transfer: shipped, receipt: t0.receipt }], count: monthEndCount, expected });
  const k = c.find((x) => x.id === 'transfer-TR-0457')!;
  assert.ok(!k.pass);
  assert.deepEqual(k.toExamine, ['TR-0457', 'RC-1006']);
  assert.match(k.detail, /214\.0 PG shipped, 204\.0 PG received, 204\.0 PG booked/);
});

test('[CHECK_L9_EQ_L28] line 9 is compared with line 28 (b) plus line 28 (c)', () => {
  const m = buildMonth(approvedDraft());
  assert.equal(toFixed(m.reports.line('5110.28:28:c').value, 1), '0.0');
  assert.equal(m.checks.find((c) => c.id === '5110.28-l9-l28')!.detail, '130.5 / 130.5 + 0.0');
});
