const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const source = readFileSync(require('node:path').join(__dirname, '../src/archive.js'), 'utf8');
const renderTagFiltersSource = source.slice(
  source.indexOf('function renderTagFilters()'),
  source.indexOf('function popularTags()')
);

function createElement(tagName) {
  return {
    tagName,
    children: [],
    append(...children) { this.children.push(...children); },
    setAttribute() {},
    addEventListener() {}
  };
}

test('renders the 20 most popular tags', () => {
  const allTags = Array.from({ length: 25 }, (_, index) => ({
    key: `tag-${index + 1}`,
    label: `Tag ${index + 1}`
  }));
  const tagFilters = {
    replaceChildren(...children) { this.children = children; }
  };
  const context = {
    activeTags: new Set(),
    applyFilters() {},
    document: { createElement },
    favoriteOnly: false,
    message: key => key,
    popularTags: () => allTags,
    selectedIds: new Set(),
    tagFilters,
    works: [{}]
  };

  vm.createContext(context);
  vm.runInContext(renderTagFiltersSource, context);
  context.renderTagFilters();

  const scrollArea = tagFilters.children[1];
  assert.equal(scrollArea.children.length, 20);
  assert.equal(scrollArea.children[0].textContent, '#Tag 1');
  assert.equal(scrollArea.children[19].textContent, '#Tag 20');
});
