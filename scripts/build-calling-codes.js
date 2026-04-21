/**
 * One-off / refresh: reads restcountries JSON from disk, writes
 * backend/go/internal/meta/calling_codes.json
 *
 * Usage: node scripts/build-calling-codes.js <path-to-restcountries-all.json>
 */
const fs = require('fs');
const path = require('path');

const inputPath =
  process.argv[2] ||
  path.join(
    process.env.USERPROFILE || '',
    '.cursor',
    'projects',
    'c-Users-ozcan-MacRadar',
    'agent-tools',
    '80e3fb54-2e67-4e7f-8fbe-b290456cd2af.txt',
  );

function commonPrefix(arr) {
  if (!arr.length) {
    return '';
  }
  let a = arr[0];
  for (let i = 1; i < arr.length; i++) {
    const b = arr[i];
    let j = 0;
    while (j < a.length && j < b.length && a[j] === b[j]) {
      j++;
    }
    a = a.slice(0, j);
    if (!a) {
      return '';
    }
  }
  return a;
}

function dialFor(c) {
  const root =
    (c.idd && c.idd.root ? String(c.idd.root).replace(/^\+/, '') : '') || '';
  const rawSuf =
    c.idd && Array.isArray(c.idd.suffixes) ? c.idd.suffixes : undefined;
  const suf = rawSuf === undefined || rawSuf.length === 0 ? [''] : rawSuf;
  const cc = c.cca2;
  if (!root && suf.every(s => !String(s || '').length)) {
    return null;
  }
  if (root === '1') {
    return '1';
  }
  if (root === '7' && (cc === 'RU' || cc === 'KZ')) {
    return '7';
  }
  const fulls = suf
    .map(s => root + String(s == null ? '' : s))
    .filter(x => /^\d+$/.test(x));
  if (!fulls.length) {
    return /^\d{1,4}$/.test(root) ? root : null;
  }
  if (fulls.length === 1) {
    const d = fulls[0];
    return d.length >= 1 && d.length <= 4 ? d : null;
  }
  let cp = commonPrefix(fulls);
  while (cp.length > 4) {
    cp = cp.slice(0, -1);
  }
  if (cp.length >= 1) {
    return cp;
  }
  return null;
}

const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const out = [];
for (const c of data) {
  const dial = dialFor(c);
  if (!dial) {
    continue;
  }
  out.push({
    iso2: c.cca2,
    dial,
    flag: c.flag || '',
    name: c.name && c.name.common ? c.name.common : c.cca2,
  });
}
out.sort((a, b) => a.name.localeCompare(b.name, 'en'));
const outPath = path.join(
  __dirname,
  '..',
  'backend',
  'go',
  'internal',
  'meta',
  'calling_codes.json',
);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ countries: out }));
console.log('Wrote', out.length, 'countries to', outPath);
