const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = readFileSync(path.join(__dirname, '../src/archive-viewer.js'), 'utf8');

test('image pages render an inert backdrop before the accessible artwork', () => {
  assert.match(source, /backdrop\.className = "viewer-backdrop"/);
  assert.match(source, /backdrop\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(source, /node\.className = "viewer-artwork"/);
  assert.match(source, /stage\.replaceChildren\(backdrop, node\)/);
});
