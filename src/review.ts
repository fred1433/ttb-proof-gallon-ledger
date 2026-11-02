// Human review of an extracted record (here: a photographed dump gauge sheet).
// [APPROVED_VERSION_ONLY]
// - the extraction proposes field values only; it has no say on accounts or report lines
//   (any such key is rejected when the record is loaded);
// - each correction makes a new version; an approval names one version;
// - only the approved version, if it is still the latest, can become a ledger entry;
// - editing after approval withdraws the approval; approving twice changes nothing.
import { type Dec, dec, eq, sum, raw, toFixed, cmp, roundHalfUp } from './decimal.ts';
import { gaugeConsistent } from './units.ts';
import { type Plant } from './model.ts';
import { Ledger } from './ledger.ts';
import { type DumpRecord, dumpEntry } from './events.ts';

export type ExtractedField = { key: string; value: string | null; confidence?: number; box: [number, number, number, number]; note?: string };
export type ExtractionRecord = {
  doc: string;
  kind: 'dump-gauge';
  image: string;
  extractedOn: string;
  how: string; // how the extraction was produced (recorded offline, replayed here)
  seeded: string; // what was altered on purpose for the walkthrough
  fields: ExtractedField[];
};

export type Version = { v: number; values: Record<string, string | null>; by: string; at: string; origin: 'extraction' | 'reviewer'; changed: string[] };
export type Approval = { v: number; by: string; at: string };
export type HistoryItem = { at: string; by: string; action: 'extracted' | 'corrected' | 'approved' | 'approval withdrawn'; v: number; detail?: string };
export type Draft = { doc: string; kind: 'dump-gauge'; versions: Version[]; approval: Approval | null; history: HistoryItem[] };

export type Issue = { field?: string; code: string; message: string };

const ROW_KEYS = ['serial', 'proof', 'wg', 'pg'] as const;
const HEADER_KEYS = ['date', 'lot', 'tank', 'gauger', 'unit.wg', 'unit.pg', 'total.wg', 'total.pg'] as const;
const ROW_KEY = /^rows\.(\d)\.(serial|proof|wg|pg)$/;

/** Keys an extraction may carry. Anything that would place the record on a form is refused. */
export function allowedKey(k: string): boolean {
  return (HEADER_KEYS as readonly string[]).includes(k) || ROW_KEY.test(k);
}

export function loadExtraction(r: ExtractionRecord): Draft {
  const bad = r.fields.filter((f) => !allowedKey(f.key)).map((f) => f.key);
  if (bad.length) throw new Error(`extraction ${r.doc} carries keys it may not set: ${bad.join(', ')}`);
  const values: Record<string, string | null> = {};
  for (const f of r.fields) values[f.key] = f.value;
  return {
    doc: r.doc, kind: r.kind,
    versions: [{ v: 1, values, by: 'extraction (recorded)', at: r.extractedOn, origin: 'extraction', changed: [] }],
    approval: null,
    history: [{ at: r.extractedOn, by: 'extraction (recorded)', action: 'extracted', v: 1 }],
  };
}

export const latest = (d: Draft): Version => d.versions[d.versions.length - 1]!;
export const isApprovedLatest = (d: Draft): boolean => !!d.approval && d.approval.v === latest(d).v;

export function rowCount(values: Record<string, string | null>): number {
  let n = 0;
  while (`rows.${n}.serial` in values) n++;
  return n;
}

const NUM = /^\d+\.\d$/;

/** Everything that blocks approval. Plain checks; none of them can prove a figure right. */
export function issues(d: Draft, ctx: { ledger: Ledger; plant: Plant }): Issue[] {
  const v = latest(d).values;
  const out: Issue[] = [];
  const req = (k: string, what: string) => {
    const x = v[k];
    if (x === null || x === undefined || x.trim() === '') out.push({ field: k, code: 'missing', message: `${what} is missing` });
  };
  req('date', 'Dump date');
  req('lot', 'Lot number');
  req('tank', 'Receiving tank');
  req('gauger', 'Gauger');
  req('unit.wg', 'Unit of the wine gallon column');
  req('unit.pg', 'Unit of the proof gallon column');
  req('total.pg', 'Sheet total, proof gallons');
  for (const k of ['unit.wg', 'unit.pg'] as const) {
    const want = k === 'unit.wg' ? 'wine gallons' : 'proof gallons';
    if (v[k] && v[k]!.trim().toLowerCase() !== want) out.push({ field: k, code: 'unit', message: `Column unit reads "${v[k]}", expected ${want}` });
  }
  const n = rowCount(v);
  if (n === 0) out.push({ code: 'no-rows', message: 'No barrel rows' });
  const pgs: Dec[] = [];
  for (let i = 0; i < n; i++) {
    const serial = v[`rows.${i}.serial`];
    for (const k of ROW_KEYS) req(`rows.${i}.${k}`, `${k === 'serial' ? 'Serial' : k === 'proof' ? 'Proof' : k === 'wg' ? 'Wine gallons' : 'Proof gallons'} for row ${i + 1}${serial ? ` (${serial})` : ''}`);
    const [proof, wg, pg] = (['proof', 'wg', 'pg'] as const).map((k) => v[`rows.${i}.${k}`]);
    for (const [k, x] of [['proof', proof], ['wg', wg], ['pg', pg]] as const) {
      if (x && !NUM.test(x)) out.push({ field: `rows.${i}.${k}`, code: 'format', message: `${serial ?? `Row ${i + 1}`}: "${x}" is not a figure to one decimal` });
    }
    if (proof && wg && pg && NUM.test(proof) && NUM.test(wg) && NUM.test(pg)) {
      const c = gaugeConsistent(dec(wg), dec(proof), dec(pg));
      if (!c.ok) out.push({ field: `rows.${i}.pg`, code: 'inconsistent', message: `${serial}: ${pg} PG does not fit ${wg} WG at ${proof} proof (about ${toFixed(roundHalfUp(c.expected, 2), 2)} PG)` });
      pgs.push(dec(pg));
    }
    if (serial && v.date) {
      const pos = ctx.ledger.positions('storage', { operator: ctx.plant.operator, through: v.date }).find((x) => x.pkg === serial);
      if (!pos) out.push({ field: `rows.${i}.serial`, code: 'not-in-storage', message: `${serial} is not in storage on ${v.date}` });
      else if (pg && NUM.test(pg) && cmp(dec(pg), pos.pg) > 0) out.push({ field: `rows.${i}.pg`, code: 'gain', message: `${serial}: ${pg} PG is more than the ${raw(pos.pg)} PG carried in storage` });
    }
  }
  const tot = v['total.pg'];
  if (tot && NUM.test(tot) && pgs.length === n && n > 0 && !eq(sum(pgs), dec(tot))) {
    out.push({ field: 'total.pg', code: 'total', message: `Rows add up to ${toFixed(sum(pgs), 1)} PG; the sheet's total says ${tot} PG` });
  }
  return out;
}


