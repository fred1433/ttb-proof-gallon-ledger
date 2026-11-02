// Ledger -> draft review worksheet for TTB F 5110.11 (storage) and TTB F 5110.28 (processing).
// Line numbers and labels follow the forms as printed (5110.11 rev. 01/2009, 5110.28 rev. 03/2016).
// This is a review worksheet, not the official form: no header, signature or filing.
// Every figure keeps the list of postings it was added from, so a reviewer can open it.
import { type Dec, add, sum, zero, toFixed } from './decimal.ts';
import { wholeGallons } from './units.ts';
import { type Account, type Category, type Entry, type EntryKind, type Posting } from './model.ts';
import { Ledger, fingerprint } from './ledger.ts';

export type Contribution = {
  entryId: string;
  doc: string;
  docVersion: number;
  date: string;
  kind: EntryKind | 'balance';
  memo: string;
  lot: string;
  pkg?: string;
  client: string;
  pg: Dec;
  wg?: Dec;
  reversal: boolean;
  reversed: boolean;
};

export type Line = {
  form: '5110.11' | '5110.28';
  part: 'storage' | 'I' | 'II' | 'IV';
  line: string; // "17", "55"
  col: string; // "b", "c", "m", "d"
  label: string; // as printed on the form
  unit: 'PG' | 'whole PG' | 'whole WG';
  value: Dec;
  unrounded?: Dec; // Part IV: the month total before whole-gallon rounding
  contributions: Contribution[];
  derivedFrom?: string[]; // total lines: the line ids they add up
  rule?: string;
};

export type Period = { operator: string; from: string; to: string };

export const STORAGE_LABELS: Record<string, string> = {
  '1': 'On hand first of month',
  '2': 'Deposited in bulk storage',
  '6': 'TOTAL (Lines 1 through 5)',
  '17': 'Transferred to processing account',
  '22': 'Other Losses',
  '23': 'On hand end of month',
  '24': 'TOTAL (Lines 7 through 23)',
};
export const STORAGE_EMPTY = 'Lines 3 to 5, 7 to 16, 18 to 21: no entries this month';
export const STORAGE_COLUMNS: Record<string, string> = { b: 'Whisky distilled at 160° and under', c: 'Whisky distilled over 160°', m: 'Total' };
const STORAGE_COL_FOR: Record<Category, string> = { 'whisky-160-and-under': 'b', 'whisky-over-160': 'c' };

export const PROCESSING_LABELS: Record<string, string> = {
  '1': 'ON HAND FIRST OF MONTH',
  '2': 'RECEIVED (Other than line 3)',
  '8': 'TOTAL - LINES 1 THROUGH 7',
  '9': 'BOTTLED OR PACKAGED',
  '24': 'LOSSES',
  '25': 'ON HAND END OF MONTH',
  '26': 'TOTAL - LINES 9 THROUGH 25',
  '27': 'ON HAND FIRST OF MONTH',
  '28': 'BOTTLED OR PACKAGED',
  '31': 'TOTAL - LINES 27 THROUGH 30',
  '33': 'WITHDRAWN TAX DETERMINED',
  '46': 'ON HAND END OF MONTH',
  '47': 'TOTAL - LINES 32 THROUGH 46',
  '55': 'DOMESTIC WHISKEY DISTILLED AT 160° AND UNDER',
  '56': 'DOMESTIC WHISKEY DISTILLED AT OVER 160°',
};
export const PART_I_EMPTY = 'Lines 3 to 7, 10 to 23: no entries this month';
export const PART_II_EMPTY = 'Lines 29, 30, 32, 34 to 45: no entries this month';

export type Reports = {
  period: Period;
  entries: Entry[]; // entries dated in the period or before it (the ones the draft was built from)
  fingerprint: string;
  storage: Line[];
  processing: Line[];
  partIV: Line[];
  line: (id: string) => Line; // "5110.11:17:b", "5110.28:9:c", "5110.28:55:d"
};

const inPeriod = (e: Entry, p: Period) => e.date >= p.from && e.date <= p.to;

function contributionsFrom(ledger: Ledger, entries: Entry[], match: (e: Entry, p: Posting) => boolean): Contribution[] {
  const out: Contribution[] = [];
  for (const e of entries) {
    for (const p of e.postings) {
      if (!match(e, p)) continue;
      out.push({
        entryId: e.id, doc: e.doc, docVersion: e.docVersion, date: e.date, kind: e.kind, memo: e.memo,
        lot: p.lot, pkg: p.pkg, client: p.client, pg: p.pg, wg: p.wg,
        reversal: !!e.reverses, reversed: !!ledger.reversedBy(e.id),
      });
    }
  }
  return out;
}

