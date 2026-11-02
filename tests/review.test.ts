import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toFixed } from '../src/decimal.ts';
import { figures } from '../src/reports.ts';
import { approve, approveAndBook, correct, issues, latest, loadExtraction, syncDraft, isApprovedLatest } from '../src/review.ts';
import { bookRecords, buildMonth, evaluate, extraction, initialDraft, plant } from '../src/scenario.ts';

const ctx = () => ({ ledger: bookRecords(), plant });
const fixed = () => correct(initialDraft(), { 'rows.1.proof': '117.0', 'rows.1.pg': '46.9' }, 'reviewer', '2026-11-02');
const l17 = (m: ReturnType<typeof evaluate>) => figures(m.reports)['5110.11:17:b'];

test('[APPROVED_VERSION_ONLY] an extracted entry that nobody approved contributes to no line', () => {
  const m = buildMonth(initialDraft());
  assert.equal(l17(m), '131.4');
  assert.ok(!m.ledger.entries.some((e) => e.doc === 'DR-1028'));
  for (const l of [...m.reports.storage, ...m.reports.processing, ...m.reports.partIV]) {
    assert.ok(l.contributions.every((c) => c.doc !== 'DR-1028'), `${l.form} ${l.line}`);
  }
});

test('[APPROVED_VERSION_ONLY] a missing proof blocks approval; then a figure that does not fit the gauge; then the sheet total', () => {
  const c = ctx();
  const r1 = approve(initialDraft(), 'reviewer', '2026-11-02', c);
  assert.ok(!r1.ok);
  assert.deepEqual(r1.ok ? [] : r1.issues.map((i) => i.code), ['missing']);
  const d2 = correct(initialDraft(), { 'rows.1.proof': '117.0' }, 'reviewer', '2026-11-02');
  assert.deepEqual(issues(d2, c).map((i) => i.code), ['inconsistent', 'total']);
  assert.deepEqual(issues(fixed(), c), []);
});

test('[APPROVED_VERSION_ONLY] a column without its unit blocks approval', () => {
  const d = correct(fixed(), { 'unit.pg': null }, 'reviewer', '2026-11-02');
  assert.deepEqual(issues(d, ctx()).map((i) => i.field), ['unit.pg']);
});

test('[APPROVED_VERSION_ONLY] approval names a version; approving twice books one entry', () => {
  const c = ctx();
  const r = approve(fixed(), 'reviewer', '2026-11-02', c);
  assert.ok(r.ok && !r.already);
  assert.equal(r.draft.approval!.v, 2);
  const again = approve(r.draft, 'reviewer', '2026-11-02', c);
  assert.ok(again.ok && again.already);
  const l = bookRecords();
  syncDraft(l, again.draft, { plant, recordedOn: '2026-11-02' });
  syncDraft(l, again.draft, { plant, recordedOn: '2026-11-02' });
  assert.equal(l.entries.filter((e) => e.doc === 'DR-1028').length, 1);
  assert.equal(l17(evaluate(l)), '226.4');
  const e = l.entries.find((x) => x.doc === 'DR-1028')!;
  assert.equal(e.origin, 'reviewed-extraction');
  assert.equal(e.docVersion, 2);
  assert.equal(e.approvedBy, 'reviewer');
});

test('[APPROVED_VERSION_ONLY] an edit after approval withdraws it and reverses the entry; a new approval books the new version', () => {
  const c = ctx();
  const l = bookRecords();
  const a = approve(fixed(), 'reviewer', '2026-11-02', c);
  assert.ok(a.ok);
  syncDraft(l, a.draft, { plant, recordedOn: '2026-11-02' });
  const edited = correct(a.draft, { tank: 'Processing tank 3' }, 'reviewer', '2026-11-03');
  assert.equal(edited.approval, null);
  assert.equal(latest(edited).v, 3);
  assert.equal(edited.history.at(-2)!.action, 'approval withdrawn');
  const s = syncDraft(l, edited, { plant, recordedOn: '2026-11-03' });
  assert.equal(s.reversed!.length, 1);
  assert.equal(l17(evaluate(l)), '131.4');
  const b = approve(edited, 'reviewer', '2026-11-03', { ledger: l, plant });
  assert.ok(b.ok && isApprovedLatest(b.draft));
  syncDraft(l, b.draft, { plant, recordedOn: '2026-11-03' });
  assert.equal(l17(evaluate(l)), '226.4');
  assert.deepEqual(l.entries.filter((e) => e.doc === 'DR-1028').map((e) => `${e.docVersion}${e.reverses ? 'r' : ''}${l.isLive(e) ? '' : 'x'}`), ['2x', '2rx', '3']);
});

