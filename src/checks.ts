// Named checks on a draft month. Two families:
//  - form arithmetic (line 6 = line 24 ...): prove the draft is internally consistent;
//  - comparisons with things the engine did not compute (last month as filed, the plant's
//    document register, the consignor's transfer record, the month-end count, an expected month
//    worked out by hand): these are the ones that catch a missing receipt or a wrong column.
// A failing check never changes a figure. The draft is still shown, with what to examine.
import { type Dec, dec, eq, sub, sum, toFixed, isZero } from './decimal.ts';
import { caseGauge, type CaseMethod } from './units.ts';
import { type Plant } from './model.ts';
import { Ledger } from './ledger.ts';
import { type Reports, figures } from './reports.ts';
import { type Statement, STATEMENT_ROWS } from './statements.ts';
import { type ReceiptRecord, type TransferRecord } from './events.ts';

export type Check = {
  id: string;
  rule?: string;
  title: string;
  independent: boolean; // compares with something the engine did not compute
  scenarioOnly?: boolean;
  pass: boolean;
  detail: string;
  toExamine: string[];
};

export type PriorReport = { month: string; filed: string; storage23: Record<string, string>; processing25: string; processing46: string };
export type RegisterItem = { doc: string; date: string; what: string };
export type MonthEndCount = { date: string; fullBarrels: string[]; cases: { lot: string; cases: number; bottlesPerCase: number; bottleMl: number; proof: string; method: CaseMethod }[] };
export type Expected = { note: string; figures: Record<string, string> };

const f1 = (x: Dec) => toFixed(x, 1);

