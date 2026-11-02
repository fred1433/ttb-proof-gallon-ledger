// Append-only, double-entry proof-gallon ledger.
// - every entry has two or more postings whose proof gallons sum to exactly zero;
// - entries are never edited or deleted; a correction is a reversal (the exact negative,
//   linked to the original) followed by a new entry [CORRECTION_BY_REVERSAL];
// - the same source record version cannot be booked twice (idempotent imports);
// - no plant account (storage, processing bulk, processing bottled) can go below zero
//   for any barrel or lot.
import { type Dec, add, eq, isNeg, isZero, neg, roundHalfUp, sum, zero, raw } from './decimal.ts';
import { type Account, type Entry, type NewEntry, type Posting, isPlantAccount } from './model.ts';

export class LedgerError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const key = (e: NewEntry): string =>
  e.reverses ? `reversal|${e.reverses}` : `${e.operator}|${e.doc}|v${e.docVersion}|${e.kind}`;

/** Position: a barrel while in storage, a lot once in processing (the barrel serial stays on the
 *  posting for traceability but no longer splits the position). */
const slot = (p: Posting): string => (p.account === 'storage' ? `${p.lot}|${p.pkg ?? ''}` : p.lot);
const positionKey = (operator: string, p: Posting): string => `${operator}|${p.account}|${slot(p)}`;

export class Ledger {
  #entries: Entry[] = [];
  #keys = new Set<string>();
  #reversed = new Map<string, string>(); // original id -> reversal id
  #positions = new Map<string, Dec>();

  get entries(): readonly Entry[] {
    return this.#entries;
  }

  get(id: string): Entry | undefined {
    return this.#entries.find((e) => e.id === id);
  }

  reversedBy(id: string): string | undefined {
    return this.#reversed.get(id);
  }

  /** True when the entry stands: not reversed and not itself a reversal. */
  isLive(e: Entry): boolean {
    return !e.reverses && !this.#reversed.has(e.id);
  }

  hasKey(e: NewEntry): boolean {
    return this.#keys.has(key(e));
  }

  post(input: NewEntry): Entry {
    if (input.postings.length < 2) throw new LedgerError('too-few-postings', `${input.doc}: an entry needs at least two postings`);
    for (const p of input.postings) {
      if (!eq(roundHalfUp(p.pg, 1), p.pg)) {
        throw new LedgerError('precision', `${input.doc}: ${raw(p.pg)} PG is finer than the ledger's tenth; round it on the source record [LEDGER_PG_TENTH]`);
      }
    }
    const total = sum(input.postings.map((p) => p.pg));
    if (!isZero(total)) throw new LedgerError('unbalanced', `${input.doc}: postings sum to ${raw(total)} PG, not 0`);
    const k = key(input);
    if (this.#keys.has(k)) throw new LedgerError('duplicate', `${input.doc} v${input.docVersion} (${input.kind}) is already booked`);

    // Non-negative plant positions, computed on the would-be state.
    const next = new Map<string, Dec>();
    for (const p of input.postings) {
      if (!isPlantAccount(p.account)) continue;
      const pk = positionKey(input.operator, p);
      next.set(pk, add(next.get(pk) ?? this.#positions.get(pk) ?? zero(), p.pg));
    }
    for (const [pk, v] of next) {
      if (isNeg(v)) throw new LedgerError('negative-position', `${input.doc}: ${pk.split('|').slice(1).join(' ')} would go to ${raw(v)} PG`);
    }

    const entry: Entry = { ...input, id: `E${String(this.#entries.length + 1).padStart(3, '0')}` };
    this.#entries.push(entry);
    this.#keys.add(k);
    for (const [pk, v] of next) this.#positions.set(pk, v);
    if (entry.reverses) this.#reversed.set(entry.reverses, entry.id);
    return entry;
  }

  /** Cancel an entry with its exact negative. The reversal keeps the original's operation date,
   *  so it lands in the same report month; `recordedOn` says when the correction was made. */
  reverse(id: string, o: { recordedOn: string; reason: string }): Entry {
    const original = this.get(id);
    if (!original) throw new LedgerError('unknown-entry', `no entry ${id}`);
    if (original.reverses) throw new LedgerError('reverse-reversal', `${id} is itself a reversal`);
    if (this.#reversed.has(id)) throw new LedgerError('already-reversed', `${id} is already reversed by ${this.#reversed.get(id)}`);
    return this.post({
      ...original,
      recordedOn: o.recordedOn,
      reverses: id,
      memo: `Reversal of ${id}: ${o.reason}`,
      postings: original.postings.map((p) => ({ ...p, pg: neg(p.pg), wg: p.wg ? neg(p.wg) : undefined, cases: p.cases === undefined ? undefined : -p.cases })),
    });
  }

  /** Balance of a plant account, optionally narrowed, counting entries dated on or before `through`
   *  (or strictly before `before`). */
  balance(account: Account, f: { operator: string; through?: string; before?: string; lot?: string; pkg?: string; client?: string }): Dec {
    let b = zero();
    for (const e of this.#entries) {
      if (e.operator !== f.operator) continue;
      if (f.through && e.date > f.through) continue;
      if (f.before && e.date >= f.before) continue;
      for (const p of e.postings) {
        if (p.account !== account) continue;
        if (f.lot && p.lot !== f.lot) continue;
        if (f.pkg && p.pkg !== f.pkg) continue;
        if (f.client && p.client !== f.client) continue;
        b = add(b, p.pg);
      }
    }
    return b;
  }

  /** Every non-zero position (barrel or lot) of an account at a date, with its descriptive posting. */
  positions(account: Account, f: { operator: string; through?: string; before?: string }): { lot: string; pkg?: string; client: string; category: Posting['category']; pg: Dec; entries: string[] }[] {
    const m = new Map<string, { lot: string; pkg?: string; client: string; category: Posting['category']; pg: Dec; entries: string[] }>();
    for (const e of this.#entries) {
      if (e.operator !== f.operator) continue;
      if (f.through && e.date > f.through) continue;
      if (f.before && e.date >= f.before) continue;
      for (const p of e.postings) {
        if (p.account !== account) continue;
        const k = slot(p);
        const cur = m.get(k) ?? { lot: p.lot, pkg: p.account === 'storage' ? p.pkg : undefined, client: p.client, category: p.category, pg: zero(), entries: [] };
        cur.pg = add(cur.pg, p.pg);
        if (!cur.entries.includes(e.id)) cur.entries.push(e.id);
        m.set(k, cur);
      }
    }
    return [...m.values()].filter((x) => !isZero(x.pg));
  }
}

/** Stable short fingerprint of a set of entries (FNV-1a over ids, doc versions and postings):
 *  two drafts with the same fingerprint were built from the same entries. */
export function fingerprint(entries: readonly Entry[]): string {
  let h = 0x811c9dc5;
  const text = entries
    .map((e) => `${e.id}:${e.doc}@${e.docVersion}:${e.postings.map((p) => `${p.account}/${p.lot}/${p.pkg ?? ''}/${raw(p.pg)}`).join(',')}`)
    .join(';');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
