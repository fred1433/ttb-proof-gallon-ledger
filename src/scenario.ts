// The fictional October 2026 month, booked from fixtures/2026-10. The page and the tests both
// start here, so the browser computes with exactly the code CI runs.
import plantJson from '../fixtures/2026-10/plant.json' with { type: 'json' };
import recordsJson from '../fixtures/2026-10/records.json' with { type: 'json' };
import registerJson from '../fixtures/2026-10/register.json' with { type: 'json' };
import priorJson from '../fixtures/2026-10/prior-report.json' with { type: 'json' };
import countJson from '../fixtures/2026-10/month-end-count.json' with { type: 'json' };
import expectedJson from '../fixtures/2026-10/expected.json' with { type: 'json' };
import extractionJson from '../fixtures/2026-10/extraction-DR-1028.json' with { type: 'json' };

import { type Plant } from './model.ts';
import { Ledger } from './ledger.ts';
import {
  type BottlingRecord, type DumpRecord, type OpeningRecord, type ReceiptRecord, type RemovalRecord, type TankGaugeRecord, type TransferRecord,
  bottlingEntry, dumpEntry, openingEntry, receiptEntry, removalEntry, tankGaugeEntry,
} from './events.ts';
import { type Draft, type ExtractionRecord, loadExtraction, syncDraft } from './review.ts';
import { type Period, type Reports, buildReports } from './reports.ts';
import { type Statement, buildStatements } from './statements.ts';
import { type Check, type Expected, type MonthEndCount, type PriorReport, type RegisterItem, runChecks } from './checks.ts';

type Removal = RemovalRecord & { recordedOn: string; corrects?: { version: number; reason: string } };
type Records = {
  period: { from: string; to: string };
  opening: OpeningRecord;
  transfers: { transfer: TransferRecord; receipt: ReceiptRecord }[];
  dumps: DumpRecord[];
  tankGauges: TankGaugeRecord[];
  bottlings: BottlingRecord[];
  removals: Removal[];
};

export const plant = plantJson as unknown as Plant & { ownership: string };
export const records = recordsJson as unknown as Records;
export const register = (registerJson as { items: RegisterItem[] }).items;
export const prior = priorJson as unknown as PriorReport;
export const monthEndCount = countJson as unknown as MonthEndCount;
export const expected = expectedJson as unknown as Expected;
export const extraction = extractionJson as unknown as ExtractionRecord;
export const period: Period = { operator: plant.operator, ...records.period };

type Booking = { at: string; run: (l: Ledger) => void };

/** Book every source record in date order, the October 20 correction included. */
export function bookRecords(ledger: Ledger = new Ledger()): Ledger {
  const ctx = (recordedOn: string) => ({ plant, recordedOn });
  const steps: Booking[] = [
    { at: records.opening.date, run: (l) => l.post(openingEntry(records.opening, ctx('2026-10-01'))) },
    ...records.transfers.map((t) => ({ at: t.receipt.receivedOn, run: (l: Ledger) => void l.post(receiptEntry(t.transfer, t.receipt, ctx(t.receipt.receivedOn))) })),
    ...records.dumps.map((d) => ({ at: d.date, run: (l: Ledger) => void l.post(dumpEntry(d, l, ctx(d.date))) })),
    ...records.tankGauges.map((g) => ({ at: g.date, run: (l: Ledger) => void l.post(tankGaugeEntry(g, l, ctx(g.date))) })),
    ...records.bottlings.map((b) => ({ at: b.date, run: (l: Ledger) => void l.post(bottlingEntry(b, l, ctx(b.date))) })),
    ...records.removals.map((r) => ({
      at: `${r.recordedOn}`,
      run: (l: Ledger) => {
        if (r.corrects) {
          const wrong = l.entries.find((e) => e.doc === r.id && e.docVersion === r.corrects!.version && l.isLive(e));
          if (wrong) l.reverse(wrong.id, { recordedOn: r.recordedOn, reason: r.corrects.reason });
        }
        l.post(removalEntry(r, l, ctx(r.recordedOn)));
      },
    })),
  ];
  steps.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)); // stable: same-day records keep file order
  for (const s of steps) s.run(ledger);
  return ledger;
}

export type Month = { ledger: Ledger; reports: Reports; statements: Statement[]; checks: Check[] };

export function evaluate(ledger: Ledger): Month {
  const reports = buildReports(ledger, period);
  const statements = buildStatements(ledger, period, plant);
  const checks = runChecks({ ledger, plant, reports, statements, prior, register, transfers: records.transfers, count: monthEndCount, expected });
  return { ledger, reports, statements, checks };
}

/** A fresh ledger with the records booked and the draft synced (approved version only). */
export function buildMonth(draft: Draft = loadExtraction(extraction), recordedOn = '2026-11-02'): Month {
  const ledger = bookRecords();
  syncDraft(ledger, draft, { plant, recordedOn });
  return evaluate(ledger);
}

export const initialDraft = (): Draft => loadExtraction(extraction);
