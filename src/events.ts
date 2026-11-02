// Source records -> ledger entries. This file is the event -> account mapping; src/reports.ts is
// the account -> form line mapping. Nothing here guesses: a missing field is an error.
import { type Dec, dec, sub, sum, isNeg, isZero, neg, raw } from './decimal.ts';
import { caseGauge, type CaseMethod } from './units.ts';
import { type Category, type NewEntry, type Origin, type Plant, type Posting, categoryFor } from './model.ts';
import { Ledger, LedgerError } from './ledger.ts';

// ---------- source record shapes (see fixtures/2026-10/records.json) ----------

export type BarrelLine = { serial: string; pg: string; proof?: string; wg?: string };

export type OpeningBarrel = { serial: string; client: string; pg: string; distilledAtProof: string; receivedOn: string; from: string };
export type OpeningBottled = { lot: string; client: string; cases: number; bottlesPerCase: number; bottleMl: number; proof: string; distilledAtProof: string; method: CaseMethod };
export type OpeningRecord = { id: string; date: string; source: string; barrels: OpeningBarrel[]; bottled: OpeningBottled[] };

export type TransferRecord = {
  id: string; // consignor's transfer record serial
  form5100_16: { serial: string; date: string };
  consignor: { name: string; plant: string };
  consignee: { name: string; plant: string };
  accountRemovedFrom: 'storage';
  shippedOn: string;
  packages: (BarrelLine & { client: string; distilledAtProof: string })[];
};

export type ReceiptRecord = {
  id: string;
  transfer: string; // transfer record id
  receivedOn: string;
  sealsIntact: boolean;
  gauge: BarrelLine[];
  accountDeposited: 'storage';
  signedBy: string;
};

export type DumpRecord = { id: string; date: string; lot: string; tank: string; gauger: string; barrels: (BarrelLine & { proof: string; wg: string })[] };
export type TankGaugeRecord = { id: string; date: string; lot: string; tank: string; before: { wg: string; proof: string }; after: { wg: string; proof: string }; pg: string };
export type BottlingRecord = { id: string; date: string; lot: string; cases: number; bottlesPerCase: number; bottleMl: number; proof: string; method: CaseMethod; bottledInBond: boolean; forExport: boolean; label: string };
export type RemovalRecord = { id: string; version: number; date: string; lot: string; cases: number; bottlesPerCase: number; bottleMl: number; proof: string; method: CaseMethod; regime: string; invoice: string };

type Ctx = { plant: Plant; recordedOn: string; origin?: Origin; approvedBy?: string; docVersion?: number };

const base = (c: Ctx, doc: string, date: string) => ({
  operator: c.plant.operator,
  date,
  recordedOn: c.recordedOn,
  doc,
  docVersion: c.docVersion ?? 1,
  origin: c.origin ?? ('record' as Origin),
  ...(c.approvedBy ? { approvedBy: c.approvedBy } : {}),
});

const P = (o: Posting): Posting => o;

export function openingEntry(r: OpeningRecord, c: Ctx): NewEntry {
  const owner = c.plant.titleHolder;
  const postings: Posting[] = [];
  for (const b of r.barrels) {
    const category = categoryFor(b.distilledAtProof);
    postings.push(P({ account: 'storage', pg: dec(b.pg), lot: b.serial, pkg: b.serial, client: b.client, owner, category }));
    postings.push(P({ account: 'in.opening-balance', pg: neg(dec(b.pg)), lot: b.serial, pkg: b.serial, client: b.client, owner, category }));
  }
  for (const l of r.bottled) {
    const g = caseGauge({ ...l, proof: l.proof });
    const category = categoryFor(l.distilledAtProof);
    postings.push(P({ account: 'processing.bottled', pg: g.proofGallons, wg: g.wineGallons, proof: g.proof, cases: l.cases, lot: l.lot, client: l.client, owner, category }));
    postings.push(P({ account: 'in.opening-balance', pg: neg(g.proofGallons), lot: l.lot, client: l.client, owner, category }));
  }
  return { ...base(c, r.id, r.date), kind: 'opening-balance', memo: `Positions brought forward: ${r.source}`, postings };
}

/** [RECEIPT_RECORD_FIELDS] A receipt books the consignee's gauge, and only if the consignor's
 *  record names this plant and the same packages. */
