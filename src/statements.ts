// Client statements: a commercial view of the same postings the TTB draft is built from.
// Nothing is copied: each figure is a filter of the ledger by client, so the statements of all
// clients add up to the plant's lines (checked in src/checks.ts).
import { type Dec, sum, neg } from './decimal.ts';
import { type Account, type Entry, type Plant } from './model.ts';
import { Ledger } from './ledger.ts';
import { type Period } from './reports.ts';

export type StatementRow = { key: string; label: string; pg: Dec; wg?: Dec; cases?: number; barrels?: string[]; entries: string[] };
export type Statement = { client: string; name: string; note: string; rows: StatementRow[] };

export const STATEMENT_ROWS: { key: string; label: string; plantLine?: string }[] = [
  { key: 'storage.open', label: 'Barrels in storage at opening', plantLine: '5110.11:1:m' },
  { key: 'storage.received', label: 'Barrels received in bond', plantLine: '5110.11:2:m' },
  { key: 'processing.received', label: 'Dumped into processing (dump gauge)', plantLine: '5110.11:17:m' },
  { key: 'storage.loss', label: 'Storage loss found at dump', plantLine: '5110.11:22:m' },
  { key: 'storage.close', label: 'Barrels in storage at close', plantLine: '5110.11:23:m' },
  { key: 'processing.loss', label: 'Processing loss at bottling', plantLine: '5110.28:24:c' },
  { key: 'bulk.close', label: 'Bulk in processing at close', plantLine: '5110.28:25:c' },
  { key: 'bottled.open', label: 'Bottled stock at opening', plantLine: '5110.28:27:b' },
  { key: 'bottled', label: 'Bottled this month', plantLine: '5110.28:28:b' },
  { key: 'removed', label: 'Withdrawn tax determined', plantLine: '5110.28:33:b' },
  { key: 'bottled.close', label: 'Bottled stock at close', plantLine: '5110.28:46:b' },
];

export function buildStatement(ledger: Ledger, period: Period, plant: Plant, client: string): Statement {
  const meta = plant.clients.find((c) => c.id === client);
  if (!meta) throw new Error(`unknown client ${client}`);
  const op = period.operator;
  const month = ledger.entries.filter((e) => e.operator === op && e.date >= period.from && e.date <= period.to);

  const flow = (key: string, pred: (e: Entry) => boolean, account: Account, sign = 1): StatementRow => {
    const ps = month.flatMap((e) => (pred(e) ? e.postings.filter((p) => p.account === account && p.client === client).map((p) => ({ e, p })) : []));
    const pgs = ps.map(({ p }) => (sign < 0 ? neg(p.pg) : p.pg));
    const wgs = ps.filter(({ p }) => p.wg).map(({ p }) => (sign < 0 ? neg(p.wg!) : p.wg!));
    const cases = ps.reduce((n, { p }) => n + (p.cases ?? 0) * sign, 0);
    return {
      key, label: STATEMENT_ROWS.find((r) => r.key === key)!.label, pg: sum(pgs), wg: wgs.length ? sum(wgs) : undefined,
      cases: ps.some(({ p }) => p.cases !== undefined) ? cases : undefined,
      barrels: [...new Set(ps.map(({ p }) => p.pkg).filter((x): x is string => !!x))],
      entries: [...new Set(ps.map(({ e }) => e.id))],
    };
  };
  const pos = (key: string, account: Account, f: { before?: string; through?: string }): StatementRow => {
    const xs = ledger.positions(account, { operator: op, ...f }).filter((x) => x.client === client);
    let cases: number | undefined;
    if (account === 'processing.bottled') {
      cases = 0;
      for (const e of ledger.entries) {
        if (e.operator !== op || (f.before && e.date >= f.before) || (f.through && e.date > f.through)) continue;
        for (const p of e.postings) if (p.account === account && p.client === client) cases += p.cases ?? 0;
      }
    }
    return {
      key, label: STATEMENT_ROWS.find((r) => r.key === key)!.label, pg: sum(xs.map((x) => x.pg)), cases,
      barrels: xs.map((x) => x.pkg).filter((x): x is string => !!x), entries: [...new Set(xs.flatMap((x) => x.entries))],
    };
  };
  const rows = [
    pos('storage.open', 'storage', { before: period.from }),
    flow('storage.received', (e) => e.kind === 'receipt-in-bond', 'storage'),
    flow('processing.received', (e) => e.kind === 'dump', 'processing.bulk'),
    flow('storage.loss', () => true, 'loss.storage'),
    pos('storage.close', 'storage', { through: period.to }),
    flow('processing.loss', () => true, 'loss.processing'),
    pos('bulk.close', 'processing.bulk', { through: period.to }),
    pos('bottled.open', 'processing.bottled', { before: period.from }),
    flow('bottled', (e) => e.kind === 'bottling', 'processing.bottled'),
    flow('removed', (e) => e.kind === 'removal', 'out.tax-determined'),
    pos('bottled.close', 'processing.bottled', { through: period.to }),
  ];
  return { client, name: meta.name, note: meta.note, rows };
}

export const buildStatements = (ledger: Ledger, period: Period, plant: Plant): Statement[] =>
  plant.clients.map((c) => buildStatement(ledger, period, plant, c.id));
