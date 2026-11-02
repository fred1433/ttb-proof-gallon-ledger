// Domain types. Five dimensions stay separate on every posting:
//   operator  - the DSP proprietor whose records and reports these are (regulatory scope)
//   owner     - who holds title to the spirits
//   client    - whose commercial statement the quantity appears on (private label customer)
//   lot / pkg - physical origin: bottling lot, barrel serial
//   account   - where the spirits sit in the plant (storage, processing bulk, processing bottled)
// A software tenant (the organisation using the product) sits above all of these and is
// out of scope for a single-plant prototype.
import { type Dec, cmp, dec } from './decimal.ts';

export type PlantAccount = 'storage' | 'processing.bulk' | 'processing.bottled';
/** Accounts outside the plant's bonded inventory. They make each entry balance to zero. */
export type OtherAccount =
  | 'in.opening-balance'
  | 'in.transfer-in-bond'
  | 'in.migration'
  | 'loss.storage'
  | 'loss.processing'
  | 'out.tax-determined';
export type Account = PlantAccount | OtherAccount;
export const PLANT_ACCOUNTS: readonly PlantAccount[] = ['storage', 'processing.bulk', 'processing.bottled'];
export const isPlantAccount = (a: Account): a is PlantAccount => (PLANT_ACCOUNTS as readonly string[]).includes(a);

export type Category = 'whisky-160-and-under' | 'whisky-over-160';

/** [COLUMN_FROM_DISTILLATION_PROOF] the column follows the proof at which the spirits were
 *  distilled (from the producer's record), not the barrel or bottling proof. */
export function categoryFor(distilledAtProof: Dec | string): Category {
  return cmp(dec(distilledAtProof), dec('160')) <= 0 ? 'whisky-160-and-under' : 'whisky-over-160';
}

export type Posting = {
  account: Account;
  pg: Dec; // proof gallons, signed; every entry sums to zero
  wg?: Dec; // wine gallons where the record states them (informational, not balanced)
  proof?: Dec;
  lot: string;
  pkg?: string; // barrel serial (kept on processing postings for traceability)
  cases?: number; // bottled stock: number of cases the quantity was computed from
  client: string;
  owner: string;
  category: Category;
};

export type EntryKind =
  | 'opening-balance'
  | 'receipt-in-bond'
  | 'dump'
  | 'bottling-tank-gauge'
  | 'bottling'
  | 'removal'
  | 'migration';

export type Origin = 'record' | 'reviewed-extraction' | 'import';

export type Entry = {
  id: string;
  kind: EntryKind;
  operator: string; // DSP proprietor (registry number)
  date: string; // operation date (YYYY-MM-DD): decides the report month
  recordedOn: string; // when it was booked: never decides the month
  doc: string; // source record id
  docVersion: number;
  origin: Origin;
  approvedBy?: string;
  reverses?: string; // id of the entry this one cancels
  memo: string;
  postings: Posting[];
  bottledInBond?: boolean; // bottling only, from the bottling record
  forExport?: boolean;
  regime?: 'tax-determined'; // removal only, from the removal record
};

export type NewEntry = Omit<Entry, 'id'>;

export type Plant = {
  operator: string;
  plantNumber: string;
  name: string;
  location: string;
  titleHolder: string;
  clients: { id: string; name: string; note: string }[];
};
