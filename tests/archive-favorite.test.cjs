const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '../src/archive.js'), 'utf8');
const favoriteSource = source.slice(source.indexOf('function bindFavoriteButton('), source.indexOf('function showFolderName('));

function setup(save, favoriteOnly = false) {
  const buttons = [];
  const state = { savingFavorites: new Set(), favoriteOnly, updateWorkMetadata: save,
    applyFilters() { state.filtered = true; }, alert(message) { state.error = message; },
    document: { querySelectorAll: () => buttons } };
  vm.createContext(state);
  vm.runInContext(favoriteSource, state);
  state.button = (work) => {
    const button = { dataset: {}, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; },
      addEventListener(type, listener) { if (type === "click") this.click = () => listener({ stopPropagation() {} }); else this[type] = listener; } };
    buttons.push(button);
    state.bindFavoriteButton(button, work);
    return button;
  };
  return state;
}

test('viewer and card share saved favorites and filtered results update', async () => {
  const saved = [];
  const state = setup(async (id, value) => saved.push([id, value.favorite]), true);
  const work = { id: '1', favorite: false };
  const card = state.button(work);
  const viewer = state.button(work);
  await viewer.click();
  assert.equal(card.attributes['aria-pressed'], 'true');
  assert.equal(viewer.attributes['aria-pressed'], 'true');
  assert.equal(state.filtered, true);
  await card.click();
  assert.equal(viewer.attributes['aria-pressed'], 'false');
  assert.deepEqual(saved, [['1', true], ['1', false]]);
});

test('pending save blocks repeated clicks even after reopening a work', async () => {
  let finish;
  let saves = 0;
  const state = setup(() => { saves++; return new Promise(resolve => { finish = resolve; }); });
  const work = { id: '1' };
  const pending = state.button(work).click();
  const reopened = state.button(work);
  assert.equal(reopened.attributes['aria-disabled'], 'true');
  await reopened.click();
  assert.equal(saves, 1);
  finish();
  await pending;
  assert.equal(reopened.attributes['aria-disabled'], 'false');
});

test('failed save restores both controls without changing another work', async () => {
  const state = setup(async () => { throw new Error('保存失敗'); });
  const work = { id: '1', favorite: true };
  const card = state.button(work);
  const viewer = state.button(work);
  const other = state.button({ id: '2', favorite: false });
  await viewer.click();
  assert.equal(work.favorite, true);
  assert.equal(card.attributes['aria-pressed'], 'true');
  assert.equal(viewer.attributes['aria-busy'], 'false');
  assert.equal(other.attributes['aria-pressed'], 'false');
  assert.equal(state.error, '保存失敗');
});

test('card and viewer likes trigger a burst; unlike and failed saves clear it', async () => {
  const state = setup(async () => {});
  const work = { id: '1', favorite: true };
  const viewer = state.button(work);
  assert.equal(viewer.dataset.favoriteAnimation, undefined);
  await viewer.click();
  assert.equal(viewer.dataset.favoriteAnimation, undefined);
  await viewer.click();
  assert.equal(viewer.dataset.favoriteAnimation, 'true');
  await viewer.click();
  assert.equal(viewer.dataset.favoriteAnimation, undefined);
  const card = state.button(work);
  await card.click();
  assert.equal(card.dataset.favoriteAnimation, 'true');
  assert.equal(viewer.dataset.favoriteAnimation, undefined);
  card.animationend({ animationName: 'favorite-pop' });
  assert.equal(card.dataset.favoriteAnimation, 'true');
  card.animationend({ animationName: 'favorite-burst' });
  assert.equal(card.dataset.favoriteAnimation, undefined);
  await card.click();
  await card.click();
  assert.equal(card.dataset.favoriteAnimation, 'true');
  const failed = setup(async () => { throw new Error('保存失敗'); });
  const failedViewer = failed.button({ id:'2', favorite:false });
  await failedViewer.click();
  assert.equal(failedViewer.dataset.favoriteAnimation, undefined);
});
