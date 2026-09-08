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

test('viewer favorites follow artwork navigation and remain available when images are unavailable', async () => {
  const source = readFileSync(join(__dirname, '../src/archive-viewer.js'), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export function', 'function');
  const element = () => ({
    ...button(), children: [], hidden: false,
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; }
  });
  const panel = element(), content = element();
  const keys = {};
  const context = {
    document: {
      createElement: element, addEventListener(type, fn) { keys[type] = fn; },
      documentElement: { classList: { add() {}, remove() {} } }
    },
    message: key => key, getImage: async () => null, readArchiveImage: async () => null,
    Element: class {}, HTMLElement: class {}, URL: { revokeObjectURL() {} }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const viewer = context.createArchiveViewer(panel, content, element(), element(), {
    createFavoriteButton(work) { const node = element(); node.workId = work.id; return node; }
  });
  const works = [{ id: '1', imageCount: 0 }, { id: '2', imageCount: 1 }];
  await viewer.showImages(works[0], { works, index: 0 });
  assert.equal(content.children[1].workId, '1');
  keys.keydown({ key: 'ArrowRight', preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(content.children[1].workId, '2');
  assert.equal(content.children[2].children[0].className, 'recovery-panel');
  viewer.close();
  assert.equal(panel.hidden, true);
  assert.equal(content.children.length, 0);
});
