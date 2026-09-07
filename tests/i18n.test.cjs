const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const english = JSON.parse(readFileSync(join(root, '_locales/en/messages.json'), 'utf8'));
const japanese = JSON.parse(readFileSync(join(root, '_locales/ja/messages.json'), 'utf8'));

test('English and Japanese locale catalogs contain the same messages', () => {
  assert.deepEqual(Object.keys(english).sort(), Object.keys(japanese).sort());
});

test('all message keys used by extension source exist in both catalogs', () => {
  const files = [
    'src/archive.js', 'src/archive-viewer.js', 'src/background.js', 'src/content.js',
    'src/db.js', 'src/folder.js', 'src/popup.js', 'src/theme.js'
  ];
  const keys = files.flatMap((file) => {
    const source = readFileSync(join(root, file), 'utf8');
    return [...source.matchAll(/message\("([A-Za-z0-9_]+)"/g)].map((match) => match[1]);
  });
  for (const key of keys) {
    assert.ok(english[key], `missing English message: ${key}`);
    assert.ok(japanese[key], `missing Japanese message: ${key}`);
  }
});

test('all message keys used by extension HTML exist in both catalogs', () => {
  for (const file of ['src/archive.html', 'src/popup.html']) {
    const source = readFileSync(join(root, file), 'utf8');
    const textKeys = [...source.matchAll(/data-i18n="([A-Za-z0-9_]+)"/g)]
      .map((match) => match[1]);
    const attributeKeys = [...source.matchAll(/data-i18n-attrs="([^"]+)"/g)]
      .flatMap((match) => match[1].split(',').map((entry) => entry.split(':')[1]));
    for (const key of [...textKeys, ...attributeKeys]) {
      assert.ok(english[key], `missing English message: ${key}`);
      assert.ok(japanese[key], `missing Japanese message: ${key}`);
    }
  }
});