export function receiptEntry(t: TransferRecord, r: ReceiptRecord, c: Ctx): NewEntry {
  if (r.transfer !== t.id) throw new LedgerError('wrong-transfer', `${r.id} refers to ${r.transfer}, not ${t.id}`);
  if (t.consignee.plant !== c.plant.plantNumber) throw new LedgerError('wrong-consignee', `${t.id} is consigned to ${t.consignee.plant}`);
  if (!t.form5100_16?.serial) throw new LedgerError('missing-5100.16', `${t.id} has no TTB F 5100.16 reference`);
  const sent = new Map(t.packages.map((p) => [p.serial, p]));
  if (r.gauge.length !== t.packages.length || r.gauge.some((g) => !sent.has(g.serial))) {
    throw new LedgerError('package-mismatch', `${r.id}: received packages do not match ${t.id}`);
  }
  const owner = c.plant.titleHolder;
  const postings: Posting[] = [];
  for (const g of r.gauge) {
    const s = sent.get(g.serial)!;
    const category = categoryFor(s.distilledAtProof);
    postings.push(P({ account: 'storage', pg: dec(g.pg), proof: g.proof ? dec(g.proof) : undefined, wg: g.wg ? dec(g.wg) : undefined, lot: g.serial, pkg: g.serial, client: s.client, owner, category }));
    postings.push(P({ account: 'in.transfer-in-bond', pg: neg(dec(g.pg)), lot: g.serial, pkg: g.serial, client: s.client, owner, category }));
  }
  return { ...base(c, r.id, r.receivedOn), kind: 'receipt-in-bond', memo: `Received in bond on ${t.id} from ${t.consignor.name} ${t.consignor.plant} (5100.16 ${t.form5100_16.serial})`, postings };
}

/** [LOSS_AT_DUMP] Each barrel leaves storage at the quantity carried; the dump gauge enters
 *  processing; the difference is the storage loss determined at dump. */
export function dumpEntry(d: DumpRecord, ledger: Ledger, c: Ctx): NewEntry {
  const owner = c.plant.titleHolder;
  const postings: Posting[] = [];
  const clients = new Set<string>();
  for (const b of d.barrels) {
    const pos = ledger.positions('storage', { operator: c.plant.operator, through: d.date }).find((x) => x.pkg === b.serial);
    if (!pos) throw new LedgerError('not-in-storage', `${d.id}: barrel ${b.serial} is not in storage on ${d.date}`);
    clients.add(pos.client);
    const dumped = dec(b.pg);
    const loss = sub(pos.pg, dumped);
    if (isNeg(loss)) throw new LedgerError('gain-at-dump', `${d.id}: ${b.serial} dumps ${b.pg} PG, more than the ${raw(pos.pg)} PG carried; check the gauge`);
    const cat: Category = pos.category;
    postings.push(P({ account: 'storage', pg: neg(pos.pg), lot: b.serial, pkg: b.serial, client: pos.client, owner, category: cat }));
    postings.push(P({ account: 'processing.bulk', pg: dumped, wg: dec(b.wg), proof: dec(b.proof), lot: d.lot, pkg: b.serial, client: pos.client, owner, category: cat }));
    if (!isZero(loss)) postings.push(P({ account: 'loss.storage', pg: loss, lot: d.lot, pkg: b.serial, client: pos.client, owner, category: cat }));
  }
  if (clients.size > 1) throw new LedgerError('mixed-clients', `${d.id}: one lot cannot mix barrels of ${[...clients].join(' and ')}`);
  return { ...base(c, d.id, d.date), kind: 'dump', memo: `Dumped ${d.barrels.map((b) => b.serial).join(', ')} to ${d.tank}, lot ${d.lot}`, postings };
}

