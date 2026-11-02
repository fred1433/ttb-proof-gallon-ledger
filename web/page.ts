// The demo page. It imports the same src/ the tests run, books the fictional month in the
// browser, and re-computes every figure after each review action. No figure is pasted in.
export * from '../src/index.ts';
import {
  type Contribution, type Draft, type Entry, type Line, type Month, type Statement, type Dec,
  Ledger, RULES, approve, bookRecords, correct, evaluate, extraction, figures, initialDraft, isApprovedLatest,
  issues, latest, records, syncDraft, plant, toFixed, sum, raw, caseGauge, STORAGE_COLUMNS,
} from '../src/index.ts';

declare const __COMMIT__: string;
declare const __TESTS__: string;

const REPO = 'https://github.com/fred1433/ttb-proof-gallon-ledger';
const REVIEWER = 'Demo reviewer (you)';

// ---------------- state ----------------
type Tab = 'trace' | 'review' | 'statements';
const S = {
  ledger: null as unknown as Ledger,
  draft: null as unknown as Draft,
  month: null as unknown as Month,
  selected: '5110.11:22:b',
  open: null as string | null, // open contribution row in the trace
  entry: null as string | null, // entry opened from the journal
  tab: 'trace' as Tab,
  client: 'client-b',
  editing: false,
  pending: {} as Record<string, string>,
  change: null as null | { title: string; before: Record<string, string>; after: Record<string, string>; stBefore: Statement[] },
  versions: [] as string[], // fingerprints of the drafts shown so far
  message: '' as string,
};

