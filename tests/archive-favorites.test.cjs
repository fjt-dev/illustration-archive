const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

function button() {
  return {
    dataset: {}, attributes: {}, listeners: {}, title: '',
    classList: { add() {}, remove() {} },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(type, listener) { this.listeners[type] = listener; },
    click() { return this.listeners.click({ stopPropagation() {} }); }
  };
}

function setup(save) {
  const source = readFileSync(join(__dirname, '../src/archive.js'), 'utf8');
  const buttons = [button(), button()];
  const context = {
    document: { querySelectorAll: () => buttons },
    pendingFavorites: new Set(), message: key => key,
    updateWorkMetadata: save, favoriteOnly: true,
    applyFilters() { context.filterUpdates++; }, filterUpdates: 0,
    alert(error) { context.error = error; }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function bindFavoriteButton('), source.indexOf('function showFolderName(')), context);
  const work = { id: '42', favorite: false };
  buttons.forEach(b => context.bindFavoriteButton(b, work));
  return { context, buttons, work };
}

test('viewer and card synchronize immediately and block duplicate saves across buttons', async () => {
  let resolve, calls = 0;
  const { context, buttons, work } = setup(() => { calls++; return new Promise(r => { resolve = r; }); });
  const saving = buttons[1].click();
  for (const b of buttons) {
    assert.equal(b.attributes['aria-pressed'], 'true');
    assert.equal(b.attributes['aria-disabled'], 'true');
    assert.equal(b.attributes['aria-label'], 'removeFavorite');
  }
  await buttons[0].click();
  assert.equal(calls, 1);
  resolve();
  await saving;
  assert.equal(work.favorite, true);
  assert.equal(context.filterUpdates, 1);
  assert.equal(buttons[0].attributes['aria-disabled'], 'false');
  const removing = buttons[0].click();
  resolve();
  await removing;
  assert.equal(work.favorite, false);
  assert.equal(buttons[1].attributes['aria-pressed'], 'false');
});

test('failed persistence restores both buttons and permits retry', async () => {
  const { context, buttons, work } = setup(async () => { throw new Error('Save failed'); });
  await buttons[1].click();
  assert.equal(work.favorite, false);
  for (const b of buttons) {
    assert.equal(b.attributes['aria-pressed'], 'false');
    assert.equal(b.attributes['aria-disabled'], 'false');
    assert.equal(b.attributes['aria-label'], 'addFavorite');
  }
  assert.equal(context.error, 'Save failed');
  assert.equal(context.pendingFavorites.size, 0);
});

test('a button created during a save reflects the pending state without affecting other works', async () => {
  let resolve;
  const { context, buttons, work } = setup(() => new Promise(r => { resolve = r; }));
  const saving = buttons[0].click();
  const reopened = button();
  context.bindFavoriteButton(reopened, work);
  buttons.push(reopened);
  assert.equal(reopened.attributes['aria-disabled'], 'true');
  assert.equal(reopened.attributes['aria-pressed'], 'true');
  const other = button();
  context.bindFavoriteButton(other, { id: '99', favorite: false });
  buttons.push(other);
  resolve();
  await saving;
  assert.equal(reopened.attributes['aria-disabled'], 'false');
  assert.equal(other.attributes['aria-pressed'], 'false');
});

function setupViewer() {
  const source = readFileSync(join(__dirname, '../src/archive-viewer.js'), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export function', 'function');
  class TestElement {
    constructor() {
      Object.assign(this, button());
      this.children = [];
      this.hidden = false;
      this.isConnected = true;
    }
    append(...nodes) { this.children.push(...nodes); }
    contains(node) { return this === node || this.children.some(child => child.contains?.(node)); }
    replaceChildren(...nodes) {
      if (this.contains(context.document.activeElement)) context.document.activeElement = null;
      this.children = nodes;
    }
    focus() { context.document.activeElement = this; }
  }
  const element = () => new TestElement();
  const panel = element(), content = element(), close = element(), returnControl = element();
  panel.hidden = true;
  panel.querySelector = () => close;
  const keys = {}, frames = [];
  const context = {
    document: {
      activeElement: null,
      createElement: element, addEventListener(type, fn) { keys[type] = fn; },
      documentElement: { classList: { add() {}, remove() {} } }
    },
    requestAnimationFrame: fn => frames.push(fn),
    message: key => key, getImage: async () => null, readArchiveImage: async () => null,
    Element: TestElement, HTMLElement: TestElement, URL: { revokeObjectURL() {} }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const viewer = context.createArchiveViewer(panel, content, element(), element(), {
    createFavoriteButton(work) { const node = element(); node.workId = work.id; return node; },
    getReturnFocus: () => returnControl
  });
  return {
    viewer, content, panel, close, returnControl, element,
    document: context.document,
    flushFrames: () => { while (frames.length) frames.shift()(); },
    step: key => keys.keydown({ key, preventDefault() {} })
  };
}

test('viewer favorites follow artwork navigation and remain available when images are unavailable', async () => {
  const { viewer, content, panel, step } = setupViewer();
  const works = [{ id: '1', imageCount: 0 }, { id: '2', imageCount: 1 }];
  await viewer.showImages(works[0], { works, index: 0 });
  assert.equal(content.children[1].workId, '1');
  step('ArrowRight');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(content.children[1].workId, '2');
  assert.equal(content.children[2].children[0].className, 'recovery-panel');
  viewer.close();
  assert.equal(panel.hidden, true);
  assert.equal(content.children.length, 0);
});

for (const removedIndex of [0, 1, 2]) {
  test(`filter refresh excludes removed artwork at position ${removedIndex} from navigation`, async () => {
    const { viewer, content, step } = setupViewer();
    const works = ['a', 'b', 'c'].map(id => ({ id, imageCount: 0 }));
    await viewer.showImages(works[removedIndex], { works, index: removedIndex });
    const remaining = works.filter((_, index) => index !== removedIndex);
    viewer.updateNavigation(remaining);
    assert.equal(content.children[1].workId, remaining[Math.min(removedIndex, 1)].id);
    step('ArrowLeft');
    assert.equal(content.children[1].workId, remaining[0].id);
    step('ArrowRight');
    assert.equal(content.children[1].workId, remaining[1].id);
    step('ArrowLeft');
    assert.equal(content.children[1].workId, remaining[0].id);
  });
}

test('removing the last matching artwork closes the viewer and clears navigation', async () => {
  const { viewer, content, panel, step } = setupViewer();
  const works = [{ id: 'a', imageCount: 0 }];
  await viewer.showImages(works[0], { works, index: 0 });
  viewer.updateNavigation([]);
  assert.equal(panel.hidden, true);
  step('ArrowRight');
  assert.equal(content.children.length, 0);
});

test('refresh preserves the current page and updates arrow availability for surviving artworks', async () => {
  const { viewer, content, step } = setupViewer();
  const works = ['a', 'b'].map(id => ({ id, imageCount: 2 }));
  await viewer.showImages(works[1], { works, index: 1 });
  step('ArrowRight');
  await new Promise(resolve => setImmediate(resolve));
  const controls = content.children[3];
  assert.equal(controls.children[0].children[0].textContent, '2 / 2');
  viewer.updateNavigation([works[1]]);
  assert.equal(content.children[3], controls);
  assert.equal(controls.children[0].children[0].textContent, '2 / 2');
  step('ArrowLeft');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controls.children[1].disabled, true);
  viewer.updateNavigation([works[0], works[1]]);
  assert.equal(controls.children[1].disabled, false);
});

test('applying favorites filters passes the sorted results to the open viewer', () => {
  const source = readFileSync(join(__dirname, '../src/archive.js'), 'utf8');
  let received;
  const context = {
    works: [{ id: 'a', favorite: false }, { id: 'b', favorite: true }],
    activeTags: new Set(), searchQuery: '', favoriteOnly: true,
    normalizeTag: tag => tag, sortOrder: 'archived-desc',
    sortComparators: { 'archived-desc': () => 0 }, render() {},
    archiveViewer: { updateNavigation(works) { received = works; } }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function applyFilters()'), source.indexOf('function render(')), context);
  context.applyFilters();
  assert.equal(received.length, 1);
  assert.equal(received[0].id, 'b');
});

for (const imageCount of [0, 1]) {
  test(`replacing a focused favorite keeps keyboard focus inside the viewer (${imageCount} images)`, async () => {
    const { viewer, content, close, document, flushFrames } = setupViewer();
    const works = ['a', 'b'].map(id => ({ id, imageCount }));
    await viewer.showImages(works[0], { works, index: 0 });
    flushFrames();
    content.children[1].focus();
    viewer.updateNavigation([works[1]]);
    assert.equal(content.children[1].workId, 'b');
    assert.equal(document.activeElement, close);
  });
}

test('closing after the originating card is removed restores focus to an archive control', async () => {
  const { viewer, content, element, returnControl, document, flushFrames } = setupViewer();
  const card = element();
  card.focus();
  const works = [{ id: 'a', imageCount: 0 }];
  await viewer.showImages(works[0], { works, index: 0 });
  flushFrames();
  card.isConnected = false;
  content.children[1].focus();
  viewer.updateNavigation([]);
  assert.equal(document.activeElement, returnControl);
});

test('closing still restores a connected original focus target without a delayed focus steal', async () => {
  const { viewer, element, document, flushFrames } = setupViewer();
  const card = element();
  card.focus();
  await viewer.showImages({ id: 'a', imageCount: 0 });
  viewer.close();
  flushFrames();
  assert.equal(document.activeElement, card);
});
