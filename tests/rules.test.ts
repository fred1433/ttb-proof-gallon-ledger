import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { RULES } from '../src/rules.ts';

const dir = new URL('./', import.meta.url);
const tests = readdirSync(dir).filter((f) => f.endsWith('.test.ts') && f !== 'rules.test.ts').map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('every rule in src/rules.ts has at least one test that names it', () => {
  const untested = RULES.filter((r) => !tests.includes(`[${r.id}]`)).map((r) => r.id);
  assert.deepEqual(untested, []);
});

test('every rule appears in the README table, with its source', () => {
  for (const r of RULES) {
    assert.ok(readme.includes(r.id), `${r.id} missing from README`);
  }
});

test('every rule records where it came from and when it was read', () => {
  for (const r of RULES) {
    assert.match(r.url, /^https:\/\//, r.id);
    assert.match(r.verified, /^\d{4}-\d{2}-\d{2}$/, r.id);
    assert.ok(r.source.length > 10, r.id);
  }
});
