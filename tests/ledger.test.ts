import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { dec, neg, eq, isZero, sum, raw, roundHalfUp, type Dec } from '../src/decimal.ts';
import { Ledger, LedgerError } from '../src/ledger.ts';
import { type Entry, type NewEntry, type Posting } from '../src/model.ts';
import { receiptEntry } from '../src/events.ts';
import { plant, records, bookRecords } from '../src/scenario.ts';

const p = (account: Posting['account'], pg: string, lot = 'L1', pkg?: string): Posting => ({ account, pg: dec(pg), lot, pkg, client: 'house', owner: plant.titleHolder, category: 'whisky-160-and-under' });
const entry = (doc: string, postings: Posting[], over: Partial<NewEntry> = {}): NewEntry => ({
  kind: 'receipt-in-bond', operator: plant.operator, date: '2026-10-02', recordedOn: '2026-10-02', doc, docVersion: 1, origin: 'record', memo: doc, postings, ...over,
});
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e) { return e instanceof LedgerError ? e.code : String(e); } };

test('an entry that does not sum to zero is refused', () => {
  const l = new Ledger();
  assert.equal(code(() => l.post(entry('X1', [p('storage', '10.0', 'B1', 'B1'), p('in.transfer-in-bond', '-9.9', 'B1', 'B1')]))), 'unbalanced');
  assert.equal(l.entries.length, 0);
});

test('[LEDGER_PG_TENTH] a quantity finer than a tenth is refused at the door', () => {
  const l = new Ledger();
  assert.equal(code(() => l.post(entry('X2', [p('storage', '21.402', 'B1', 'B1'), p('in.transfer-in-bond', '-21.402', 'B1', 'B1')]))), 'precision');
});

test('a receipt imported twice is booked once', () => {
  const l = new Ledger();
  const t = records.transfers[0]!;
  l.post(receiptEntry(t.transfer, t.receipt, { plant, recordedOn: '2026-10-06' }));
  assert.equal(code(() => l.post(receiptEntry(t.transfer, t.receipt, { plant, recordedOn: '2026-10-07' }))), 'duplicate');
  assert.equal(raw(l.balance('storage', { operator: plant.operator })), '204');
});

test('[RECEIPT_RECORD_FIELDS] a receipt whose packages differ from the consignor\'s record is refused', () => {
  const t = records.transfers[0]!;
  const r = { ...t.receipt, gauge: t.receipt.gauge.slice(0, 3) };
  assert.equal(code(() => new Ledger().post(receiptEntry(t.transfer, r, { plant, recordedOn: '2026-10-06' }))), 'package-mismatch');
  const other = { ...t.transfer, consignee: { name: 'x', plant: 'DSP-KY-99999' } };
  assert.equal(code(() => new Ledger().post(receiptEntry(other, t.receipt, { plant, recordedOn: '2026-10-06' }))), 'wrong-consignee');
});

test('no barrel or lot can go below zero', () => {
  const l = new Ledger();
  l.post(entry('R1', [p('storage', '50.0', 'B1', 'B1'), p('in.transfer-in-bond', '-50.0', 'B1', 'B1')]));
  assert.equal(code(() => l.post(entry('D1', [p('storage', '-60.0', 'B1', 'B1'), p('processing.bulk', '60.0', 'L1')], { kind: 'dump' }))), 'negative-position');
});

test('[CORRECTION_BY_REVERSAL] a reversal is the exact negative, linked, and cannot be applied twice', () => {
  const l = bookRecords();
  const v1 = l.entries.find((e) => e.doc === 'RM-1020' && e.docVersion === 1)!;
  const rev = l.entries.find((e) => e.reverses === v1.id)!;
  assert.ok(rev, 'the October 20 removal keyed as 12 cases is reversed');
  assert.equal(rev.date, v1.date);
  assert.equal(rev.recordedOn, '2026-10-21');
  rev.postings.forEach((q, i) => assert.ok(eq(q.pg, neg(v1.postings[i]!.pg))));
  assert.equal(l.reversedBy(v1.id), rev.id);
  assert.equal(code(() => l.reverse(v1.id, { recordedOn: '2026-10-22', reason: 'again' })), 'already-reversed');
  assert.equal(code(() => l.reverse(rev.id, { recordedOn: '2026-10-22', reason: 'undo' })), 'reverse-reversal');
  assert.ok(l.entries.some((e) => e.doc === 'RM-1020' && e.docVersion === 2 && l.isLive(e)));
});

// Property: random receipts, dumps and reversals keep every entry at zero and
// reversing everything brings every balance back to zero exactly.
test('[CORRECTION_BY_REVERSAL] property: any sequence balances, and reversing it restores every balance', () => {
  const qty = fc.integer({ min: 1, max: 900 }).map((n) => ({ u: BigInt(n), s: 1 }) as Dec);
  const op = fc.record({ barrel: fc.integer({ min: 0, max: 4 }), qty, dumpShare: fc.integer({ min: 0, max: 100 }), dump: fc.boolean() });
  fc.assert(fc.property(fc.array(op, { minLength: 1, maxLength: 25 }), (ops) => {
    const l = new Ledger();
    let n = 0;
    for (const o of ops) {
      const s = `B${o.barrel}`;
      const bal = roundHalfUp(l.balance('storage', { operator: plant.operator, pkg: s }), 1); // exact: same value at scale 1
      if (o.dump && !isZero(bal)) {
        const moved = { u: (bal.u * BigInt(o.dumpShare)) / 100n, s: 1 } as Dec;
        const loss = { u: bal.u - moved.u, s: 1 } as Dec;
        const ps = [p('storage', raw(neg(bal)), s, s), p('processing.bulk', raw(moved), `LOT${o.barrel}`)];
        if (!isZero(loss)) ps.push(p('loss.storage', raw(loss), `LOT${o.barrel}`));
        l.post(entry(`D${n++}`, ps, { kind: 'dump' }));
      } else {
        l.post(entry(`R${n++}`, [p('storage', raw(o.qty), s, s), p('in.transfer-in-bond', raw(neg(o.qty)), s, s)]));
      }
    }
    for (const e of l.entries) if (!isZero(sum(e.postings.map((x) => x.pg)))) return false;
    for (const e of [...l.entries].reverse()) if (!e.reverses) l.reverse(e.id, { recordedOn: '2026-10-31', reason: 'property test' });
    for (const a of ['storage', 'processing.bulk', 'loss.storage', 'in.transfer-in-bond'] as const) {
      if (!isZero(l.balance(a, { operator: plant.operator }))) return false;
    }
    return true;
  }), { numRuns: 300 });
});

test('entries handed out are frozen copies: a caller cannot rewrite the ledger', () => {
  const l = bookRecords();
  const e = l.entries[1]!;
  assert.throws(() => { (e.postings[0] as { pg: unknown }).pg = dec('999.9'); }, TypeError);
  assert.throws(() => { (l.entries as Entry[]).push(e as Entry); }, TypeError);
  assert.equal(raw(l.entries[1]!.postings[0]!.pg), raw(e.postings[0]!.pg));
  assert.deepEqual(l.clone().entries.map((x) => x.id), l.entries.map((x) => x.id));
});
