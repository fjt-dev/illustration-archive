const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const styles = readFileSync(path.join(__dirname, '../src/styles.css'), 'utf8');

test('dark selection actions remain distinguishable from artwork', () => {
  const rule = styles.match(/\.archive-page \.selection-actions-controls \{([\s\S]*?)\}/)?.[1] || '';

  assert.match(rule, /border:\s*1px solid #73737b/);
  assert.match(rule, /background:\s*#343438/);
  assert.match(rule, /box-shadow:\s*0 14px 36px/);
});

test('light selection actions keep the high-contrast black surface', () => {
  assert.match(
    styles,
    /:root\[data-theme="light"\] \.archive-page \.selection-actions-controls \{[^}]*background:\s*#000/
  );
});

test('full-screen viewer turns the artwork into a soft color backdrop', () => {
  const backdropRule = styles.match(/#viewer-content \.viewer-stage > \.viewer-backdrop \{([\s\S]*?)\}/)?.[1] || '';
  const artworkRule = styles.match(/#viewer-content \.viewer-stage > \.viewer-artwork \{([\s\S]*?)\}/)?.[1] || '';

  assert.match(backdropRule, /object-fit:\s*cover/);
  assert.match(backdropRule, /filter:\s*blur\(72px\) saturate\(1\.2\)/);
  assert.match(artworkRule, /object-fit:\s*scale-down/);
});

test('viewer pagination keeps stable contrast over artwork backdrops', () => {
  const rule = styles.match(/\.viewer-pagination \{([\s\S]*?)\}/)?.[1] || '';

  assert.match(rule, /color:\s*#fff/);
  assert.match(rule, /background:\s*rgb\(17 19 24 \/ 82%\)/);
  assert.match(rule, /border-radius:\s*999px/);
});
