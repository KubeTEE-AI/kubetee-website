// Dev-only helper: verify th/td alignment classes match per table.
// Usage: node scripts/check-align.mjs [dist/dashboard/index.html]
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'dist/dashboard/index.html';
const html = readFileSync(file, 'utf8');
const tables = html.match(/<table[\s\S]*?<\/table>/g) ?? [];
let fail = 0;

tables.forEach((t, i) => {
  const ths = [...t.matchAll(/<th(\s[^>]*)?>/g)].map((m) =>
    (m[1] ?? '').includes('num') ? 'R' : 'L',
  );
  const tbody = t.split(/<tbody[^>]*>/)[1] ?? '';
  const firstRow = tbody.match(/<tr[^>]*>([\s\S]*?)<\/tr>/);
  if (!firstRow) {
    console.log(`table ${i + 1}: no body rows`);
    return;
  }
  const tds = [...firstRow[1].matchAll(/<td(\s[^>]*)?>/g)].map((m) =>
    (m[1] ?? '').includes('num') ? 'R' : 'L',
  );
  const ok = ths.length === tds.length && ths.every((v, j) => v === tds[j]);
  if (!ok) fail++;
  console.log(
    `table ${i + 1} | headers: ${ths.join(',')} | cells: ${tds.join(',')} ${ok ? '=> ALIGNED' : '=> MISMATCH!'}`,
  );
});

process.exit(fail ? 1 : 0);
