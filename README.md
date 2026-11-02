# TTB proof-gallon ledger (prototype)

A double-entry proof-gallon ledger that closes one **fictional** month at a fictional Louisville bottling plant and drafts the review worksheets for TTB F 5110.11 (storage) and TTB F 5110.28 (processing). Every figure on the draft opens on the postings and source records it was added from. An extracted gauge sheet stays out of every line until a person approves the exact version booked.

- Live walkthrough: https://theaipipe.com/demos/ttb-ledger-review/ (runs this code in the browser, stamped with the commit it was built from)
- Run everything: `npm ci && npm run check` (typecheck, build the page bundle, run the tests). Node 22.18 or later; no runtime dependency.

Everything in `fixtures/` is invented: plant DSP-KY-00000, the distilleries, Client A, Client B, every record and number. Nothing is filed or sent anywhere.

## How the numbers are checked

Three kinds of evidence, from weakest to strongest:

1. **The ledger cannot hold an unbalanced or edited entry.** Every entry sums to exactly 0.0 proof gallons; no barrel or lot goes below zero; the same record version cannot be booked twice; a correction is a linked reversal plus a new entry. Arithmetic is exact decimal on integers (`src/decimal.ts`), with half-up rounding written out where a rule calls for it. Property tests run hundreds of random sequences (`tests/ledger.test.ts`, `tests/decimal.test.ts`).
2. **The draft adds up.** 5110.11 line 6 = line 24 per column; 5110.28 line 8 = line 26, line 31 = line 47, line 9 = line 28 (b) + (c). Necessary, not sufficient: a forgotten receipt or a wrong column leaves these balanced, and a test shows it.
3. **The draft agrees with things the engine did not compute** (`src/checks.ts`): last month's report as filed, the plant's own register of October records, the consignor's transfer record, the month-end barrel and case count, and the whole month worked out by hand from the records (`fixtures/2026-10/worksheet.md`, `expected.json`). With the gauge sheet unreviewed, three of these fail and point at DR-1028, B-301 and B-302; once it is approved, all pass.

Each rule the engine applies, its source and the test that holds it (`src/rules.ts`; `tests/rules.test.ts` fails if a rule has no test or is missing here). Sources read on 2026-11-02.

