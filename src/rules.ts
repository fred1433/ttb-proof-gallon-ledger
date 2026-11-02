// Every numeric or reporting rule the engine applies, with its source and the date
// the source text was read. `kind: 'assumption'` marks a choice the sources do not
// settle (questions for a TTB compliance reviewer); `kind: 'design'` marks an engineering
// choice of this prototype that no regulation prescribes.
// Test titles carry the rule id in brackets; tests/rules.test.ts fails if a rule has no test.

export type Rule = {
  id: string;
  kind: 'rule' | 'assumption' | 'design';
  statement: string;
  source: string;
  url: string;
  verified: string; // date the source text was read
  file: string;
};

const V = '2026-11-02';
const ECFR = (s: string) => `https://www.ecfr.gov/current/title-27/section-${s}`;
const F511011 = 'https://www.ttb.gov/system/files/images/pdfs/forms/f511011.pdf';
const F511028 = 'https://www.ttb.gov/system/files/images/pdfs/forms/f511028.pdf';
const PAYGOV28 = 'https://www.pay.gov/public/static-assets/paygov/ATF/help/TTB_Processing_Help_v2.html';

export const RULES: readonly Rule[] = [
  {
    id: 'PROOF_TENTH', kind: 'rule', file: 'src/units.ts',
    statement: 'Proof is kept to the nearest tenth of a degree; a dropped digit of five or more adds a unit (half up, never half even).',
    source: '27 CFR 30.31(a); the half-up sentence closes 27 CFR 30.23', url: ECFR('30.31'), verified: V,
  },
  {
    id: 'TABLE4_TENTH', kind: 'rule', file: 'src/units.ts',
    statement: 'Quantities computed with Table 4 (pounds x gallons per pound) are rounded to the first decimal: below 0.05 dropped, 0.05 or more added as 0.1.',
    source: '27 CFR 30.64, including its 81,000 lb example', url: ECFR('30.64'), verified: V,
  },
  {
    id: 'METRIC_FACTOR', kind: 'rule', file: 'src/units.ts',
    statement: 'Liters convert to wine gallons by multiplying by 0.264172.',
    source: '27 CFR 19.582', url: ECFR('19.582'), verified: V,
  },
  {
    id: 'METRIC_PER_CASE', kind: 'rule', file: 'src/units.ts',
    statement: 'Converting one case before multiplying by the number of cases: the per-case wine gallons are rounded to the sixth decimal.',
    source: '27 CFR 19.582(a); TTB metric conversion table (750 mL x 12 = 2.377548 gal)', url: ECFR('19.582'), verified: V,
  },
  {
    id: 'METRIC_AFTER_MULTIPLYING', kind: 'rule', file: 'src/units.ts',
    statement: 'Converting after multiplying by the number of cases: the wine gallons are rounded to the nearest hundredth. This is the method used in the demo month.',
    source: '27 CFR 19.582(b)', url: ECFR('19.582'), verified: V,
  },
  {
    id: 'PG_FROM_WG', kind: 'rule', file: 'src/units.ts',
    statement: 'Proof gallons of cased spirits = wine gallons x proof / 100.',
    source: '27 CFR 30.52', url: ECFR('30.52'), verified: V,
  },
  {
    id: 'LEDGER_PG_TENTH', kind: 'assumption', file: 'src/units.ts',
    statement: 'Ledger quantities are proof gallons to the tenth; a case conversion (e.g. 21.402 PG) is rounded half up to the tenth on the record that creates it, and report lines in Parts I and II and on the 5110.11 add those tenths without further rounding.',
    source: '27 CFR 30.71 (tenth of a proof gallon), applied by analogy: neither form states a precision for these columns. To confirm with the reviewer.', url: ECFR('30.71'), verified: V,
  },
  {
    id: 'PART_IV_WHOLE_AFTER_SUM', kind: 'assumption', file: 'src/reports.ts',
    statement: 'Part IV columns are whole gallons: (b) and (c) whole proof gallons, (d) (e) (f) whole wine gallons. The month total of each kind is rounded half up to a whole gallon after adding every lot, never lot by lot.',
    source: 'Column headings of TTB F 5110.28 (03/2016) Part IV; the form does not say when to round. To confirm with the reviewer.', url: F511028, verified: V,
  },
  {
    id: 'PART_IV_B_FIRST_DUMP', kind: 'rule', file: 'src/reports.ts',
    statement: 'Spirits received on Part I line 2 and dumped to processing for the first time are also reported in Part IV column (b).',
    source: 'Pay.gov help for TTB F 5110.28, line 2', url: PAYGOV28, verified: V,
  },
  {
    id: 'LOSS_AT_DUMP', kind: 'rule', file: 'src/events.ts',
    statement: 'A storage loss on barrels is the difference between the quantity carried in storage and the dump gauge, recorded when the barrels are dumped. There is no monthly evaporation entry.',
    source: 'TTB F 5110.11 footnote 5 (losses determined at withdrawal, dumping for mingling, or emptying or inventorying storage tanks); 27 CFR 19.462(a)', url: F511011, verified: V,
  },
  {
    id: 'BOTTLING_LOSS_PART_I', kind: 'rule', file: 'src/events.ts',
    statement: 'Part I line 9 carries what was bottled (equal to line 28); bulk spirits used but not bottled go to Part I line 24, losses.',
    source: 'Pay.gov help for TTB F 5110.28, lines 9, 24 and 28', url: PAYGOV28, verified: V,
  },
  {
    id: 'CHECK_5110_11_L6_L24', kind: 'rule', file: 'src/checks.ts',
    statement: 'TTB F 5110.11: line 6 (total of lines 1 to 5) equals line 24 (total of lines 7 to 23), for each column.',
    source: 'Line labels of TTB F 5110.11 (01/2009)', url: F511011, verified: V,
  },
  {
    id: 'CHECK_5110_28_L8_L26', kind: 'rule', file: 'src/checks.ts',
    statement: 'TTB F 5110.28 Part I: line 8 equals line 26.',
    source: 'Line labels of TTB F 5110.28 (03/2016)', url: F511028, verified: V,
  },
  {
    id: 'CHECK_5110_28_L31_L47', kind: 'rule', file: 'src/checks.ts',
    statement: 'TTB F 5110.28 Part II: line 31 equals line 47.',
    source: 'Line labels of TTB F 5110.28 (03/2016)', url: F511028, verified: V,
  },
  {
    id: 'CHECK_L9_EQ_L28', kind: 'rule', file: 'src/checks.ts',
    statement: 'Part I line 9 agrees with line 28 columns (b) + (c).',
    source: 'Pay.gov help for TTB F 5110.28, lines 9 and 28', url: PAYGOV28, verified: V,
  },
  {
    id: 'CHECK_CONTINUITY', kind: 'rule', file: 'src/checks.ts',
    statement: 'Opening lines agree with the previous month as filed: 5110.28 line 1 with line 25, line 27 with line 46; 5110.11 line 1 with line 23.',
    source: 'Pay.gov help for TTB F 5110.28, lines 1 and 27 (the 5110.11 pairing follows the same logic)', url: PAYGOV28, verified: V,
  },
  {
    id: 'CHECK_L17_IN_L2', kind: 'assumption', file: 'src/checks.ts',
    statement: 'In this scenario only, 5110.11 line 17 equals 5110.28 line 2, because every receipt into processing comes from this plant\'s storage. In general line 2 includes line 17 and can hold more.',
    source: 'Pay.gov help for TTB F 5110.28, line 2 ("includes quantities shown on ... Line 17 of Form 5110.11")', url: PAYGOV28, verified: V,
  },
  {
    id: 'COLUMN_FROM_DISTILLATION_PROOF', kind: 'rule', file: 'src/model.ts',
    statement: 'The column "Whisky distilled at 160° and under" is chosen from the distillation proof on the source record of the lot, never from its current or bottling proof.',
    source: 'TTB F 5110.11 column (b) and footnote 6; TTB F 5110.28 line 55', url: F511011, verified: V,
  },
  {
    id: 'NO_BOTTLED_IN_BOND_INFERENCE', kind: 'rule', file: 'src/reports.ts',
    statement: 'A lot goes to Part IV column (e) only when its bottling record says bottled in bond; 100 proof never implies it.',
    source: '27 CFR 5.88, the bottled in bond standard (the 03/2016 form still prints 5.42(b)); TTB F 5110.28 Part IV footnote 4', url: 'https://www.ecfr.gov/current/title-27/section-5.88', verified: V,
  },
  {
    id: 'REMOVAL_REGIME_EXPLICIT', kind: 'rule', file: 'src/events.ts',
    statement: 'The removal regime is a field of the removal record. The engine never infers it from the product being bottled or belonging to a client. The demo month uses tax-determined removals only.',
    source: 'TTB, Key changes to CBMA provisions: bottled spirits may move in bond between premises of the same person or controlled group, or back to the DSP that kept title', url: 'https://www.ttb.gov/news/cbma-key-changes', verified: V,
  },
  {
    id: 'CORRECTION_BY_REVERSAL', kind: 'design', file: 'src/ledger.ts',
    statement: 'Design choice: entries are never edited. A correction posts the exact negative of the original, linked to it, then the right entry; it is never booked as a physical movement in the other direction.',
    source: 'Design choice of this prototype, not a regulation. Related: 27 CFR 19.351(c) limits physical transfers from processing back to storage', url: ECFR('19.351'), verified: V,
  },
  {
    id: 'OPERATOR_OWN_RECORDS', kind: 'rule', file: 'src/reports.ts',
    statement: 'A report is built from one operator\'s entries only. Alternating proprietorship itself is not handled; the separation is tested.',
    source: '27 CFR 19.141(f): "Each alternating proprietor must maintain its own records and submit its own reports."', url: ECFR('19.141'), verified: V,
  },
  {
    id: 'RECEIPT_RECORD_FIELDS', kind: 'rule', file: 'src/events.ts',
    statement: 'A receipt in bond carries the consignor\'s transfer record (serial, TTB F 5100.16 serial and date, consignor and consignee plant numbers) and the consignee\'s result (date received, seals, gauge, account deposited).',
    source: '27 CFR 19.620 and 19.621', url: ECFR('19.621'), verified: V,
  },
  {
    id: 'APPROVED_VERSION_ONLY', kind: 'design', file: 'src/review.ts',
    statement: 'An entry from an extraction reaches the ledger only as the exact version a person approved, and only if the ledger accepts it: approval and booking are one step. Missing or inconsistent data blocks approval; any later edit withdraws it.',
    source: 'Design rule of this prototype, matching the review requirement in the project brief', url: 'https://github.com/fred1433/ttb-proof-gallon-ledger/blob/main/src/review.ts', verified: V,
  },
];

export const ruleById = (id: string): Rule => {
  const r = RULES.find((x) => x.id === id);
  if (!r) throw new Error(`unknown rule ${id}`);
  return r;
};