/** Bottling tank gauge after reduction (27 CFR 19.353): wine gallons change, proof gallons do not. */
export function tankGaugeEntry(t: TankGaugeRecord, ledger: Ledger, c: Ctx): NewEntry {
  const bal = ledger.balance('processing.bulk', { operator: c.plant.operator, through: t.date, lot: t.lot });
  if (raw(bal) !== raw(dec(t.pg))) throw new LedgerError('tank-gauge-mismatch', `${t.id}: lot ${t.lot} holds ${raw(bal)} PG, gauge says ${t.pg}`);
  const pos = ledger.positions('processing.bulk', { operator: c.plant.operator, through: t.date }).find((x) => x.lot === t.lot)!;
  const owner = c.plant.titleHolder;
  const pg = dec(t.pg);
  return {
    ...base(c, t.id, t.date), kind: 'bottling-tank-gauge',
    memo: `Reduced lot ${t.lot} from ${t.before.proof} to ${t.after.proof} proof in ${t.tank}`,
    postings: [
      P({ account: 'processing.bulk', pg: neg(pg), wg: neg(dec(t.before.wg)), proof: dec(t.before.proof), lot: t.lot, client: pos.client, owner, category: pos.category }),
      P({ account: 'processing.bulk', pg, wg: dec(t.after.wg), proof: dec(t.after.proof), lot: t.lot, client: pos.client, owner, category: pos.category }),
    ],
  };
}

/** [BOTTLING_LOSS_PART_I] The whole lot leaves bulk; what was bottled enters finished products;
 *  the remainder is a processing loss. */
export function bottlingEntry(b: BottlingRecord, ledger: Ledger, c: Ctx): NewEntry {
  const pos = ledger.positions('processing.bulk', { operator: c.plant.operator, through: b.date }).find((x) => x.lot === b.lot);
  if (!pos) throw new LedgerError('no-bulk-lot', `${b.id}: lot ${b.lot} has nothing in processing`);
  const g = caseGauge({ cases: b.cases, bottlesPerCase: b.bottlesPerCase, bottleMl: b.bottleMl, proof: b.proof, method: b.method });
  const loss = sub(pos.pg, g.proofGallons);
  if (isNeg(loss)) throw new LedgerError('bottled-more-than-bulk', `${b.id}: bottled ${raw(g.proofGallons)} PG from ${raw(pos.pg)} PG`);
  const owner = c.plant.titleHolder;
  const common = { lot: b.lot, client: pos.client, owner, category: pos.category };
  const postings: Posting[] = [
    P({ account: 'processing.bulk', pg: neg(pos.pg), ...common }),
    P({ account: 'processing.bottled', pg: g.proofGallons, wg: g.wineGallons, proof: g.proof, cases: b.cases, ...common }),
  ];
  if (!isZero(loss)) postings.push(P({ account: 'loss.processing', pg: loss, ...common }));
  return {
    ...base(c, b.id, b.date), kind: 'bottling', bottledInBond: b.bottledInBond, forExport: b.forExport,
    memo: `Bottled lot ${b.lot}: ${b.cases} cases of ${b.bottlesPerCase} x ${b.bottleMl} mL at ${b.proof} proof (${b.label})`,
    postings,
  };
}

/** [REMOVAL_REGIME_EXPLICIT] Only a removal record that says tax-determined is booked as such. */
export function removalEntry(r: RemovalRecord, ledger: Ledger, c: Ctx): NewEntry {
  if (r.regime !== 'tax-determined') throw new LedgerError('unsupported-regime', `${r.id}: removal regime "${r.regime}" is outside this prototype`);
  const pos = ledger.positions('processing.bottled', { operator: c.plant.operator, through: r.date }).find((x) => x.lot === r.lot);
  if (!pos) throw new LedgerError('no-bottled-lot', `${r.id}: no bottled stock for lot ${r.lot}`);
  const g = caseGauge({ cases: r.cases, bottlesPerCase: r.bottlesPerCase, bottleMl: r.bottleMl, proof: r.proof, method: r.method });
  const owner = c.plant.titleHolder;
  const common = { lot: r.lot, client: pos.client, owner, category: pos.category };
  return {
    ...base({ ...c, docVersion: r.version }, r.id, r.date), kind: 'removal', regime: 'tax-determined',
    memo: `Withdrawn tax determined: ${r.cases} cases of lot ${r.lot} (invoice ${r.invoice})`,
    postings: [
      P({ account: 'processing.bottled', pg: neg(g.proofGallons), wg: neg(g.wineGallons), proof: g.proof, cases: -r.cases, ...common }),
      P({ account: 'out.tax-determined', pg: g.proofGallons, wg: g.wineGallons, proof: g.proof, cases: r.cases, ...common }),
    ],
  };
}

export const totalPG = (lines: { pg: string }[]): Dec => sum(lines.map((l) => dec(l.pg)));