function balanceContributions(ledger: Ledger, account: Account, f: { operator: string; before?: string; through?: string }, cat?: Category): Contribution[] {
  return ledger
    .positions(account, f)
    .filter((x) => !cat || x.category === cat)
    .map((x) => ({
      entryId: x.entries.join(' '), doc: '', docVersion: 0, date: f.before ?? f.through ?? '', kind: 'balance' as const,
      memo: x.pkg ? `Barrel ${x.pkg}` : `Lot ${x.lot}`, lot: x.lot, pkg: x.pkg, client: x.client, pg: x.pg, reversal: false, reversed: false,
    }));
}

const total = (cs: Contribution[]): Dec => sum(cs.map((c) => c.pg));

export function buildReports(ledger: Ledger, period: Period): Reports {
  // [OPERATOR_OWN_RECORDS] one operator's entries only.
  const all = ledger.entries.filter((e) => e.operator === period.operator && e.date <= period.to);
  const month = all.filter((e) => inPeriod(e, period));
  const f0 = { operator: period.operator, before: period.from };
  const f1 = { operator: period.operator, through: period.to };

  // ---------- 5110.11, by column ----------
  const storage: Line[] = [];
  const cats = new Set<Category>();
  for (const e of all) for (const p of e.postings) if (p.account === 'storage') cats.add(p.category);
  if (cats.size === 0) cats.add('whisky-160-and-under');
  const sl = (line: string, col: string, contributions: Contribution[], derivedFrom?: string[], rule?: string): Line => ({
    form: '5110.11', part: 'storage', line, col, label: STORAGE_LABELS[line]!, unit: 'PG',
    value: derivedFrom ? zero() : total(contributions), contributions, derivedFrom, rule,
  });
  const byCol = new Map<string, Line[]>();
  for (const cat of [...cats].sort()) {
    const col = STORAGE_COL_FOR[cat];
    const l1 = sl('1', col, balanceContributions(ledger, 'storage', f0, cat));
    const l2 = sl('2', col, contributionsFrom(ledger, month, (e, p) => e.kind === 'receipt-in-bond' && p.account === 'storage' && p.category === cat));
    const l17 = sl('17', col, contributionsFrom(ledger, month, (e, p) => e.kind === 'dump' && p.account === 'processing.bulk' && p.category === cat));
    const l22 = sl('22', col, contributionsFrom(ledger, month, (e, p) => p.account === 'loss.storage' && p.category === cat), undefined, 'LOSS_AT_DUMP');
    const l23 = sl('23', col, balanceContributions(ledger, 'storage', f1, cat));
    const l6 = { ...sl('6', col, [], ['1', '2']), value: add(l1.value, l2.value) };
    const l24 = { ...sl('24', col, [], ['17', '22', '23']), value: sum([l17.value, l22.value, l23.value]) };
    byCol.set(col, [l1, l2, l6, l17, l22, l23, l24]);
  }
  // Column (m), total of all columns.
  const ids = ['1', '2', '6', '17', '22', '23', '24'];
  const totals = ids.map((id, i) => {
    const parts = [...byCol.values()].map((ls) => ls[i]!);
    return { ...parts[0]!, col: 'm', value: sum(parts.map((x) => x.value)), contributions: parts.flatMap((x) => x.contributions) };
  });
  for (const ls of byCol.values()) storage.push(...ls);
  storage.push(...totals);

  // ---------- 5110.28 Part I (col c spirits) and Part II (col b bottled) ----------
  const pl = (part: 'I' | 'II', line: string, col: string, contributions: Contribution[], derivedFrom?: string[], rule?: string): Line => ({
    form: '5110.28', part, line, col, label: PROCESSING_LABELS[line]!, unit: 'PG',
    value: total(contributions), contributions, derivedFrom, rule,
  });
  const p1 = pl('I', '1', 'c', balanceContributions(ledger, 'processing.bulk', f0));
  const p2 = pl('I', '2', 'c', contributionsFrom(ledger, month, (e, p) => e.kind === 'dump' && p.account === 'processing.bulk'));
  const p9 = pl('I', '9', 'c', contributionsFrom(ledger, month, (e, p) => e.kind === 'bottling' && p.account === 'processing.bottled'), undefined, 'BOTTLING_LOSS_PART_I');
  const p24 = pl('I', '24', 'c', contributionsFrom(ledger, month, (_e, p) => p.account === 'loss.processing'), undefined, 'BOTTLING_LOSS_PART_I');
  const p25 = pl('I', '25', 'c', balanceContributions(ledger, 'processing.bulk', f1));
  const p8 = { ...pl('I', '8', 'c', [], ['1', '2']), value: add(p1.value, p2.value) };
  const p26 = { ...pl('I', '26', 'c', [], ['9', '24', '25']), value: sum([p9.value, p24.value, p25.value]) };
  const p27 = pl('II', '27', 'b', balanceContributions(ledger, 'processing.bottled', f0));
  const p28 = pl('II', '28', 'b', contributionsFrom(ledger, month, (e, p) => e.kind === 'bottling' && p.account === 'processing.bottled'));
  const p33 = pl('II', '33', 'b', contributionsFrom(ledger, month, (e, p) => e.kind === 'removal' && p.account === 'out.tax-determined'), undefined, 'REMOVAL_REGIME_EXPLICIT');
  const p46 = pl('II', '46', 'b', balanceContributions(ledger, 'processing.bottled', f1));
  const p31 = { ...pl('II', '31', 'b', [], ['27', '28']), value: add(p27.value, p28.value) };
  const p47 = { ...pl('II', '47', 'b', [], ['33', '46']), value: add(p33.value, p46.value) };
  const processing = [p1, p2, p8, p9, p24, p25, p26, p27, p28, p31, p33, p46, p47];

  // ---------- Part IV, lines 55/56 ----------
  // [PART_IV_B_FIRST_DUMP] (b): spirits received on line 2 and dumped to processing for the first time.
  // [NO_BOTTLED_IN_BOND_INFERENCE] (d) vs (e) from the bottling record's own flag.
  // [PART_IV_WHOLE_AFTER_SUM] add every lot of the month, then round to whole gallons.
  const partIV: Line[] = [];
  for (const [lineNo, cat] of [['55', 'whisky-160-and-under'], ['56', 'whisky-over-160']] as const) {
    const b = contributionsFrom(ledger, month, (e, p) => e.kind === 'dump' && p.account === 'processing.bulk' && p.category === cat);
    const bottled = (pred: (e: Entry) => boolean) =>
      contributionsFrom(ledger, month, (e, p) => e.kind === 'bottling' && p.account === 'processing.bottled' && p.category === cat && pred(e))
        .map((c) => ({ ...c, pg: c.wg ?? zero() })); // Part IV (d)(e)(f) count wine gallons
    const d = bottled((e) => !e.bottledInBond && !e.forExport);
    const ecol = bottled((e) => !!e.bottledInBond && !e.forExport);
    const fcol = bottled((e) => !!e.forExport);
    const mk = (col: string, unit: Line['unit'], cs: Contribution[]): Line => {
      const u = total(cs);
      return { form: '5110.28', part: 'IV', line: lineNo, col, label: PROCESSING_LABELS[lineNo]!, unit, value: wholeGallons(u), unrounded: u, contributions: cs, rule: 'PART_IV_WHOLE_AFTER_SUM' };
    };
    const ls = [mk('b', 'whole PG', b), mk('d', 'whole WG', d), mk('e', 'whole WG', ecol), mk('f', 'whole WG', fcol)];
    if (cat === 'whisky-over-160' && ls.every((l) => l.contributions.length === 0)) continue;
    partIV.push(...ls);
  }

  const lines = [...storage, ...processing, ...partIV];
  const line = (id: string): Line => {
    const [form, ln, col] = id.split(':');
    const l = lines.find((x) => x.form === form && x.line === ln && x.col === col);
    if (l) return l;
    // a column with no stock this month: an explicit zero line
    if (form === '5110.11' && ln && col && STORAGE_LABELS[ln]) {
      return { form: '5110.11', part: 'storage', line: ln, col, label: STORAGE_LABELS[ln]!, unit: 'PG', value: zero(), contributions: [] };
    }
    throw new Error(`no line ${id}`);
  };
  return { period, entries: all, fingerprint: fingerprint(all), storage, processing, partIV, line };
}

/** Flat map of every figure, "5110.11:17:b" -> "131.4", for comparisons and snapshots. */
export function figures(r: Reports): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of [...r.storage, ...r.processing, ...r.partIV]) out[`${l.form}:${l.line}:${l.col}`] = toFixed(l.value, l.unit === 'PG' ? 1 : 0);
  return out;
}

