const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const source = readFileSync(require('node:path').join(__dirname, '../src/archive.js'), 'utf8');
const renderSource = source.slice(source.indexOf('function render(items,'), source.indexOf('function updateScrollFooter()'));

function renderAtOffset(mode, reset) {
  const events = [];
  const items = Array.from({ length: 110 }, (_, id) => ({ id }));
  const context = {
    works: items, summary: {}, formatBytes: () => '', renderTagFilters() {},
    scrollObserver: { disconnect() {} }, thumbnailObserver: { disconnect() {} },
    viewMode: mode, renderedCount: 108, BATCH_SIZE: 36,
    document: { querySelectorAll: () => [] },
    window: { scrollTo(options) { assert.equal(options.behavior, 'instant'); context.scrollY = options.top; events.push('scroll'); } },
    scrollY: 4000,
    grid: { classList: { toggle() {} }, replaceChildren(...cards) { context.cards = cards; events.push('replace'); } },
    card: item => item,
    updateScrollFooter() { events.push('observe'); }, updateSelectionControls() {}
  };
  vm.createContext(context);
  vm.runInContext(renderSource, context);
  context.render(items, { reset });
  return { ...context, events };
}

test('resetting progressive results returns to the top before replacing cards and observing', () => {
  const state = renderAtOffset('infinite', true);
  assert.equal(state.scrollY, 0);
  assert.equal(state.cards.length, 36);
  assert.deepEqual(state.events, ['scroll', 'replace', 'observe']);
});

test('selection-only rendering preserves scroll position and loaded batches', () => {
  const state = renderAtOffset('infinite', false);
  assert.equal(state.scrollY, 4000);
  assert.equal(state.cards.length, 108);
});

test('standard result rendering retains existing scroll behavior', () => {
  const state = renderAtOffset('standard', true);
  assert.equal(state.scrollY, 4000);
  assert.equal(state.cards.length, 110);
});
