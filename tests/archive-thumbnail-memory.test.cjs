const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '../src/archive-viewer.js'), 'utf8');
const thumbnailSource = source.slice(
  source.indexOf('  async function loadThumbnail('),
  source.indexOf('  async function showImages(')
);
const compactSource = source.slice(
  source.indexOf('  async function compactThumbnail('),
  source.indexOf('  function openViewer(')
);

function harness(loadStoredImage) {
  const revoked = [];
  const images = [];
  const context = {
    WeakMap,
    loadStoredImage,
    compactThumbnail: async (blob) => blob,
    message: (key) => key,
    URL: {
      createObjectURL: () => 'blob:thumbnail',
      revokeObjectURL: (url) => revoked.push(url)
    },
    Image: class {
      constructor() { images.push(this); }
      removeAttribute(name) { if (name === 'src') this.src = ''; }
    }
  };
  vm.createContext(context);
  vm.runInContext(`const thumbnailRequests = new WeakMap(); ${thumbnailSource}
    globalThis.thumbnailApi = { loadThumbnail, unloadThumbnail };`, context);
  const node = {
    isConnected: true,
    children: [],
    replaceChildren(...children) { this.children = children; },
    querySelector(selector) { return selector === 'img' ? this.children[0] : null; }
  };
  return { ...context.thumbnailApi, node, images, revoked };
}

test('a thumbnail leaving view before its blob arrives is never decoded', async () => {
  let resolveImage;
  const pending = new Promise((resolve) => { resolveImage = resolve; });
  const { loadThumbnail, unloadThumbnail, node, images, revoked } = harness(() => pending);
  const loading = loadThumbnail(node, { imageCount: 1 });
  unloadThumbnail(node);
  resolveImage({ blob: {} });
  await loading;
  assert.equal(images.length, 0);
  assert.deepEqual(revoked, []);
  assert.equal(node.children.length, 0);
});

test('unloading a decoded thumbnail releases its object URL and image element', async () => {
  const { loadThumbnail, unloadThumbnail, node, images, revoked } = harness(async () => ({ blob: {} }));
  await loadThumbnail(node, { imageCount: 1 });
  assert.equal(images.length, 1);
  unloadThumbnail(node);
  images[0].onload();
  assert.deepEqual(revoked, ['blob:thumbnail']);
  assert.equal(node.children.length, 0);
  assert.equal(images[0].src, '');
});

test('large originals become bounded thumbnails and release bitmap buffers', async () => {
  const closed = [];
  const drawn = [];
  const context = {
    createImageBitmap: async (_blob, options) => {
      const bitmap = options.resizeWidth
        ? { width: 480, height: 1600 }
        : { width: 288, height: 960 };
      bitmap.close = () => closed.push(bitmap);
      return bitmap;
    },
    OffscreenCanvas: class {
      constructor(width, height) { this.width = width; this.height = height; }
      getContext() { return { drawImage(bitmap) { drawn.push(bitmap); } }; }
      async convertToBlob() { return { type: 'image/webp', size: 12000 }; }
    }
  };
  vm.createContext(context);
  vm.runInContext(`const thumbnailQueue = []; let thumbnailConversions = 0;
    ${compactSource} globalThis.compactThumbnailApi = compactThumbnail;`, context);
  const result = await context.compactThumbnailApi({}, () => true);
  assert.equal(result.type, 'image/webp');
  assert.equal(drawn[0].height, 960);
  assert.equal(closed.length, 2);
});
