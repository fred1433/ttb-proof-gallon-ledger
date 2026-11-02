// Bundles web/page.ts (which re-exports src/) into site/js/app.js, stamped with the commit.
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

const sh = (c) => { try { return execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
const commit = process.env.GITHUB_SHA || sh('git rev-parse HEAD') || 'unknown';
const dirty = !process.env.GITHUB_SHA && sh('git status --porcelain -- src web fixtures scripts') !== '';

const testSrc = readdirSync('tests').filter((f) => f.endsWith('.test.ts')).map((f) => readFileSync(`tests/${f}`, 'utf8')).join('\n');
const nTests = (testSrc.match(/^test\(/gm) || []).length;
const nProps = (testSrc.match(/fc\.assert\(/g) || []).length;
const testsText = `${nTests} tests (${nProps} of them property-based, hundreds of random cases each)`;

await build({
  entryPoints: ['web/page.ts'],
  outfile: 'site/js/app.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: false,
  legalComments: 'none',
  define: { __COMMIT__: JSON.stringify(commit + (dirty ? '-dirty' : '')), __TESTS__: JSON.stringify(testsText) },
  banner: { js: `// Built from https://github.com/fred1433/ttb-proof-gallon-ledger at ${commit}${dirty ? ' (uncommitted changes)' : ''}. Readable on purpose.` },
});
console.log(`site/js/app.js built from ${commit.slice(0, 7)}${dirty ? ' (dirty)' : ''}`);