const today = () => new Date().toISOString().slice(0, 10);
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const $ = (id: string) => document.getElementById(id)!;
const clientName = (id: string) => plant.clients.find((c) => c.id === id)?.name ?? id;
const fmt = (l: Line) => toFixed(l.value, l.unit === 'PG' ? 1 : 0);
const pg1 = (d: Dec) => toFixed(d, 1);
const signed = (d: Dec, places = 1) => (d.u > 0n ? '+' : '') + toFixed(d, places);
const sentence = (s: string) => {
  const t = s.toLowerCase().replace(/ - /g, ', ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${d}, ${y}`;
};
const shortDate = (iso: string) => longDate(iso).replace(/, \d{4}$/, '').replace(/^(\w{3})\w+/, '$1');

function recompute(reason?: string) {
  const before = S.month ? figures(S.month.reports) : null;
  const stBefore = S.month?.statements ?? [];
  S.month = evaluate(S.ledger);
  const fp = S.month.reports.fingerprint;
  if (!S.versions.includes(fp)) S.versions.push(fp);
  if (before && reason) S.change = { title: reason, before, after: figures(S.month.reports), stBefore };
}

function init() {
  S.ledger = bookRecords(new Ledger());
  S.draft = initialDraft();
  recompute();
  renderStatic();
  render();
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
}

// ---------------- render ----------------
function render() {
  renderStatus();
  renderSpread();
  renderInspector();
  renderChecks();
}

function renderStatic() {
  const c = __COMMIT__;
  const short = c.slice(0, 7);
  $('built').innerHTML = `Built from commit <a href="${REPO}/commit/${esc(c.replace(/-dirty$/, ''))}">${esc(short)}</a>${c.endsWith('-dirty') ? ' (uncommitted)' : ''}`;
  $('commit').innerHTML = `commit <a href="${REPO}/commit/${esc(c.replace(/-dirty$/, ''))}">${esc(short)}</a>, the same build CI tested`;
  $('testcount').textContent = __TESTS__;
  const ops: [string, string][] = [
    ['PROOF_TENTH', 'Proof'],
    ['TABLE4_TENTH', 'Quantity by weight (Table 4)'],
    ['METRIC_FACTOR', 'Liters to wine gallons'],
    ['METRIC_PER_CASE', 'Cases, one case converted first'],
    ['METRIC_AFTER_MULTIPLYING', 'Cases, converted after multiplying'],
    ['PG_FROM_WG', 'Proof gallons of cased spirits'],
    ['LEDGER_PG_TENTH', 'Quantities in the ledger'],
    ['PART_IV_WHOLE_AFTER_SUM', 'Part IV of the 5110.28'],
  ];
  $('policy').querySelector('tbody')!.innerHTML = ops.map(([id, op]) => {
    const r = RULES.find((x) => x.id === id)!;
    return `<tr><td>${esc(op)}${r.kind === 'assumption' ? '<span class="tag">assumption</span>' : ''}</td><td>${esc(r.statement)} <a href="${esc(r.url)}">${esc(r.source.split(';')[0]!.replace(/,? including.*$/, ''))}</a></td></tr>`;
  }).join('');
  const questions = [
    ...RULES.filter((r) => r.kind === 'assumption').map((r) => r.statement),
    'When one lot leaves in several removals, rounding each removal to the tenth can leave 0.1 PG against the case count. The case-count check reports it rather than absorbing it; how should it be settled?',
    'In your co-packing work, who holds title to a client\'s barrels, and do any bottled lots go back in bond to a client\'s plant? The answer changes the model.',
  ];
  $('assumptions').innerHTML = questions.map((q) => `<li>${esc(q)}</li>`).join('');
}

function renderStatus() {
  const m = S.month;
  const failing = m.checks.filter((c) => !c.pass);
  const waiting = isApprovedLatest(S.draft) ? 0 : 1;
  const v = S.versions.indexOf(m.reports.fingerprint) + 1;
  const parts = [
    `<span title="Fingerprint of the entries this version was built from: ${m.reports.fingerprint}"><span class="dot ${failing.length ? 'wait' : ''}"></span><b>October 2026 draft, version ${v}</b>, built from ${m.reports.entries.length} ledger entries</span>`,
    failing.length
      ? `<span><b>${failing.length} of ${m.checks.length} checks</b> need attention</span>`
      : `<span>All ${m.checks.length} checks pass. Ready for your reviewer; nothing is filed.</span>`,
  ];
  if (waiting) parts.push(`<span>1 record waiting for review: DR-1028 <button class="link" data-act="tab" data-tab="review">Review it</button></span>`);
  $('status').innerHTML = parts.join('');
}

function figButton(key: string, l: Line) {
  const prev = S.change && S.change.before[key] !== S.change.after[key] ? S.change.before[key] : undefined;
  const label = `${l.form} line ${l.line} column ${l.col}: ${sentence(l.label)}, ${fmt(l)} ${l.unit}`;
  return `<button class="fig${prev !== undefined ? ' changed' : ''}" data-act="sel" data-key="${key}" aria-pressed="${S.selected === key && !S.entry}" aria-label="${esc(label)}">${prev !== undefined ? `<span class="was">${esc(prev)}</span>` : ''}${fmt(l)}</button>`;
}

function renderSpread() {
  const r = S.month.reports;
  const catCols = [...new Set(r.storage.map((l) => l.col))].filter((c) => c !== 'm');
  const cols = catCols.length > 1 ? [...catCols, 'm'] : catCols;
  const row = (form: string, line: string, labelText: string, keys: string[], total = false) =>
    `<tr class="${total ? 'total' : ''}"><td class="no">${esc(line)}</td><td class="lab">${esc(labelText)}</td>${keys.map((k) => `<td class="val">${figButton(k, r.line(k))}</td>`).join('')}</tr>`;
  const quiet = (text: string, n: number) => `<tr class="quiet"><td class="no"></td><td class="lab">${esc(text)}</td>${'<td class="val"></td>'.repeat(n)}</tr>`;
  const s = (line: string, total = false) => row('5110.11', line, sentence(r.line(`5110.11:${line}:m`).label), cols.map((c) => `5110.11:${line}:${c}`), total);
  const left = `
    <div class="page">
      <div class="page-head"><h2>Storage account</h2><div class="form">TTB F 5110.11, monthly report of storage operations. Proof gallons, domestic spirits.${catCols.length === 1 ? ' Column (m), total, equals this column: one kind of spirits this month.' : ''}</div></div>
      <table class="ledger">
        <thead><tr><th class="no"></th><th class="lab">Line</th>${cols.map((c) => `<th>(${c}) ${esc(STORAGE_COLUMNS[c] ?? '')}</th>`).join('')}</tr></thead>
        <tbody>
          ${s('1')}${s('2')}${quiet('Lines 3 to 5: no entries', cols.length)}${s('6', true)}
          ${quiet('Lines 7 to 16: no entries', cols.length)}${s('17')}${quiet('Lines 18 to 21: no entries', cols.length)}${s('22')}${s('23')}${s('24', true)}
        </tbody>
      </table>
      ${journal()}
    </div>`;
  const p = (line: string, col: string, total = false) => row('5110.28', line, sentence(r.line(`5110.28:${line}:${col}`).label), [`5110.28:${line}:${col}`], total);
  const ivLabels: Record<string, string> = {
    b: '(b) Bulk spirits dumped into processing, whole proof gallons',
    d: '(d) Bottled, excluding bottled in bond and export, whole wine gallons',
    e: '(e) Bottled in bond, whole wine gallons',
    f: '(f) Bottled for export, whole wine gallons',
  };
  const iv = r.partIV.map((l) => `<tr><td class="no">${esc(l.line)}${esc(l.col)}</td><td class="lab">${esc(ivLabels[l.col] ?? l.col)}</td><td class="val">${figButton(`5110.28:${l.line}:${l.col}`, l)}</td></tr>`).join('');
  const right = `
    <div class="page">
      <div class="page-head"><h2>Processing account</h2><div class="form">TTB F 5110.28, monthly report of processing operations. Proof gallons unless marked.</div></div>
      <div class="part-title">Part I, bulk ingredients, column (c) spirits</div>
      <table class="ledger"><tbody>
        ${p('1', 'c')}${p('2', 'c')}${quiet('Lines 3 to 7: no entries', 1)}${p('8', 'c', true)}${p('9', 'c')}${quiet('Lines 10 to 23: no entries', 1)}${p('24', 'c')}${p('25', 'c')}${p('26', 'c', true)}
      </tbody></table>
      <div class="part-title">Part II, finished products, column (b) bottled</div>
      <table class="ledger"><tbody>
        ${p('27', 'b')}${p('28', 'b')}${quiet('Lines 29 and 30: no entries', 1)}${p('31', 'b', true)}${quiet('Line 32: no entries', 1)}${p('33', 'b')}${quiet('Lines 34 to 45: no entries', 1)}${p('46', 'b')}${p('47', 'b', true)}
      </tbody></table>
      <div class="part-title">Part IV, line 55: domestic whiskey distilled at 160° and under</div>
      <table class="ledger"><tbody>${iv}</tbody></table>
    </div>`;
  $('spread').innerHTML = left + right;
}

function mainQty(e: Entry): string {
  const acc = e.kind === 'receipt-in-bond' ? ['storage'] : e.kind === 'dump' ? ['processing.bulk'] : e.kind === 'bottling' ? ['processing.bottled'] : e.kind === 'removal' ? ['out.tax-determined'] : [];
  if (!acc.length) return '';
  const tot = sum(e.postings.filter((p) => acc.includes(p.account)).map((p) => p.pg));
  return toFixed(tot, 1);
}

function journal(): string {
  const es = S.ledger.entries;
  const waiting = !isApprovedLatest(S.draft) && !es.some((e) => e.doc === extraction.doc && S.ledger.isLive(e));
  const rows = es.map((e) => {
    const struck = e.reverses || S.ledger.reversedBy(e.id);
    return `<tr class="${struck ? 'struck' : ''}"><td class="no">${esc(e.id.replace(/^E0*/, ''))}</td><td class="lab"><button class="jrow" data-act="entry" data-id="${e.id}" aria-pressed="${S.entry === e.id && S.tab === 'trace'}"><span class="jd">${shortDate(e.date)}</span> <b>${esc(e.doc)}${e.docVersion > 1 ? ` v${e.docVersion}` : ''}</b> ${esc(e.reverses ? `cancels ${e.reverses}` : JOURNAL_WHAT[e.kind])}</button></td><td class="val jq">${mainQty(e)}</td></tr>`;
  });
  if (waiting) rows.push(`<tr class="waiting"><td class="no"></td><td class="lab"><button class="jrow" data-act="tab" data-tab="review"><span class="jd">Oct 28</span> <b>DR-1028</b> dump gauge, waiting for review: not booked</button></td><td class="val jq">95.0</td></tr>`);
  return `<div class="part-title journal-title">The month in the ledger: every entry, in order</div>
    <table class="ledger journal"><thead><tr><th class="no"></th><th class="lab">Entry</th><th>PG</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

const JOURNAL_WHAT: Record<string, string> = {
  'opening-balance': 'opening positions', 'receipt-in-bond': 'received in bond', dump: 'dumped to processing', 'bottling-tank-gauge': 'reduced to bottling proof',
  bottling: 'bottled', removal: 'withdrawn tax determined', migration: 'imported',
};

/** The (m) total column of the 5110.11 is not drawn when it only repeats a single column. */
function visibleKey(k: string): boolean {
  if (!k.startsWith('5110.11:') || !k.endsWith(':m')) return true;
  return new Set(S.month.reports.storage.map((l) => l.col)).size > 2;
}

const ACCOUNT_NAME: Record<string, string> = {
  storage: 'Storage', 'processing.bulk': 'Processing, bulk', 'processing.bottled': 'Processing, bottled', 'out.tax-determined': 'Withdrawn tax determined',
  'loss.storage': 'Storage loss', 'loss.processing': 'Processing loss', 'in.transfer-in-bond': 'From consignor, in bond', 'in.opening-balance': 'Opening position', 'in.migration': 'Migration',
};
const accountName = (a: string) => ACCOUNT_NAME[a] ?? a;

function renderInspector() {
  const waiting = !isApprovedLatest(S.draft);
  const tabs: [Tab, string][] = [['trace', 'Trace a figure'], ['review', 'Review'], ['statements', 'Clients']];
  const head = `<div class="tabs" role="tablist">${tabs.map(([t, n]) => `<button role="tab" data-act="tab" data-tab="${t}" aria-selected="${S.tab === t}">${esc(n)}${t === 'review' && waiting ? '<span class="count">1</span>' : ''}</button>`).join('')}</div>`;
  const body = S.tab === 'trace' ? tracePanel() : S.tab === 'review' ? reviewPanel() : statementsPanel();
  $('inspector').innerHTML = head + `<div class="panel" role="tabpanel">${body}</div>`;
}

// ---------- trace ----------
function linesOf(entryId: string): string[] {
  const r = S.month.reports;
  return [...r.storage, ...r.processing, ...r.partIV]
    .filter((l) => l.contributions.some((c) => c.entryId === entryId) && !(l.form === '5110.11' && l.col === 'm' && r.storage.some((x) => x.col !== 'm' && x.line === l.line && x.contributions.some((c) => c.entryId === entryId)) && [...new Set(r.storage.map((x) => x.col))].length === 2))
    .map((l) => `${l.form}:${l.line}:${l.col}`);
}

function entryPanel(id: string): string {
  const e = S.ledger.get(id)!;
  const ls = linesOf(id);
  return `<h3>Entry ${esc(e.id)}, ${esc(e.doc)}</h3><p class="sub">${esc(e.memo)}</p>
    ${ls.length ? `<p>Reaches ${ls.length} line${ls.length > 1 ? 's' : ''} of the draft:</p><div class="chips">${ls.map((k) => { const [f, n, c] = k.split(':'); return `<button data-act="sel" data-key="${k}">${f} line ${n} (${c}) ${fmt(S.month.reports.line(k))}</button>`; }).join('')}</div>` : `<p class="note">This entry moves no proof gallons between report lines${e.kind === 'bottling-tank-gauge' ? ': reduction with water changes wine gallons only' : ''}.</p>`}
    <div class="record" style="padding:0">${entryDetail(id)}</div>`;
}

function tracePanel(): string {
  if (S.entry) return entryPanel(S.entry);
  const l = S.month.reports.line(S.selected);
  const colName = l.form === '5110.11' ? STORAGE_COLUMNS[l.col] : l.part === 'I' ? 'Spirits' : l.part === 'II' ? 'Bottled' : l.unit;
  const rule = l.rule ? RULES.find((x) => x.id === l.rule) : undefined;
  let html = `<h3>${l.form} line ${esc(l.line)}, column (${esc(l.col)})</h3>
    <p class="sub">${esc(sentence(l.label))}. ${esc(colName ?? '')}.</p>
    <div class="big">${fmt(l)}<span class="unit">${esc(l.unit)}</span></div>`;
  if (S.change && S.change.before[S.selected] !== S.change.after[S.selected]) {
    html += `<p class="note">Was ${esc(S.change.before[S.selected])} before: ${esc(S.change.title)}.</p>`;
  }
  if (l.derivedFrom) {
    const parts = l.derivedFrom.map((n) => `${l.form}:${n}:${l.col}`);
    html += `<p>Total of lines ${l.derivedFrom.join(', ')}: ${parts.map((k) => fmt(S.month.reports.line(k))).join(' + ')}.</p>
      <div class="chips">${parts.map((k) => `<button data-act="sel" data-key="${k}">Open line ${esc(k.split(':')[1]!)}</button>`).join('')}</div>`;
    return html;
  }
  if (l.unrounded) {
    html += `<p class="rulecite"><b>${raw(l.unrounded)} ${l.unit === 'whole PG' ? 'PG' : 'WG'} for the month before rounding.</b> ${esc(rule?.statement ?? '')}</p>`;
  } else if (rule) {
    html += `<p class="rulecite"><b>Rule.</b> ${esc(rule.statement)} <a href="${esc(rule.url)}">${esc(rule.source.split(/[;:(]/)[0]!.trim())}</a></p>`;
  }
  const cs = l.contributions;
  if (!cs.length) return html + `<p class="note">No posting reaches this line this month.</p>`;
  const balance = cs[0]!.kind === 'balance';
  html += `<p class="note">${balance ? `Positions ${l.line === '1' || l.line === '27' ? 'on October 1' : 'on October 31'}, from the ledger. Open one for its history.` : `${cs.length} posting${cs.length > 1 ? 's' : ''} from ${new Set(cs.map((c) => c.entryId)).size} ${new Set(cs.map((c) => c.entryId)).size > 1 ? 'entries' : 'entry'}. Open one for the entry and its source record.`}</p>`;
  html += `<ul class="contribs">${cs.map((c, i) => contribRow(c, i, l)).join('')}</ul>`;
  html += `<p class="note">Sum: ${cs.map((c) => toFixed(c.pg, l.unit === 'PG' ? 1 : 2)).join(' + ').replace(/\+ -/g, '- ')} = ${toFixed(sum(cs.map((c) => c.pg)), l.unit === 'PG' ? 1 : 2)}${l.unrounded ? `, ${fmt(l)} whole` : ''}.</p>`;
  return html;
}

function contribRow(c: Contribution, i: number, l: Line): string {
  const id = `${S.selected}#${i}`;
  const open = S.open === id;
  const places = l.unit === 'PG' ? 1 : 2;
  const what = c.kind === 'balance'
    ? `${c.pkg ? `Barrel ${c.pkg}` : `Lot ${c.lot}`}, ${esc(clientName(c.client))}`
    : `${esc(c.doc)}${c.docVersion > 1 ? ` v${c.docVersion}` : ''}, ${c.pkg ? `barrel ${esc(c.pkg)}` : `lot ${esc(c.lot)}`}`;
  const meta = c.kind === 'balance'
    ? `entries ${esc(c.entryId.split(' ').join(', '))}`
    : `${shortDate(c.date)}, ${esc(clientName(c.client))}, entry ${esc(c.entryId)}${c.reversal ? ', reversal' : ''}${c.reversed ? ', reversed' : ''}`;
  const struck = c.reversed || c.reversal;
  return `<li class="${open ? 'open' : ''} ${struck ? 'struck' : ''}">
    <button class="row" data-act="open" data-id="${esc(id)}" aria-expanded="${open}">
      <span class="what">${what}</span><span class="amt ${c.pg.u < 0n ? 'neg' : ''}">${l.unit === 'PG' ? signed(c.pg, places) : toFixed(c.pg, places)}</span><span class="meta">${meta}</span>
    </button>${open ? `<div class="record">${c.kind === 'balance' ? positionHistory(c) : entryDetail(c.entryId)}</div>` : ''}</li>`;
}

function positionHistory(c: Contribution): string {
  const rows: string[] = [];
  for (const e of S.ledger.entries) {
    for (const p of e.postings) {
      if ((c.pkg && p.pkg === c.pkg && (p.account === 'storage' || p.account === 'processing.bulk')) || (!c.pkg && p.lot === c.lot && p.account.startsWith('processing'))) {
        rows.push(`<tr><td>${esc(e.id)} ${esc(e.doc)}</td><td>${shortDate(e.date)}</td><td>${esc(accountName(p.account))}</td><td>${signed(p.pg)}</td></tr>`);
      }
    }
  }
  return `<h4>History of ${c.pkg ? `barrel ${esc(c.pkg)}` : `lot ${esc(c.lot)}`}</h4><table><tr><th>Entry</th><th>Date</th><th>Account</th><th>PG</th></tr>${rows.join('')}</table>
  ${c.pkg && S.month.checks.find((k) => k.id === 'barrel-count')?.toExamine.includes(c.pkg)
    ? '<p class="note">The October 31 count found this barrel empty while the ledger still carries it.</p>' : ''}`;
}

function entryDetail(entryId: string): string {
  const e = S.ledger.get(entryId);
  if (!e) return '';
  const tot = sum(e.postings.map((p) => p.pg));
  const rev = S.ledger.reversedBy(e.id);
  const origin = e.origin === 'reviewed-extraction' ? `Reviewed extraction, version ${e.docVersion} approved by ${e.approvedBy}` : e.origin === 'import' ? 'Import' : 'Source record';
  return `<h4>Entry ${esc(e.id)}: ${esc(e.memo)}</h4>
    <dl>
      <dt>Operation date</dt><dd>${longDate(e.date)}</dd>
      <dt>Booked on</dt><dd>${longDate(e.recordedOn)}</dd>
      <dt>Source</dt><dd>${esc(e.doc)} version ${e.docVersion}. ${esc(origin)}</dd>
      ${e.reverses ? `<dt>Cancels</dt><dd>${esc(e.reverses)}, with the exact negative of each posting</dd>` : ''}
      ${rev ? `<dt>Cancelled by</dt><dd>${esc(rev)}</dd>` : ''}
    </dl>
    <h4>Postings (sum ${toFixed(tot, 1)} PG)</h4>
    <table><tr><th>Account</th><th>Barrel or lot</th><th>Client</th><th>PG</th></tr>
    ${e.postings.map((p) => `<tr><td>${esc(accountName(p.account))}</td><td>${esc(p.pkg ?? p.lot)}</td><td>${esc(clientName(p.client))}</td><td>${signed(p.pg)}</td></tr>`).join('')}</table>
    ${sourceRecord(e)}`;
}

function sourceRecord(e: Entry): string {
  const kv = (pairs: [string, string][]) => `<dl>${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  const t = records.transfers.find((x) => x.receipt.id === e.doc);
  if (t) {
    return `<h4>Transfer record ${esc(t.transfer.id)} and receipt ${esc(t.receipt.id)}</h4>${kv([
      ['TTB F 5100.16', `${t.transfer.form5100_16.serial}, approved ${longDate(t.transfer.form5100_16.date)}`],
      ['Consignor', `${t.transfer.consignor.name}, ${t.transfer.consignor.plant}`],
      ['Consignee', `${t.transfer.consignee.name}, ${t.transfer.consignee.plant}`],
      ['Removed from', `${t.transfer.accountRemovedFrom} account, shipped ${longDate(t.transfer.shippedOn)}`],
      ['Received', `${longDate(t.receipt.receivedOn)}, seals ${t.receipt.sealsIntact ? 'intact' : 'NOT intact'}, deposited in ${t.receipt.accountDeposited}`],
    ])}<table><tr><th>Barrel</th><th>Distilled at</th><th>PG shipped</th><th>PG received</th></tr>${t.transfer.packages.map((p) => `<tr><td>${esc(p.serial)}</td><td>${esc(p.distilledAtProof)}°</td><td>${esc(p.pg)}</td><td>${esc(t.receipt.gauge.find((g) => g.serial === p.serial)?.pg ?? '')}</td></tr>`).join('')}</table>`;
  }
  const d = records.dumps.find((x) => x.id === e.doc);
  if (d || e.doc === extraction.doc) {
    const rec = d ?? null;
    const rows = rec ? rec.barrels : barrelsOf(e.docVersion);
    return `<h4>Dump gauge ${esc(e.doc)}${rec ? '' : `, version ${e.docVersion} (reviewed extraction)`}</h4>
      ${rec ? kv([['Lot', rec.lot], ['Dumped to', rec.tank], ['Gauger', rec.gauger]]) : ''}
      <table><tr><th>Barrel</th><th>Proof</th><th>WG</th><th>PG</th></tr>${rows.map((b) => `<tr><td>${esc(b.serial)}</td><td>${esc(b.proof)}</td><td>${esc(b.wg)}</td><td>${esc(b.pg)}</td></tr>`).join('')}</table>
      <p class="note">The loss is what storage carried minus the dump gauge, found at the dump. No monthly evaporation entry exists.</p>`;
  }
  const g = records.tankGauges.find((x) => x.id === e.doc);
  if (g) return `<h4>Bottling tank gauge ${esc(g.id)}</h4>${kv([['Tank', g.tank], ['Before reduction', `${g.before.wg} WG at ${g.before.proof} proof`], ['After reduction', `${g.after.wg} WG at ${g.after.proof} proof`], ['Proof gallons', `${g.pg}, unchanged: water adds wine gallons only`]])}`;
  const b = records.bottlings.find((x) => x.id === e.doc);
  if (b) return `<h4>Bottling record ${esc(b.id)}</h4>${kv([['Label', b.label], ['Bottled in bond', b.bottledInBond ? 'yes' : 'no, as recorded'], ['For export', b.forExport ? 'yes' : 'no']])}${caseWork(b.cases, b.bottlesPerCase, b.bottleMl, b.proof)}`;
  const r = records.removals.find((x) => x.id === e.doc && x.version === e.docVersion);
  if (r) return `<h4>Removal record ${esc(r.id)}, version ${r.version}</h4>${kv([['Regime', `${r.regime}, as written on the record`], ['Invoice', r.invoice], ...(r.corrects ? [['Correction', r.corrects.reason] as [string, string]] : [])])}${caseWork(r.cases, r.bottlesPerCase, r.bottleMl, r.proof)}`;
  if (e.doc === records.opening.id) return `<h4>Opening positions ${esc(e.doc)}</h4><p class="note">${esc(records.opening.source)}. They agree with the September report as filed (see the continuity check).</p>`;
  return '';
}

function barrelsOf(v: number) {
  const ver = S.draft.versions.find((x) => x.v === v);
  if (!ver) return [];
  const out: { serial: string; proof: string; wg: string; pg: string }[] = [];
  for (let i = 0; `rows.${i}.serial` in ver.values; i++) {
    out.push({ serial: ver.values[`rows.${i}.serial`] ?? '', proof: ver.values[`rows.${i}.proof`] ?? '', wg: ver.values[`rows.${i}.wg`] ?? '', pg: ver.values[`rows.${i}.pg`] ?? '' });
  }
  return out;
}

function caseWork(cases: number, per: number, ml: number, proof: string): string {
  const g = caseGauge({ cases, bottlesPerCase: per, bottleMl: ml, proof, method: 'after-multiplying' });
  return `<h4>Conversion, 27 CFR 19.582(b) and 30.52</h4><table>
    <tr><td>${cases} cases x ${per} x ${ml} mL</td><td>${raw(g.liters)} L</td></tr>
    <tr><td>x 0.264172</td><td>${toFixed(g.wineGallonsUnrounded, 6)} WG</td></tr>
    <tr><td>to the hundredth</td><td>${toFixed(g.wineGallons, 2)} WG</td></tr>
    <tr><td>x ${esc(proof)} / 100</td><td>${raw(g.proofGallonsUnrounded)} PG</td></tr>
    <tr><td>to the tenth (ledger)</td><td>${toFixed(g.proofGallons, 1)} PG</td></tr></table>`;
}

// ---------- review ----------
const FIELD_LABEL: Record<string, string> = {
  date: 'Dump date', lot: 'Lot', tank: 'Dumped to', gauger: 'Gauger', 'unit.wg': 'Unit, wine gallon column', 'unit.pg': 'Unit, proof gallon column', 'total.wg': 'Sheet total, WG', 'total.pg': 'Sheet total, PG',
};
const fieldLabel = (k: string, values: Record<string, string | null>) => {
  const m = /^rows\.(\d)\.(\w+)$/.exec(k);
  if (!m) return FIELD_LABEL[k] ?? k;
  const serial = values[`rows.${m[1]}.serial`] ?? `row ${Number(m[1]) + 1}`;
  return `${serial}, ${({ serial: 'barrel serial', proof: 'proof', wg: 'wine gallons', pg: 'proof gallons' } as Record<string, string>)[m[2]!]}`;
};

function reviewPanel(): string {
  const d = S.draft;
  const cur = latest(d);
  const approved = isApprovedLatest(d);
  const ctx = { ledger: S.ledger, plant };
  const found = approved ? [] : issues(d, ctx);
  const look = extraction.fields.filter((f) => f.value === null || (f.confidence ?? 1) < 0.7 || found.some((i) => i.field === f.key) || d.versions.some((v) => v.changed.includes(f.key)) || (S.editing && f.key === 'tank'));
  const editable = !approved || S.editing;
  const status = approved
    ? `Approved: version ${d.approval!.v}, by ${esc(d.approval!.by)} on ${longDate(d.approval!.at)}`
    : d.history.some((h) => h.action === 'approval withdrawn')
      ? `Edited after approval: version ${cur.v} is waiting for review`
      : `Waiting for review: version ${cur.v} (${cur.origin === 'extraction' ? 'as extracted' : 'with your corrections'})`;
  let html = `<h3>DR-1028, dump gauge sheet</h3>
    <p class="sub">Barrels B-301 and B-302 into processing tank 2, October 28. ${status}.</p>
    <div class="sheet-photo"><svg viewBox="0 0 760 520" role="img" aria-label="Photo of the fictional handwritten dump gauge sheet DR-1028"><use href="#gauge-sheet" x="0" y="0" width="760" height="520"/></svg></div>
    <p class="note">${esc(extraction.how)} ${esc(extraction.seeded)} The extraction proposes values; the engine decides the accounts and report lines.</p>
    <ul class="fixes">${look.map((f) => {
      const val = S.pending[f.key] ?? cur.values[f.key] ?? '';
      const [x, y, w, h] = f.box;
      return `<li class="fix"><div class="crop"><svg viewBox="${x} ${y} ${w} ${h}" role="img" aria-label="The sheet at ${esc(fieldLabel(f.key, cur.values))}"><use href="#gauge-sheet" x="0" y="0" width="760" height="520"/></svg></div>
        <div><label for="f-${esc(f.key)}">${esc(fieldLabel(f.key, cur.values))}</label>
        <div class="ex">Extracted: ${f.value === null ? 'blank' : esc(f.value)}${f.confidence !== undefined ? `, confidence ${f.confidence}` : ''}${f.note ? `. ${esc(f.note)}` : ''}</div>
        <input id="f-${esc(f.key)}" data-key="${esc(f.key)}" value="${esc(val)}" inputmode="${/rows|total/.test(f.key) && !/serial/.test(f.key) ? 'decimal' : 'text'}" autocomplete="off" ${editable ? '' : 'disabled'}></div></li>`;
    }).join('')}</ul>`;
  if (!approved) {
    html += found.length
      ? `<ul class="issues">${found.map((i) => `<li>${esc(i.message)}</li>`).join('')}</ul>`
      : `<div class="ok-line">Version ${cur.v} passes every check: required fields, units, gauge arithmetic, sheet total, barrels in storage.</div>`;
  }
  const dirty = Object.entries(S.pending).some(([k, v]) => (cur.values[k] ?? '') !== v);
  html += `<div class="actions">
    ${editable ? `<button class="btn" data-act="save" ${dirty ? '' : 'disabled'}>Save as version ${cur.v + 1}</button>` : ''}
    ${approved ? `<button class="btn" data-act="edit" ${S.editing ? 'disabled' : ''}>Edit this record</button>` : `<button class="btn primary" data-act="approve" ${found.length || dirty ? 'disabled' : ''}>Approve version ${cur.v}</button>`}
  </div>`;
  if (S.message) html += `<p class="note">${esc(S.message)}</p>`;
  if (S.change) {
    const keys = Object.keys(S.change.after).filter((k) => S.change!.before[k] !== S.change!.after[k] && visibleKey(k));
    html += `<h3 style="font-size:17px;margin-top:6px">${keys.length} figure${keys.length === 1 ? '' : 's'} changed: ${esc(S.change.title)}</h3><ul class="diff">${keys.map((k) => {
      const [form, line, col] = k.split(':');
      return `<li><button data-act="sel" data-key="${esc(k)}"><span>${esc(form)} line ${esc(line)} (${esc(col)}): ${esc(sentence(S.month.reports.line(k).label))}</span><span class="ba"><s>${esc(S.change!.before[k])}</s>${esc(S.change!.after[k])}</span></button></li>`;
    }).join('')}</ul>`;
  }
  html += `<details class="allfields"><summary>All ${extraction.fields.length} fields, extracted and current</summary><div class="record"><table><tr><th>Field</th><th>Extracted</th><th>Version ${cur.v}</th></tr>${extraction.fields.map((f) => `<tr><td>${esc(fieldLabel(f.key, cur.values))}</td><td>${esc(f.value ?? 'blank')}</td><td>${esc(cur.values[f.key] ?? 'blank')}</td></tr>`).join('')}</table></div></details>`;
  html += `<h4 style="font:600 13px var(--sans);margin:0 0 6px">History</h4><ul class="history">${d.history.map((h) => `<li>${longDate(h.at)}: ${esc(h.action)}, version ${h.v}, by ${esc(h.by)}${h.detail ? ` (${esc(h.detail)})` : ''}</li>`).join('')}</ul>`;
  return html;
}

// ---------- statements ----------
function statementsPanel(): string {
  const st = S.month.statements.find((s) => s.client === S.client)!;
  const prev = S.change?.stBefore.find((s) => s.client === S.client);
  const changedKeys = new Set(prev ? st.rows.filter((r, i) => raw(r.pg) !== raw(prev.rows[i]!.pg)).map((r) => r.key) : []);
  const stamp = S.change ? (changedKeys.size ? `<span class="stamp moved">Changed by the last review action</span>` : `<span class="stamp same">Unchanged by the last review action</span>`) : '';
  const extra = (r: Statement['rows'][number]) => {
    const bits: string[] = [];
    if (r.cases !== undefined && r.cases !== 0) bits.push(`${r.cases} cases`);
    if (r.wg && r.key === 'bottled') bits.push(`${toFixed(r.wg, 2)} WG`);
    if (r.barrels && r.barrels.length && r.pg.u !== 0n) bits.push(r.barrels.join(', '));
    return bits.length ? `<span class="x">${esc(bits.join('; '))}</span>` : '';
  };
  return `<div class="seg" role="group" aria-label="Client">${S.month.statements.map((s) => `<button data-act="client" data-client="${s.client}" aria-pressed="${s.client === S.client}">${esc(s.name)}</button>`).join('')}</div>
    <h3>${esc(st.name)}, October 2026</h3>
    <p class="sub">${esc(st.note)}</p>
    ${stamp ? `<p>${stamp}</p>` : ''}
    <table class="stmt">${st.rows.map((r) => `<tr class="${r.pg.u === 0n ? 'zero' : ''} ${changedKeys.has(r.key) ? 'chg' : ''}"><td>${esc(r.label)}${extra(r)}</td><td class="v">${pg1(r.pg)}<span class="unit">PG</span>${changedKeys.has(r.key) && prev ? `<span class="x"><s>${pg1(prev.rows.find((x) => x.key === r.key)!.pg)}</s></span>` : ''}</td></tr>`).join('')}</table>
    <p class="note">${esc(plant.ownership)} Each figure filters the same postings the draft is built from; the three statements add up to the plant lines (see the checks below).</p>`;
}

// ---------- checks ----------
function renderChecks() {
  const cs = S.month.checks;
  const bad = cs.filter((c) => !c.pass).length;
  $('checks-title').textContent = bad ? `Checks on the current draft: ${bad} of ${cs.length} need attention` : `Checks on the current draft: all ${cs.length} pass`;
  $('checklist').innerHTML = cs.map((c) => `<li class="${c.pass ? 'pass' : 'fail'}"><span class="mark ${c.pass ? 'pass' : 'fail'}" aria-label="${c.pass ? 'passes' : 'needs attention'}">${c.pass ? '✓' : '✕'}</span>
    <span class="t">${esc(c.title)}${c.scenarioOnly ? '<span class="tag">this scenario only</span>' : ''}</span>
    <span class="d">${esc(c.detail)}</span>
    <span class="k">${c.independent ? 'Compared with a record the ledger did not produce' : 'Arithmetic of the draft itself'}</span></li>`).join('');
}

// ---------------- events ----------------
function onClick(ev: MouseEvent) {
  const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'entry') {
    S.entry = t.dataset.id!;
    S.tab = 'trace';
    render();
    if (window.matchMedia('(max-width: 1080px)').matches) $('inspector').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (act === 'sel') {
    S.selected = t.dataset.key!;
    S.entry = null;
    S.open = null;
    S.tab = 'trace';
    render();
    if (window.matchMedia('(max-width: 1080px)').matches) $('inspector').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (act === 'open') {
    S.open = S.open === t.dataset.id ? null : t.dataset.id!;
    renderInspector();
  } else if (act === 'tab') {
    S.tab = t.dataset.tab as Tab;
    renderInspector();
    if (t.closest('#status') && window.matchMedia('(max-width: 1080px)').matches) $('inspector').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (act === 'client') {
    S.client = t.dataset.client!;
    renderInspector();
  } else if (act === 'save') {
    const cur = latest(S.draft);
    const changes: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(S.pending)) if ((cur.values[k] ?? '') !== v) changes[k] = v.trim() === '' ? null : v.trim();
    const wasApproved = isApprovedLatest(S.draft);
    S.draft = correct(S.draft, changes, REVIEWER, today());
    S.pending = {};
    S.editing = false;
    if (wasApproved) {
      const s = syncDraft(S.ledger, S.draft, { plant, recordedOn: today() });
      recompute('approval withdrawn after an edit');
      const cancelled = (s.reversed ?? []).map((id) => `${S.ledger.get(id)?.reverses} cancelled by ${id}`).join(', ');
      S.message = `Approval withdrawn. Entry ${cancelled}, its exact negative; the original stays in the ledger and DR-1028 is out of the draft again.`;
    } else S.message = `Saved as version ${latest(S.draft).v}.`;
    render();
  } else if (act === 'approve') {
    const r = approve(S.draft, REVIEWER, today(), { ledger: S.ledger, plant });
    if (!r.ok) { S.message = 'Approval blocked: see the list above.'; renderInspector(); return; }
    S.draft = r.draft;
    if (r.already) { S.message = 'Already approved. Nothing booked twice.'; renderInspector(); return; }
    const s = syncDraft(S.ledger, S.draft, { plant, recordedOn: today() });
    recompute(`DR-1028 version ${S.draft.approval!.v} approved`);
    const e = S.ledger.get(s.posted!)!;
    S.message = `Booked as entry ${e.id}, dated ${longDate(e.date)} (the dump), booked ${longDate(e.recordedOn)}: it counts in October.`;
    render();
  } else if (act === 'edit') {
    S.editing = true;
    S.message = 'Change a value and save it as a new version: the approval is withdrawn and the entry reversed.';
    renderInspector();
  }
}

function onInput(ev: Event) {
  const t = ev.target as HTMLInputElement;
  if (!t.dataset.key) return;
  S.pending[t.dataset.key] = t.value;
  const cur = latest(S.draft);
  const dirty = Object.entries(S.pending).some(([k, v]) => (cur.values[k] ?? '') !== v);
  const save = document.querySelector<HTMLButtonElement>('[data-act="save"]');
  if (save) save.disabled = !dirty;
  const ap = document.querySelector<HTMLButtonElement>('[data-act="approve"]');
  if (ap && dirty) ap.disabled = true;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
