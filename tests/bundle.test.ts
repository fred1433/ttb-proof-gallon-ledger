// The page runs site/js/app.js, built from src/ by scripts/build.mjs. This test imports that
// exact file and checks it computes what the source computes, so the page and CI agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { buildMonth, figures as srcFigures } from '../src/index.ts';

const bundle = new URL('../site/js/app.js', import.meta.url);

test('the page bundle computes the same month as the source', { skip: !existsSync(bundle) && !process.env.CI ? 'run npm run build first' : false }, async () => {
  const b = await import(bundle.href);
  assert.deepEqual(b.figures(b.buildMonth().reports), srcFigures(buildMonth().reports));
  const d = b.correct(b.initialDraft(), { 'rows.1.proof': '117.0', 'rows.1.pg': '46.9' }, 'reviewer', '2026-11-02');
  const a = b.approve(d, 'reviewer', '2026-11-02', { ledger: b.bookRecords(), plant: b.plant });
  assert.ok(a.ok);
  const fig = b.figures(b.buildMonth(a.draft).reports);
  for (const [k, v] of Object.entries(b.expected.figures)) assert.equal(fig[k], v, k);
});
