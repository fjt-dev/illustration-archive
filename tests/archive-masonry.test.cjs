const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '../src/archive.js'), 'utf8');
const layoutSource = source.slice(source.indexOf('let masonryLayoutFrame = 0;'), source.indexOf('window.addEventListener("resize", scheduleMasonryLayout);'));

function tile(ratio) {
  const thumb = { style: {} };
  const info = { getBoundingClientRect: () => ({ height: 80 }) };
  const article = {
    isConnected: true,
    dataset: {},
    style: {},
    getBoundingClientRect: () => ({ width: 200 }),
    querySelector: selector => selector === '.card-info' ? info : thumb
  };
  const context = {
    grid: {},
    getComputedStyle: () => ({ gridAutoRows: '2px', rowGap: '8px' }),
    requestAnimationFrame: () => 1
  };
  vm.createContext(context);
  vm.runInContext(layoutSource, context);
  context.onThumbnailLoaded({
    closest: () => article,
    naturalWidth: ratio * 100,
    naturalHeight: 100
  });
  return { article, thumb, context };
}

test('tile height follows the loaded image aspect ratio', () => {
  const portrait = tile(0.5);
  const landscape = tile(2);
  assert.equal(portrait.article.style.gridRowEnd, 'span 49');
  assert.equal(landscape.article.style.gridRowEnd, 'span 19');
  assert.equal(portrait.thumb.style.aspectRatio, '0.5');
  assert.equal(landscape.thumb.style.aspectRatio, '2');
});

test('tile span includes the artwork information below the image', () => {
  const state = tile(1);
  assert.equal(state.article.style.gridRowEnd, 'span 29');
});
