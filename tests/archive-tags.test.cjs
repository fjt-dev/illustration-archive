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
const renderTagListSource = source.slice(
  source.indexOf('function renderTagList()'),
  source.indexOf('function popularTags()')
);

function createElement(tagName) {
  const classes = new Set();
  return {
    tagName,
    attributes: {},
    children: [],
    classList: {
      contains(name) { return classes.has(name); },
      toggle(name, force) { force ? classes.add(name) : classes.delete(name); }
    },
    dataset: {},
    clientWidth: 100,
    scrollLeft: 0,
    scrollWidth: 100,
    append(...children) { this.children.push(...children); },
    setAttribute(name, value) { this.attributes[name] = value; },
    listeners: {},
    addEventListener(name, listener) { this.listeners[name] = listener; },
    replaceChildren(...children) { this.children = children; }
  };
}

test('renders the complete tag list by artwork count with tag-name tie breaking', () => {
  const clearButton = {};
  const tagList = {
    replaceChildren(...children) { this.children = children; }
  };
  const context = {
    activeTags: new Set(['beta']),
    applyFilters() {},
    CSS: { escape: value => value },
    document: {
      createElement,
      querySelector: selector => selector === '#clear-tag-selection' ? clearButton : createElement('div')
    },
    message: (_key, values) => Array.isArray(values) ? values.join('/') : values,
    noMatchingTags: {},
    popularTags: () => [
      { key: 'beta', label: 'Beta', count: 2 },
      { key: 'gamma', label: 'Gamma', count: 4 },
      { key: 'alpha', label: 'Alpha', count: 4 }
    ],
    tagDialogSummary: {},
    tagList,
    tagSearchQuery: '',
    uiLocale: 'en'
  };

  vm.createContext(context);
  vm.runInContext(renderTagListSource, context);
  context.renderTagList();

  assert.deepEqual(tagList.children.map(button => button.children[0].textContent), ['#Alpha', '#Gamma', '#Beta']);
  assert.deepEqual(tagList.children.map(button => button.children[1].textContent), ['4', '4', '2']);
  assert.equal(tagList.children[2].attributes['aria-pressed'], 'true');
  assert.equal(context.tagDialogSummary.textContent, '3/1');
  assert.equal(clearButton.disabled, false);
});

test('filters the complete tag list by its search query', () => {
  const tagList = {
    replaceChildren(...children) { this.children = children; }
  };
  const context = {
    activeTags: new Set(),
    applyFilters() {},
    CSS: { escape: value => value },
    document: { createElement, querySelector: () => createElement('div') },
    message: () => '',
    noMatchingTags: {},
    popularTags: () => [
      { key: 'landscape', label: 'Landscape', count: 5 },
      { key: 'portrait', label: 'Portrait', count: 3 }
    ],
    tagDialogSummary: {},
    tagList,
    tagSearchQuery: 'trait',
    uiLocale: 'en'
  };

  vm.createContext(context);
  vm.runInContext(renderTagListSource, context);
  context.renderTagList();

  assert.deepEqual(tagList.children.map(button => button.children[0].textContent), ['#Portrait']);
  assert.equal(context.noMatchingTags.hidden, true);
});

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

  assert.equal(tagFilters.children[0].className, "tag-filter favorite-filter");
  assert.equal(tagFilters.children[1].className, "tag-reset show-all-tags");
  const scrollArea = tagFilters.children[2];
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

  const labels = tagFilters.children[2].children.map(button => button.textContent);
  assert.deepEqual(labels, ['#Useful', '#Common']);
});


test('shows every active tag outside the scroll strip, even beyond the popular limit', () => {
  const allTags = Array.from({ length: 30 }, (_, index) => ({
    key: `tag-${index}`, label: `Tag ${index}`, hidden: index === 29
  }));
  const tagFilters = createElement('nav');
  tagFilters.querySelector = () => ({ focus() {} });
  let filterUpdates = 0;
  const context = {
    activeTags: new Set(['tag-0', 'tag-25', 'tag-29']),
    applyFilters() { filterUpdates++; context.renderTagFilters(); },
    document: { createElement }, favoriteOnly: false,
    message: (key, value) => `${key}:${value}`,
    popularTags: () => allTags, selectedIds: new Set(), tagFilters, works: [{}]
  };
  vm.createContext(context);
  vm.runInContext(renderTagFiltersSource, context);
  context.renderTagFilters();
  const lane = tagFilters.children.at(-1);
  assert.equal(lane.className, 'selected-tag-lane');
  assert.equal(lane.children[1].className, 'tag-reset selected-tag-reset');
  const summary = lane.children[0];
  assert.equal(summary.className, 'selected-tag-summary');
  assert.deepEqual(summary.children.slice(1).map(button => button.children[0].textContent),
    ['#Tag 0', '#Tag 25', '#Tag 29']);
  assert.equal(summary.children[0].textContent, 'selectedTagsCount:3');
  assert.equal(summary.children[2].attributes['aria-label'], 'removeSelectedTag:Tag 25');
  summary.children[2].listeners.click();
  assert.equal(context.activeTags.has('tag-25'), false);
  assert.equal(context.activeTags.has('tag-29'), true);
  assert.equal(filterUpdates, 1);
  assert.equal(tagFilters.children.at(-1).children[0].children.length, 3);
  tagFilters.children.at(-1).children[1].listeners.click();
  assert.equal(context.activeTags.size, 0);
  assert.equal(tagFilters.children.some(child => child.className === 'selected-tag-lane'), false);
  assert.equal(filterUpdates, 2);
});

test('keeps selected tags visible and removable while dialog search has no matches', () => {
  const selectedTags = createElement('div');
  const clearButton = {};
  let filterUpdates = 0;
  let searchFocus = 0;
  const context = {
    activeTags: new Set(['portrait']),
    applyFilters() { filterUpdates++; },
    document: { createElement, querySelector: selector =>
      selector === '#tag-dialog-selected' ? selectedTags : clearButton },
    message: (key, value) => `${key}:${value}`,
    popularTags: () => [{ key: 'portrait', label: 'Portrait', count: 3 }],
    noMatchingTags: {}, tagDialogSummary: {}, tagList: createElement('div'),
    tagSearchInput: { focus() { searchFocus++; } },
    tagSearchQuery: 'no matches', uiLocale: 'en'
  };
  vm.createContext(context);
  vm.runInContext(renderTagListSource, context);
  context.renderTagList();
  assert.equal(context.tagList.children.length, 0);
  assert.equal(context.noMatchingTags.hidden, false);
  assert.equal(selectedTags.hidden, false);
  assert.equal(selectedTags.children[0].children[1].children[0].textContent, '#Portrait');
  selectedTags.children[0].children[1].listeners.click();
  assert.equal(context.activeTags.size, 0);
  assert.equal(selectedTags.hidden, true);
  assert.equal(selectedTags.children.length, 0);
  assert.equal(clearButton.disabled, true);
  assert.equal(filterUpdates, 1);
  assert.equal(searchFocus, 1);
});