| Rule | What the code does | Source | Code | Tests |
|---|---|---|---|---|
| `PROOF_TENTH` | Proof is kept to the nearest tenth of a degree; a dropped digit of five or more adds a unit (half up, never half even). | [27 CFR 30.31(a); rounding sentence at the end of 27 CFR 30.23](https://www.ecfr.gov/current/title-27/section-30.23) | `src/units.ts` | `tests/decimal.test.ts` |
| `TABLE4_TENTH` | Quantities computed with Table 4 (pounds x gallons per pound) are rounded to the first decimal: below 0.05 dropped, 0.05 or more added as 0.1. | [27 CFR 30.64, including its 81,000 lb example](https://www.ecfr.gov/current/title-27/section-30.64) | `src/units.ts` | `tests/units.test.ts` |
| `METRIC_FACTOR` | Liters convert to wine gallons by multiplying by 0.264172. | [27 CFR 19.582](https://www.ecfr.gov/current/title-27/section-19.582) | `src/units.ts` | `tests/units.test.ts` |
| `METRIC_PER_CASE` | Converting one case before multiplying by the number of cases: the per-case wine gallons are rounded to the sixth decimal. | [27 CFR 19.582(a); TTB metric conversion table (750 mL x 12 = 2.377548 gal)](https://www.ecfr.gov/current/title-27/section-19.582) | `src/units.ts` | `tests/units.test.ts` |
| `METRIC_AFTER_MULTIPLYING` | Converting after multiplying by the number of cases: the wine gallons are rounded to the nearest hundredth. This is the method used in the demo month. | [27 CFR 19.582(b)](https://www.ecfr.gov/current/title-27/section-19.582) | `src/units.ts` | `tests/units.test.ts` |
| `PG_FROM_WG` | Proof gallons of cased spirits = wine gallons x proof / 100. | [27 CFR 30.52](https://www.ecfr.gov/current/title-27/section-30.52) | `src/units.ts` | `tests/units.test.ts` |
| `LEDGER_PG_TENTH` (assumption) | Ledger quantities are proof gallons to the tenth; a case conversion (e.g. 21.402 PG) is rounded half up to the tenth on the record that creates it, and report lines in Parts I and II and on the 5110.11 add those tenths without further rounding. | [Neither form states a precision for these columns; tenths follow 27 CFR 30.64 and 30.71. To confirm with the reviewer.](https://www.ecfr.gov/current/title-27/section-30.71) | `src/units.ts` | `tests/ledger.test.ts`, `tests/units.test.ts` |
| `PART_IV_WHOLE_AFTER_SUM` (assumption) | Part IV columns are whole gallons: (b) and (c) whole proof gallons, (d) (e) (f) whole wine gallons. The month total of each kind is rounded half up to a whole gallon after adding every lot, never lot by lot. | [Column headings of TTB F 5110.28 (03/2016) Part IV; the form does not say when to round. To confirm with the reviewer.](https://www.ttb.gov/system/files/images/pdfs/forms/f511028.pdf) | `src/reports.ts` | `tests/month.test.ts` |
| `PART_IV_B_FIRST_DUMP` | Spirits received on Part I line 2 and dumped to processing for the first time are also reported in Part IV column (b). | [Pay.gov help for TTB F 5110.28, line 2](https://www.pay.gov/public/static-assets/paygov/ATF/help/TTB_Processing_Help_v2.html) | `src/reports.ts` | `tests/month.test.ts` |
| `LOSS_AT_DUMP` | A storage loss on barrels is the difference between the quantity carried in storage and the dump gauge, recorded when the barrels are dumped. There is no monthly evaporation entry. | [TTB F 5110.11 footnote 5 (losses determined at withdrawal, dumping for mingling, or emptying or inventorying storage tanks); 27 CFR 19.462(a)](https://www.ttb.gov/system/files/images/pdfs/forms/f511011.pdf) | `src/events.ts` | `tests/month.test.ts` |
| `BOTTLING_LOSS_PART_I` | Part I line 9 carries what was bottled (equal to line 28); bulk spirits used but not bottled go to Part I line 24, losses. | [Pay.gov help for TTB F 5110.28, lines 9, 24 and 28](https://www.pay.gov/public/static-assets/paygov/ATF/help/TTB_Processing_Help_v2.html) | `src/events.ts` | `tests/month.test.ts` |
| `CHECK_5110_11_L6_L24` | TTB F 5110.11: line 6 (total of lines 1 to 5) equals line 24 (total of lines 7 to 23), for each column. | [Line labels of TTB F 5110.11 (01/2009)](https://www.ttb.gov/system/files/images/pdfs/forms/f511011.pdf) | `src/checks.ts` | `tests/month.test.ts` |
| `CHECK_5110_28_L8_L26` | TTB F 5110.28 Part I: line 8 equals line 26. | [Line labels of TTB F 5110.28 (03/2016)](https://www.ttb.gov/system/files/images/pdfs/forms/f511028.pdf) | `src/checks.ts` | `tests/month.test.ts` |
| `CHECK_5110_28_L31_L47` | TTB F 5110.28 Part II: line 31 equals line 47. | [Line labels of TTB F 5110.28 (03/2016)](https://www.ttb.gov/system/files/images/pdfs/forms/f511028.pdf) | `src/checks.ts` | `tests/month.test.ts` |
| `CHECK_L9_EQ_L28` | Part I line 9 agrees with line 28 columns (b) + (c). | [Pay.gov help for TTB F 5110.28, lines 9 and 28](https://www.pay.gov/public/static-assets/paygov/ATF/help/TTB_Processing_Help_v2.html) | `src/checks.ts` | `tests/month.test.ts` |
| `CHECK_CONTINUITY` | Opening lines agree with the previous month as filed: 5110.28 line 1 with line 25, line 27 with line 46; 5110.11 line 1 with line 23. | [Pay.gov help for TTB F 5110.28, lines 1 and 27 (the 5110.11 pairing follows the same logic)](https://www.pay.gov/public/static-assets/paygov/ATF/help/TTB_Processing_Help_v2.html) | `src/checks.ts` | `tests/month.test.ts` |
| `CHECK_L17_IN_L2` (assumption) | In this scenario only, 5110.11 line 17 equals 5110.28 line 2, because every receipt into processing comes from this plant's storage. In general line 2 includes line 17 and can hold more. | [Pay.gov help for TTB F 5110.28, line 2 ("includes quantities shown on ... Line 17 of Form 5110.11")](https://www.pay.gov/public/static-assets/paygov/ATF/help/TTB_Processing_Help_v2.html) | `src/checks.ts` | `tests/month.test.ts` |
| `COLUMN_FROM_DISTILLATION_PROOF` | The column "Whisky distilled at 160° and under" is chosen from the distillation proof on the source record of the lot, never from its current or bottling proof. | [TTB F 5110.11 column (b) and footnote 6; TTB F 5110.28 line 55](https://www.ttb.gov/system/files/images/pdfs/forms/f511011.pdf) | `src/model.ts` | `tests/month.test.ts` |
| `NO_BOTTLED_IN_BOND_INFERENCE` | A lot goes to Part IV column (e) only when its bottling record says bottled in bond; 100 proof never implies it. | [TTB F 5110.28 Part IV footnote 4 (standard of 27 CFR 5.42(b) as printed on the form, and labeling)](https://www.ttb.gov/system/files/images/pdfs/forms/f511028.pdf) | `src/reports.ts` | `tests/month.test.ts` |
| `REMOVAL_REGIME_EXPLICIT` | The removal regime is a field of the removal record. The engine never infers it from the product being bottled or belonging to a client. The demo month uses tax-determined removals only. | [TTB, Key changes to CBMA provisions: bottled spirits may move in bond between premises of the same person or controlled group, or back to the DSP that kept title](https://www.ttb.gov/news/cbma-key-changes) | `src/events.ts` | `tests/month.test.ts` |
| `CORRECTION_BY_REVERSAL` | Entries are never edited. A correction posts the exact negative of the original, linked to it, then the right entry. It is never a reverse physical movement (processing cannot send spirits back to storage). | [27 CFR 19.351(c)](https://www.ecfr.gov/current/title-27/section-19.351) | `src/ledger.ts` | `tests/ledger.test.ts` |
| `OPERATOR_OWN_RECORDS` | A report is built from one operator's entries only. Alternating proprietorship itself is not handled; the separation is tested. | [27 CFR 19.141(f): "Each alternating proprietor must maintain its own records and submit its own reports."](https://www.ecfr.gov/current/title-27/section-19.141) | `src/reports.ts` | `tests/month.test.ts` |
| `RECEIPT_RECORD_FIELDS` | A receipt in bond carries the consignor's transfer record (serial, TTB F 5100.16 serial and date, consignor and consignee plant numbers) and the consignee's result (date received, seals, gauge, account deposited). | [27 CFR 19.620 and 19.621](https://www.ecfr.gov/current/title-27/section-19.621) | `src/events.ts` | `tests/ledger.test.ts` |
| `APPROVED_VERSION_ONLY` | An entry from an extraction reaches the ledger only as the exact version a person approved. Missing required data blocks approval; any later edit withdraws it. | [Design rule of this prototype, matching the review requirement in the project brief](https://github.com/fred1433/ttb-proof-gallon-ledger/blob/main/src/review.ts) | `src/review.ts` | `tests/review.test.ts` |

The page bundle `site/js/app.js` is built from `src/` and imported by `tests/bundle.test.ts`, which checks it computes the same month as the source. CI builds, tests and serves that same bundle.

## Short answers, each pointing at code

**Transactions and reconciliation.** One immutable journal entry per operation (receipt in bond, dump, bottling tank gauge, bottling, removal), each with two or more postings that sum to zero proof gallons across plant accounts (storage, processing bulk, processing bottled) and outside accounts (in-bond receipts, losses, tax-determined removals). Report lines are projections of postings (`src/reports.ts`); opening and closing lines are balances, computed separately from the flows, so line 6 = line 24 really tests something. Totals are proven against independent records, not only against themselves (above).

**One bottler, several client brands.** Five dimensions stay distinct on every posting: the operator whose records these are (regulatory scope), the title holder, the client whose statement shows the quantity, the physical lot or barrel, and the account. The TTB draft is the operator's, all clients together; client statements are filters of the same postings, never copies, and add up to the plant lines (`src/statements.ts`). Tests show an operation for one client leaves the others unchanged and another operator's entries never reach this report. Audit trail: append-only entries with operation date, booking date, source record and version, origin, approver, and reversal links. Users, permissions and tenancy of the future product sit above this and are not built here.

**Migration.** `src/migration.ts` and `tests/migration.test.ts`: a fictional spreadsheet of barrels where one row repeats (recognised), one has no unit and one is in wine gallons with no gauge (both rejected, never guessed), totals compared before and after, and a second import books nothing. No DistillX5 or Whiskey Systems format is claimed.

**AI-extracted data.** The extraction is a proposal of field values with no say on accounts or lines (`src/review.ts` rejects such keys). Missing data, a missing unit, a figure that does not fit wine gallons and proof, or rows that do not add up to the sheet's total block approval. Approval names a version; only that version, if still the latest, becomes an entry; an edit withdraws it and reverses the entry; approving twice books once; a November approval of an October 28 dump lands in October. On the page the extraction is a recorded file replayed in the browser, with one error seeded on purpose; no model runs.

## Scope of this month

In: storage and processing accounts; 5110.11 columns (b) and total; 5110.28 Parts I, II and lines 55/56 of Part IV; client statements; review of one extracted record; a minimal CSV migration.

Out, as limits of this scenario rather than conclusions about any plant: production account and TTB F 5110.40; TTB F 5000.24 and any tax figure; state reports; bottled spirits moving in bond (possible in some cases since the CBMA changes; here every removal record says tax determined, and the code never infers the regime); alternating proprietorship as a workflow (only the separation is tested); imported, Puerto Rican or Virgin Islands spirits; exports; raw gauge readings (hydrometer, Tables 1, 4 and 7, obscuration: the gauge sheet starts from quantities already determined); PDF export, users, storage, filing.

## Open questions for a TTB reviewer

- The assumptions marked in the table: tenth-of-a-gallon precision for ledger quantities and Parts I and II; Part IV rounded after adding the month's lots; 5110.11 line 17 equal to 5110.28 line 2 only because nothing else enters processing here.
- When one lot leaves in several removals, per-removal rounding can leave 0.1 PG against the case count. The case-count check reports it; how should it be settled?
- Who holds title to a client's barrels, and do any bottled lots return in bond to a client's plant? The answer changes the model.

## Layout

```
src/decimal.ts     exact decimals, half-up rounding
src/units.ts       metric and gauge conversions
src/rules.ts       every rule with its source
src/ledger.ts      append-only double-entry ledger, reversals
src/events.ts      source records -> entries (event -> account)
src/reports.ts     entries -> 5110.11 / 5110.28 lines (account -> line)
src/statements.ts  client statements from the same postings
src/checks.ts      named checks, internal and independent
src/review.ts      versioned review and approval of an extraction
src/migration.ts   minimal CSV import
src/scenario.ts    the fictional October 2026
fixtures/2026-10/  fictional records, register, count, prior month, hand-worked month
web/page.ts        the demo page (imports src/)
```

Role and stack: designed and written by Frederic de Lavenne de Choulot (The AI Pipe) with an AI coding assistant; every rule was checked against the cited source text and every figure against the hand-worked month and the tests. TypeScript, Node's test runner, fast-check, esbuild.
