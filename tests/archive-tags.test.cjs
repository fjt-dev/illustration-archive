const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const source = readFileSync(require('node:path').join(__dirname, '../src/archive.js'), 'utf8');
const renderTagFiltersSource = source.slice(
  source.indexOf('function renderTagFilters()'),
  source.indexOf('function popularTags()')
);
const popularTagsSource = source.slice(
  source.indexOf('function popularTags()'),
  source.indexOf('function card(work)')
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

test('hides tags shared by at least 80 percent of 30 or more artworks', () => {
  const works = Array.from({ length: 30 }, (_, index) => ({
    tags: [
      ...(index < 24 ? ['Common'] : []),
      ...(index < 12 ? ['Useful'] : [])
    ]
  }));
  const context = {
    COMMON_TAG_COVERAGE_THRESHOLD: 0.8,
    COMMON_TAG_MIN_WORKS: 30,
    Math,
    uiLocale: 'en',
    works
  };

  vm.createContext(context);
  vm.runInContext(popularTagsSource, context);
  const tags = context.popularTags();

  assert.equal(tags.find(tag => tag.key === 'common').hidden, true);
  assert.equal(tags.find(tag => tag.key === 'useful').hidden, false);
});

test('does not mark common tags as hidden below 30 artworks', () => {
  const context = {
    COMMON_TAG_COVERAGE_THRESHOLD: 0.8,
    COMMON_TAG_MIN_WORKS: 30,
    Math,
    uiLocale: 'en',
    works: Array.from({ length: 29 }, () => ({ tags: ['Common'] }))
  };

  vm.createContext(context);
  vm.runInContext(popularTagsSource, context);

  assert.equal(context.popularTags()[0].hidden, false);
});

test('ranks informative tags above tags that occur on nearly every artwork', () => {
  const context = {
    COMMON_TAG_COVERAGE_THRESHOLD: 0.8,
    COMMON_TAG_MIN_WORKS: 30,
    Math,
    uiLocale: 'en',
    works: Array.from({ length: 100 }, (_, index) => ({
      tags: [
        ...(index < 90 ? ['Common'] : []),
        ...(index < 40 ? ['Informative'] : [])
      ]
    }))
  };

  vm.createContext(context);
  vm.runInContext(popularTagsSource, context);
  const tags = context.popularTags();

  assert.equal(tags[0].key, 'informative');
  assert.ok(tags[0].score > tags[1].score);
});

test('counts a normalized tag only once per artwork', () => {
  const context = {
    COMMON_TAG_COVERAGE_THRESHOLD: 0.8,
    COMMON_TAG_MIN_WORKS: 30,
    Math,
    uiLocale: 'en',
    works: [{ tags: ['Tag', ' tag ', 'TAG'] }, { tags: ['tag'] }]
  };

  vm.createContext(context);
  vm.runInContext(popularTagsSource, context);

  assert.equal(context.popularTags()[0].count, 2);
});

test('keeps an active tag visible when its common-tag rank is hidden', () => {
  const allTags = [
    { key: 'common', label: 'Common', hidden: true },
    { key: 'useful', label: 'Useful', hidden: false }
  ];
  const tagFilters = {
    replaceChildren(...children) { this.children = children; }
  };
  const context = {
    activeTags: new Set(['common']),
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

  const labels = tagFilters.children[1].children.map(button => button.textContent);
  assert.deepEqual(labels, ['#Useful', '#Common']);
});
