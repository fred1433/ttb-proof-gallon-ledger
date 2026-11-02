// Minimal, generic CSV migration of barrels in storage (opening positions from a spreadsheet).
// It shows the rules a real importer keeps: a duplicate is recognised, a row without a unit is
// rejected rather than guessed, totals are compared before and after, and importing the same
// file again books nothing. No DistillX5 or Whiskey Systems format is implied.
import { type Dec, dec, sub, sum, eq, neg } from './decimal.ts';
import { type Plant, categoryFor } from './model.ts';
import { Ledger, LedgerError } from './ledger.ts';

export type ImportResult = {
  booked: { serial: string; pg: string; entry: string }[];
  duplicates: { line: number; serial: string; why: 'repeated in file' | 'already in ledger' }[];
  rejected: { line: number; serial: string; why: string }[];
  fileTotal: Dec; // proof gallons of the rows that were valid and new
  ledgerDelta: Dec; // change of the storage balance
  totalsAgree: boolean;
};

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.startsWith('#'));
  const head = lines[0]!.split(',').map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = l.split(',').map((c) => c.trim());
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? '']));
  });
}

const PG_UNITS = new Set(['pg', 'proof gallons']);

export function importBarrelsCsv(ledger: Ledger, csv: string, ctx: { plant: Plant; recordedOn: string; asOf: string; source: string }): ImportResult {
  const rows = parseCsv(csv);
  const before = ledger.balance('storage', { operator: ctx.plant.operator });
  const seen = new Set<string>();
  const res: ImportResult = { booked: [], duplicates: [], rejected: [], fileTotal: dec(0), ledgerDelta: dec(0), totalsAgree: false };
  const counted: Dec[] = [];
  rows.forEach((row, i) => {
    const line = i + 2; // 1-based, after the header
    const serial = row.barrel ?? '';
    if (!serial) return res.rejected.push({ line, serial: '', why: 'no barrel serial' });
    if (seen.has(serial)) return res.duplicates.push({ line, serial, why: 'repeated in file' });
    seen.add(serial);
    const unit = (row.unit ?? '').toLowerCase();
    if (!unit) return res.rejected.push({ line, serial, why: 'quantity has no unit' });
    if (!PG_UNITS.has(unit)) return res.rejected.push({ line, serial, why: `unit "${row.unit}" needs a gauge to convert; not guessed` });
    if (!/^\d+\.\d$/.test(row.quantity ?? '')) return res.rejected.push({ line, serial, why: `quantity "${row.quantity}" is not proof gallons to one decimal` });
    if (!row.distillation_proof) return res.rejected.push({ line, serial, why: 'no distillation proof, column unknown' });
    const pg = dec(row.quantity!);
    const common = { lot: serial, pkg: serial, client: row.client!, owner: ctx.plant.titleHolder, category: categoryFor(row.distillation_proof) };
    try {
      const e = ledger.post({
        kind: 'migration', operator: ctx.plant.operator, date: ctx.asOf, recordedOn: ctx.recordedOn, doc: `MIG:${serial}`, docVersion: 1, origin: 'import',
        memo: `Imported from ${ctx.source}, line ${line}`,
        postings: [{ account: 'storage', pg, ...common }, { account: 'in.migration', pg: neg(pg), ...common }],
      });
      res.booked.push({ serial, pg: row.quantity!, entry: e.id });
      counted.push(pg);
    } catch (err) {
      if (err instanceof LedgerError && err.code === 'duplicate') res.duplicates.push({ line, serial, why: 'already in ledger' });
      else throw err;
    }
  });
  res.fileTotal = sum(counted);
  res.ledgerDelta = sub(ledger.balance('storage', { operator: ctx.plant.operator }), before);
  res.totalsAgree = eq(res.fileTotal, res.ledgerDelta);
  return res;
}