test('a record approved in November for a dump on October 28 counts in October', () => {
  const a = approve(fixed(), 'reviewer', '2026-11-02', ctx());
  assert.ok(a.ok);
  const m = buildMonth(a.draft, '2026-11-02');
  const e = m.ledger.entries.find((x) => x.doc === 'DR-1028')!;
  assert.equal(e.date, '2026-10-28');
  assert.equal(e.recordedOn, '2026-11-02');
  assert.equal(toFixed(m.reports.line('5110.28:25:c').value, 1), '95.0');
});

test('the extraction proposes values only: a record that tries to set an account or a report line is refused', () => {
  const bad = { ...extraction, fields: [...extraction.fields, { key: 'line', value: '5110.11:17', box: [0, 0, 1, 1] as [number, number, number, number] }] };
  assert.throws(() => loadExtraction(bad), /may not set: line/);
  assert.throws(() => correct(initialDraft(), { account: 'storage' }, 'reviewer', '2026-11-02'), /cannot be set/);
});

test('the simulated extraction says what it is and what was seeded', () => {
  assert.match(extraction.how, /Simulated extraction with two seeded errors/);
  assert.match(extraction.how, /No model runs on this page/);
  assert.match(extraction.how, /illustrative/);
  assert.match(extraction.seeded, /two errors/);
});

const codes = (changes: Record<string, string | null>) => issues(correct(fixed(), changes, 'reviewer', '2026-11-02'), ctx()).map((i) => `${i.field ?? ''}:${i.code}`);

test('[APPROVED_VERSION_ONLY] the sheet total is checked as a figure, then against the rows: 950, text, a wrong WG total', () => {
  assert.deepEqual(codes({ 'total.pg': '950' }), ['total.pg:format']);
  assert.deepEqual(codes({ 'total.pg': 'ninety-five' }), ['total.pg:format']);
  assert.deepEqual(codes({ 'total.pg': '95.1' }), ['total.pg:total']);
  assert.deepEqual(codes({ 'total.wg': '99.9' }), ['total.wg:total']);
  assert.deepEqual(codes({ 'total.wg': null }), ['total.wg:missing']);
  const r = approve(correct(fixed(), { 'total.pg': '950' }, 'reviewer', '2026-11-02'), 'reviewer', '2026-11-02', ctx());
  assert.ok(!r.ok);
});

test('[APPROVED_VERSION_ONLY] a sheet the ledger would refuse cannot be approved: repeated barrel, barrel out of stock, other client, existing lot', () => {
  assert.ok(codes({ 'rows.1.serial': 'B-301' }).includes('rows.1.serial:repeated'));
  assert.ok(codes({ 'rows.1.serial': 'A-201' }).includes('rows.1.serial:not-in-storage')); // dumped on October 9
  assert.deepEqual(codes({ 'rows.1.serial': 'H-101' }), [':mixed-clients']);
  assert.deepEqual(codes({ lot: 'A-1009' }), ['lot:lot-taken']);
  // dated before A-201 was dumped: in stock that day, but the later dump makes the booking impossible
  assert.deepEqual(codes({ date: '2026-10-05', 'rows.0.serial': 'A-201', 'rows.1.serial': 'A-202' }).map((c) => c.split(':')[1]), ['negative-position']);
});

test('[APPROVED_VERSION_ONLY] approval and booking are one step: if the ledger refuses, nothing is approved and nothing is booked', () => {
  const l = bookRecords();
  const n = l.entries.length;
  const bad = correct(fixed(), { 'rows.1.serial': 'H-101' }, 'reviewer', '2026-11-02');
  const r = approveAndBook(l, bad, 'reviewer', '2026-11-02', { plant });
  assert.ok(!r.ok);
  assert.equal(r.draft.approval, null);
  assert.equal(l.entries.length, n);
  const good = approveAndBook(l, fixed(), 'reviewer', '2026-11-02', { plant });
  assert.ok(good.ok && good.posted);
  assert.equal(l17(evaluate(l)), '226.4');
});