export function runChecks(i: {
  ledger: Ledger; plant: Plant; reports: Reports; statements: Statement[];
  prior: PriorReport; register: RegisterItem[]; transfers: { transfer: TransferRecord; receipt: ReceiptRecord }[];
  count: MonthEndCount; expected: Expected;
}): Check[] {
  const { ledger, reports: r } = i;
  const L = (id: string) => r.line(id).value;
  const out: Check[] = [];

  // Structural
  const unbalanced = r.entries.filter((e) => !isZero(sum(e.postings.map((p) => p.pg))));
  out.push({ id: 'entries-balanced', title: 'Every entry balances to zero proof gallons', independent: false, pass: unbalanced.length === 0,
    detail: unbalanced.length ? `${unbalanced.length} entries do not balance` : `${r.entries.length} entries, each summing to 0.0 PG`, toExamine: unbalanced.map((e) => e.id) });

  // Form arithmetic
  const cols = [...new Set(r.storage.map((l) => l.col))];
  const badCols = cols.filter((c) => !eq(L(`5110.11:6:${c}`), L(`5110.11:24:${c}`)));
  out.push({ id: '5110.11-l6-l24', rule: 'CHECK_5110_11_L6_L24', title: '5110.11: line 6 equals line 24, each column', independent: false, pass: badCols.length === 0,
    detail: cols.map((c) => `(${c}) ${f1(L(`5110.11:6:${c}`))} / ${f1(L(`5110.11:24:${c}`))}`).join('; '), toExamine: badCols.map((c) => `5110.11:24:${c}`) });
  const pair = (id: string, rule: string, title: string, a: string, b: string) => {
    const ok = eq(L(a), L(b));
    out.push({ id, rule, title, independent: false, pass: ok, detail: `${f1(L(a))} / ${f1(L(b))}`, toExamine: ok ? [] : [a, b] });
  };
  pair('5110.28-l8-l26', 'CHECK_5110_28_L8_L26', '5110.28 Part I: line 8 equals line 26', '5110.28:8:c', '5110.28:26:c');
  pair('5110.28-l31-l47', 'CHECK_5110_28_L31_L47', '5110.28 Part II: line 31 equals line 47', '5110.28:31:b', '5110.28:47:b');
  pair('5110.28-l9-l28', 'CHECK_L9_EQ_L28', '5110.28: line 9 equals line 28 (b) + (c)', '5110.28:9:c', '5110.28:28:b');
  const l17 = L('5110.11:17:m');
  const l2 = L('5110.28:2:c');
  out.push({ id: 'l17-l2', rule: 'CHECK_L17_IN_L2', title: '5110.11 line 17 equals 5110.28 line 2 (true in this scenario only)', independent: false, scenarioOnly: true,
    pass: eq(l17, l2), detail: `${f1(l17)} / ${f1(l2)}`, toExamine: eq(l17, l2) ? [] : ['5110.11:17:m', '5110.28:2:c'] });

  // Independent comparisons
  const cont: [string, string, Dec][] = [
    ...Object.entries(i.prior.storage23).map(([c, v]) => [`5110.11 line 1 (${c})`, `5110.11:1:${c}`, dec(v)] as [string, string, Dec]),
    ['5110.28 line 1', '5110.28:1:c', dec(i.prior.processing25)],
    ['5110.28 line 27', '5110.28:27:b', dec(i.prior.processing46)],
  ];
  const contBad = cont.filter(([, id, v]) => !eq(L(id), v));
  out.push({ id: 'continuity', rule: 'CHECK_CONTINUITY', title: `Opening figures match the ${i.prior.month} report as filed`, independent: true, pass: contBad.length === 0,
    detail: cont.map(([n, id, v]) => `${n}: ${f1(L(id))} vs filed ${f1(v)}`).join('; '), toExamine: contBad.map(([, id]) => id) });

  const liveDocs = new Set(r.entries.filter((e) => ledger.isLive(e) && e.date >= r.period.from).map((e) => e.doc));
  const missing = i.register.filter((x) => !liveDocs.has(x.doc));
  const extra = [...liveDocs].filter((d) => !i.register.some((x) => x.doc === d));
  out.push({ id: 'register', title: 'Every record in the plant register is booked, and nothing else', independent: true, pass: missing.length === 0 && extra.length === 0,
    detail: missing.length || extra.length
      ? [...missing.map((m) => `${m.doc} (${m.what}, ${m.date}) is in the register with no approved entry`), ...extra.map((d) => `${d} is booked but not in the register`)].join('; ')
      : `${i.register.length} records in the register, ${i.register.length} booked`,
    toExamine: [...missing.map((m) => m.doc), ...extra] });

  for (const { transfer: t, receipt: rc } of i.transfers) {
    const sent = sum(t.packages.map((p) => dec(p.pg)));
    const got = sum(rc.gauge.map((g) => dec(g.pg)));
    const serialsOk = t.packages.length === rc.gauge.length && t.packages.every((p) => rc.gauge.some((g) => g.serial === p.serial));
    const booked = r.line('5110.11:2:m').contributions.filter((c) => c.doc === rc.id);
    const bookedPg = sum(booked.map((c) => c.pg));
    const ok = serialsOk && eq(bookedPg, got);
    out.push({ id: `transfer-${t.id}`, rule: 'RECEIPT_RECORD_FIELDS', title: `Transfer ${t.id}: consignor's record, receipt and ledger agree`, independent: true, pass: ok,
      detail: `${t.packages.length} barrels shipped ${t.shippedOn}, ${rc.gauge.length} received ${rc.receivedOn}; ${f1(sent)} PG shipped, ${f1(got)} PG received, ${f1(bookedPg)} PG booked${eq(sent, got) ? '' : `; difference ${f1(sub(got, sent))} PG to explain on the transfer record`}`,
      toExamine: ok ? [] : [t.id, rc.id] });
  }

  const inLedger = ledger.positions('storage', { operator: i.plant.operator, through: r.period.to }).map((x) => x.pkg!).sort();
  const counted = [...i.count.fullBarrels].sort();
  const notCounted = inLedger.filter((s) => !counted.includes(s));
  const notBooked = counted.filter((s) => !inLedger.includes(s));
  out.push({ id: 'barrel-count', title: `Barrels found full on ${i.count.date} match the barrels carried in storage`, independent: true, pass: !notCounted.length && !notBooked.length,
    detail: `${counted.length} counted, ${inLedger.length} carried${notCounted.length ? `; carried but found empty: ${notCounted.join(', ')}` : ''}${notBooked.length ? `; found full but not carried: ${notBooked.join(', ')}` : ''}`,
    toExamine: [...notCounted, ...notBooked] });

  const recount = i.count.cases.map((c) => ({ c, g: caseGauge({ ...c, proof: c.proof }) }));
  const countedPg = sum(recount.map((x) => x.g.proofGallons));
  const l46 = L('5110.28:46:b');
  out.push({ id: 'case-count', title: `Cases counted on ${i.count.date}, converted again, equal line 46`, independent: true, pass: eq(countedPg, l46),
    detail: `${recount.map(({ c, g }) => `${c.lot}: ${c.cases} cases at ${c.proof} proof = ${f1(g.proofGallons)} PG`).join('; ')}; total ${f1(countedPg)} vs line 46 ${f1(l46)}`,
    toExamine: eq(countedPg, l46) ? [] : ['5110.28:46:b'] });

  const stBad: string[] = [];
  const stDetail: string[] = [];
  for (const row of STATEMENT_ROWS) {
    if (!row.plantLine) continue;
    const tot = sum(i.statements.map((s) => s.rows.find((x) => x.key === row.key)!.pg));
    const plant = L(row.plantLine);
    if (!eq(tot, plant)) { stBad.push(row.plantLine); stDetail.push(`${row.label}: clients ${f1(tot)} vs plant ${f1(plant)}`); }
  }
  out.push({ id: 'statements', title: 'Client statements add up to the plant figures', independent: false, pass: stBad.length === 0,
    detail: stBad.length ? stDetail.join('; ') : `${i.statements.length} statements, ${STATEMENT_ROWS.length} rows each, all equal to the plant lines`, toExamine: stBad });

  const fig = figures(r);
  const diffs = Object.entries(i.expected.figures).filter(([k, v]) => fig[k] !== v);
  out.push({ id: 'expected-month', title: 'Draft matches the month worked out by hand from the records', independent: true, pass: diffs.length === 0,
    detail: diffs.length ? `${diffs.length} figures differ: ${diffs.map(([k, v]) => `${k.replace(/:/g, ' ')} draft ${fig[k] ?? 'none'}, expected ${v}`).join('; ')}` : `${Object.keys(i.expected.figures).length} figures, all equal`,
    toExamine: diffs.map(([k]) => k) });

  return out;
}