/** New version with the reviewer's corrections. Withdraws any approval. */
export function correct(d: Draft, changes: Record<string, string | null>, by: string, at: string): Draft {
  const cur = latest(d);
  const changed = Object.keys(changes).filter((k) => (cur.values[k] ?? null) !== (changes[k] ?? null));
  if (changed.length === 0) return d;
  for (const k of changed) if (!allowedKey(k)) throw new Error(`field ${k} cannot be set on a dump gauge`);
  const v = cur.v + 1;
  const history: HistoryItem[] = [...d.history];
  if (d.approval) history.push({ at, by, action: 'approval withdrawn', v: d.approval.v, detail: 'record edited after approval' });
  history.push({ at, by, action: 'corrected', v, detail: changed.map((k) => `${k}: ${cur.values[k] ?? 'blank'} -> ${changes[k] ?? 'blank'}`).join('; ') });
  return { ...d, versions: [...d.versions, { v, values: { ...cur.values, ...changes }, by, at, origin: 'reviewer', changed }], approval: null, history };
}

export type ApproveResult = { ok: true; draft: Draft; already: boolean } | { ok: false; draft: Draft; issues: Issue[] };

export function approve(d: Draft, by: string, at: string, ctx: { ledger: Ledger; plant: Plant }): ApproveResult {
  if (isApprovedLatest(d)) return { ok: true, draft: d, already: true };
  const found = issues(d, ctx);
  if (found.length) return { ok: false, draft: d, issues: found };
  const v = latest(d).v;
  return { ok: true, already: false, draft: { ...d, approval: { v, by, at }, history: [...d.history, { at, by, action: 'approved', v }] } };
}

/** The dump record the approved version describes, or null if the latest version is not approved. */
export function approvedRecord(d: Draft): DumpRecord | null {
  if (!isApprovedLatest(d)) return null;
  const v = latest(d).values;
  const n = rowCount(v);
  return {
    id: d.doc, date: v.date!, lot: v.lot!, tank: v.tank!, gauger: v.gauger!,
    barrels: Array.from({ length: n }, (_, i) => ({ serial: v[`rows.${i}.serial`]!, proof: v[`rows.${i}.proof`]!, wg: v[`rows.${i}.wg`]!, pg: v[`rows.${i}.pg`]! })),
  };
}

/** Bring a persistent ledger in line with the draft: post the approved latest version once;
 *  reverse an entry whose version is no longer the approved one. Safe to call repeatedly. */
export function syncDraft(ledger: Ledger, d: Draft, ctx: { plant: Plant; recordedOn: string }): { posted?: string; reversed?: string[] } {
  const live = ledger.entries.filter((e) => e.doc === d.doc && ledger.isLive(e));
  const rec = approvedRecord(d);
  const reversed: string[] = [];
  for (const e of live) {
    if (!rec || e.docVersion !== d.approval!.v) {
      reversed.push(ledger.reverse(e.id, { recordedOn: ctx.recordedOn, reason: rec ? `superseded by version ${d.approval!.v}` : 'approval withdrawn after an edit' }).id);
    }
  }
  if (!rec) return { reversed };
  if (ledger.entries.some((e) => e.doc === d.doc && e.docVersion === d.approval!.v && ledger.isLive(e))) return { reversed };
  const entry = dumpEntry(rec, ledger, { plant: ctx.plant, recordedOn: ctx.recordedOn, origin: 'reviewed-extraction', approvedBy: d.approval!.by, docVersion: d.approval!.v });
  return { posted: ledger.post(entry).id, reversed };
}
