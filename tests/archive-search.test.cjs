const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const source = readFileSync(require('node:path').join(__dirname, '../src/archive.js'), 'utf8');
const searchCandidatesSource = source.slice(
  source.indexOf('function normalizeSearchText(value)'),
  source.indexOf('function renderSearchSuggestions()')
);
const searchNormalizationSource = source.slice(
  source.indexOf('function normalizeSearchText(value)'),
  source.indexOf('function searchCandidates(query)')
);
const rememberSearchSource = source.slice(
  source.indexOf('function rememberSearch(value)'),
  source.indexOf('function render(items,')
);

function candidatesFor(works, query) {
  const context = { works, uiLocale: 'en' };
  vm.createContext(context);
  vm.runInContext(searchCandidatesSource, context);
  return context.searchCandidates(query);
}

test('search suggestions prioritize prefix matches and then artwork frequency', () => {
  const results = candidatesFor([
    { title: 'Blue Sky', creatorName: 'Sky Artist', tags: ['Sky', 'Blue'] },
    { title: 'Night Sky', creatorName: 'Another Artist', tags: ['Sky'] },
    { title: 'Skylight', creatorName: 'Studio', tags: [] }
  ], 'sky');

  assert.deepEqual(
    Array.from(results).slice(0, 3).map(({ label, count }) => [label, count]),
    [['Sky', 2], ['Sky Artist', 1], ['Skylight', 1]]
  );
});

test('search suggestions count a repeated value only once per artwork', () => {
  const results = candidatesFor([
    { title: 'Cat', creatorName: 'Cat', tags: ['Cat', 'cat'] },
    { title: 'Cat drawing', creatorName: 'Artist', tags: ['Cat'] }
  ], 'cat');

  assert.equal(results.find(({ key }) => key === 'cat').count, 2);
});

test('an empty query has no generated suggestions', () => {
  assert.deepEqual(Array.from(candidatesFor([{ title: 'Artwork', tags: ['Tag'] }], '  ')), []);
});

test('search normalizes width, kana, case, and tag prefixes', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(searchNormalizationSource, context);

  assert.equal(context.normalizeSearchText(' ＣＡＴ　ネコ '), 'cat ねこ');
  assert.deepEqual(Array.from(context.searchTokens('#ＣＡＴ　＃ネコ')), ['cat', 'ねこ']);
  assert.equal(context.searchMatchRank('ねこのえ', 'ネコ'), 1);
});

test('multi-word suggestions require every search term', () => {
  const results = candidatesFor([
    { title: 'Blue night sky', creatorName: 'Artist', tags: ['Night'] },
    { title: 'Blue ocean', creatorName: 'Another Artist', tags: ['Day'] }
  ], 'blue night');

  assert.deepEqual(Array.from(results, ({ label }) => label), ['Blue night sky']);
});

test('search history keeps four recent unique queries', () => {
  let saved = [];
  const context = {
    chrome: {
      storage: {
        local: {
          set(payload) {
            saved = Array.from(payload.archiveSearchHistory);
            return Promise.resolve();
          }
        }
      }
    },
    console,
    searchHistory: [],
    SEARCH_SUGGESTION_LIMIT: 4
  };
  vm.createContext(context);
  vm.runInContext(searchNormalizationSource, context);
  vm.runInContext(rememberSearchSource, context);

  ['first', 'second', 'third', 'fourth', 'fifth', 'SECOND'].forEach((query) => {
    context.rememberSearch(query);
  });

  assert.deepEqual(saved, ['SECOND', 'fifth', 'fourth', 'third']);
});

test('a search history entry can be removed independently', () => {
  let saved = [];
  let focused = false;
  const context = {
    chrome: {
      storage: {
        local: {
          set(payload) {
            saved = Array.from(payload.archiveSearchHistory);
            return Promise.resolve();
          }
        }
      }
    },
    console,
    searchHistory: ['Cat', 'Dog', 'Bird'],
    SEARCH_SUGGESTION_LIMIT: 4,
    searchInput: { focus() { focused = true; } }
  };
  vm.createContext(context);
  vm.runInContext(searchNormalizationSource, context);
  vm.runInContext(rememberSearchSource, context);

  context.removeSearchHistory('dog');

  assert.deepEqual(saved, ['Cat', 'Bird']);
  assert.equal(focused, true);
});
