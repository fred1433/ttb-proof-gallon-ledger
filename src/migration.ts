// Minimal, generic CSV migration of barrels in storage (opening positions from a spreadsheet).
// It shows the rules a real importer keeps:
// - the whole file is parsed and validated before anything is booked;
// - quoted cells, stray spaces and header case are handled by a real CSV parser (RFC 4180);
// - an identical repeated row is a duplicate; the same barrel with different figures is a
//   conflict, rejected and reported, never resolved silently;
// - a row without a unit, with a unit that needs a gauge, or with a non-numeric proof is
//   rejected, not guessed;
// - a barrel the ledger already carries (from any record) is not imported again;
// - totals are compared before and after, and importing the same file twice books nothing.
// No DistillX5 or Whiskey Systems format is implied.
import { type Dec, dec, sub, sum, eq, neg } from './decimal.ts';
import { type Plant, categoryFor } from './model.ts';
import { Ledger } from './ledger.ts';

export type ImportResult = {
  booked: { serial: string; pg: string; entry: string }[];
  duplicates: { line: number; serial: string; why: 'repeated in file' | 'already imported' }[];
  rejected: { line: number; serial: string; why: string }[];
  fileTotal: Dec; // proof gallons of the rows that were valid and new
  ledgerDelta: Dec; // change of the storage balance
  totalsAgree: boolean;
};

/** RFC 4180 parser: quoted fields may hold commas, quotes ("") and line breaks.
 *  Each row keeps the file line it starts on. Blank lines and lines starting with # are skipped. */
export function parseCsvRows(text: string): { line: number; cells: string[] }[] {
  const rows: { line: number; cells: string[] }[] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  const end = () => { row.push(cell); rows.push({ line: start, cells: row }); row = []; cell = ''; start = line; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else { if (c === '\n') line++; cell += c; }
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      line++;
      end();
    } else cell += c;
  }
  if (cell !== '' || row.length) end();
  return rows.filter((r) => !(r.cells.length === 1 && r.cells[0]!.trim() === '') && !r.cells[0]!.trimStart().startsWith('#'));
}

/** Rows as records keyed by lower-case, trimmed header names, with their file line. */
export function parseCsv(text: string): { line: number; rec: Record<string, string> }[] {
  const rows = parseCsvRows(text);
  const head = rows[0]!.cells.map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => ({ line: r.line, rec: Object.fromEntries(head.map((h, j) => [h, (r.cells[j] ?? '').trim()])) }));
}

const PG_UNITS = new Set(['pg', 'proof gallons']);
const ONE_DECIMAL = /^\d+\.\d$/;
const PROOF = /^\d+(\.\d)?$/;

type Valid = { line: number; serial: string; pg: Dec; client: string; distillation: string; key: string };

export function importBarrelsCsv(ledger: Ledger, csv: string, ctx: { plant: Plant; recordedOn: string; asOf: string; source: string }): ImportResult {
  const rows = parseCsv(csv);
  const res: ImportResult = { booked: [], duplicates: [], rejected: [], fileTotal: dec(0), ledgerDelta: dec(0), totalsAgree: false };
  const carried = new Map(ledger.positions('storage', { operator: ctx.plant.operator }).map((p) => [p.pkg!, p]));
  const importedBefore = new Set(ledger.entries.filter((e) => e.kind === 'migration' && ledger.isLive(e)).map((e) => e.doc));

  // 1. Validate every row; nothing is booked yet.
  const valid: Valid[] = [];
  for (const { line, rec: row } of rows) {
    const serial = row.barrel ?? '';
    const reject = (why: string) => res.rejected.push({ line, serial, why });
    if (!serial) { reject('no barrel serial'); continue; }
    const unit = (row.unit ?? '').toLowerCase();
    if (!unit) { reject('quantity has no unit'); continue; }
    if (!PG_UNITS.has(unit)) { reject(`unit "${row.unit}" needs a gauge to convert; not guessed`); continue; }
    if (!ONE_DECIMAL.test(row.quantity ?? '')) { reject(`quantity "${row.quantity}" is not proof gallons to one decimal`); continue; }
    if (!PROOF.test(row.distillation_proof ?? '')) { reject(`distillation proof "${row.distillation_proof ?? ''}" is not a number; column unknown`); continue; }
    if (!row.client) { reject('no client'); continue; }
    valid.push({ line, serial, pg: dec(row.quantity!), client: row.client, distillation: row.distillation_proof!, key: `${row.quantity}|${row.client}|${row.distillation_proof}` });
  }

  // 2. Repeats and conflicts inside the file.
  const bySerial = new Map<string, Valid[]>();
  for (const v of valid) bySerial.set(v.serial, [...(bySerial.get(v.serial) ?? []), v]);
  const keep: Valid[] = [];
  for (const [serial, vs] of bySerial) {
    if (new Set(vs.map((v) => v.key)).size > 1) {
      for (const v of vs) res.rejected.push({ line: v.line, serial, why: `conflicts with line ${vs.filter((x) => x !== v).map((x) => x.line).join(', ')}: same barrel, different figures` });
      continue;
    }
    keep.push(vs[0]!);
    for (const v of vs.slice(1)) res.duplicates.push({ line: v.line, serial, why: 'repeated in file' });
  }

  // 3. Against the ledger.
  const toBook: Valid[] = [];
  for (const v of keep.sort((a, b) => a.line - b.line)) {
    if (importedBefore.has(`MIG:${v.serial}`)) { res.duplicates.push({ line: v.line, serial: v.serial, why: 'already imported' }); continue; }
    const c = carried.get(v.serial);
    if (c) { res.rejected.push({ line: v.line, serial: v.serial, why: `already in storage (${c.entries.join(', ')}); not imported twice` }); continue; }
    toBook.push(v);
  }

  // 4. Book.
  const before = ledger.balance('storage', { operator: ctx.plant.operator });
  for (const v of toBook) {
    const common = { lot: v.serial, pkg: v.serial, client: v.client, owner: ctx.plant.titleHolder, category: categoryFor(v.distillation) };
    const e = ledger.post({
      kind: 'migration', operator: ctx.plant.operator, date: ctx.asOf, recordedOn: ctx.recordedOn, doc: `MIG:${v.serial}`, docVersion: 1, origin: 'import',
      memo: `Imported from ${ctx.source}, line ${v.line}`,
      postings: [{ account: 'storage', pg: v.pg, ...common }, { account: 'in.migration', pg: neg(v.pg), ...common }],
    });
    res.booked.push({ serial: v.serial, pg: raw1(v.pg), entry: e.id });
  }
  res.duplicates.sort((a, b) => a.line - b.line);
  res.rejected.sort((a, b) => a.line - b.line);
  res.fileTotal = sum(toBook.map((v) => v.pg));
  res.ledgerDelta = sub(ledger.balance('storage', { operator: ctx.plant.operator }), before);
  res.totalsAgree = eq(res.fileTotal, res.ledgerDelta);
  return res;
}

const raw1 = (d: Dec): string => {
  const s = d.u.toString().padStart(d.s + 1, '0');
  return d.s ? `${s.slice(0, -d.s)}.${s.slice(-d.s)}` : s;
};
