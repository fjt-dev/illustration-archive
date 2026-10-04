const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../src/archive-viewer.js'), 'utf8')
  .replace(/^import .*;\n/gm, '').replace('export function', 'function');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup() {
  const requests = [], images = [], created = [], revoked = [], listeners = {};
  class Element {
    constructor() {
      this.children = []; this.attributes = {}; this.listeners = {};
      this.classList = { add() {}, remove() {} }; this.isConnected = true;
    }
    set textContent(value) { this.text = value; this.children = []; }
    get textContent() { return this.text; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(key, fn) { this.listeners[key] = fn; }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    matches() { return false; }
  }
  const content = new Element(), panel = new Element();
  panel.hidden = true; panel.querySelector = () => null;
  const context = {
    document: {
      activeElement: null, createElement: () => new Element(),
      documentElement: { classList: { add() {}, remove() {} } },
      addEventListener: (key, fn) => { listeners[key] = fn; }
    },
    Element, HTMLElement: Element, requestAnimationFrame() {}, message: key => key,
    getImage: (id, index) => {
      const request = { id, index, ...deferred() }; requests.push(request); return request.promise;
    },
    readArchiveImage: async () => null,
    Image: class extends Element {
      constructor() { super(); this.decoding = deferred(); images.push(this); }
      decode() { return this.decoding.promise; }
    },
    URL: {
      createObjectURL: () => { const url = `blob:${created.length}`; created.push(url); return url; },
      revokeObjectURL: url => revoked.push(url)
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const viewer = context.createArchiveViewer(panel, content, new Element(), new Element());
  const works = [{ id: 'a', imageCount: 4 }, { id: 'b', imageCount: 2 }, { id: 'c', imageCount: 1 }];
  const read = async (index, image = { blob: {} }) => { requests[index].resolve(image); await flush(); };
  const decode = async url => { images.filter(image => image.src === url).forEach(image => image.decoding.resolve()); await flush(); };
  const step = (shiftKey = false) => listeners.keydown({ key: 'ArrowRight', shiftKey, preventDefault() {} });
  const stage = () => content.children.find(node => node.className === 'viewer-stage');
  const first = async () => {
    const opening = viewer.showImages(works[0], { works, index: 0 });
    await read(0); await decode(created[0]); await opening;
  };
  return { viewer, content, panel, works, requests, images, created, revoked, read, decode, step, stage, first };
}

test('retains the artwork and backdrop until both replacement images are decoded', async () => {
  const h = setup(); await h.first();
  const stage = h.stage(), displayed = [...stage.children];
  h.step();
  assert.deepEqual(stage.children, displayed);
  assert.deepEqual(h.revoked, []);
  await h.read(1);
  h.images.filter(image => image.src === h.created[1])[0].decoding.resolve();
  await flush();
  assert.deepEqual(stage.children, displayed);
  assert.deepEqual(h.revoked, []);
  await h.decode(h.created[1]);
  assert.equal(stage.children[1].src, h.created[1]);
  assert.equal(stage.attributes['aria-busy'], 'false');
  assert.deepEqual(h.revoked, [h.created[0]]);
});

test('rapid arrows advance requested pages and stale decoding cannot replace the newest page', async () => {
  const h = setup(); await h.first();
  h.step(); await h.read(1);
  h.step(); await h.read(2);
  assert.deepEqual(h.requests.map(r => r.index), [0, 1, 2]);
  await h.decode(h.created[2]);
  const latest = h.stage().children[1];
  await h.decode(h.created[1]);
  assert.equal(h.stage().children[1], latest);
  assert.equal(latest.src, h.created[2]);
  assert.deepEqual(h.revoked, [h.created[0], h.created[1]]);
});

test('retains the same stage across artworks and ignores superseded reads and errors', async () => {
  const h = setup(); await h.first();
  const stage = h.stage(), displayed = [...stage.children];
  h.step(true); h.step(true);
  assert.equal(h.stage(), stage);
  assert.deepEqual(stage.children, displayed);
  assert.deepEqual(h.requests.map(r => r.id), ['a', 'b', 'c']);
  h.requests[1].reject(new Error('superseded read failed')); await flush();
  assert.deepEqual(stage.children, displayed);
  assert.equal(stage.attributes['aria-busy'], 'true');
  await h.read(2); await h.decode(h.created[1]);
  assert.equal(stage.children[1].src, h.created[1]);
  assert.deepEqual(h.revoked, [h.created[0]]);
});

test('closing during decoding never reopens the viewer and releases both object URLs', async () => {
  const h = setup(); await h.first();
  h.step(); await h.read(1);
  h.viewer.close();
  assert.deepEqual(h.revoked, [h.created[0]]);
  await h.decode(h.created[1]);
  assert.equal(h.panel.hidden, true);
  assert.equal(h.content.children.length, 0);
  assert.deepEqual(h.revoked, h.created);
});

test('a current decode failure shows recovery and releases the failed and previous images', async () => {
  const h = setup(); await h.first();
  h.step(); await h.read(1);
  h.images.filter(image => image.src === h.created[1])[1].decoding.reject(new Error('invalid image'));
  await flush();
  assert.equal(h.stage().children[0].className, 'recovery-panel');
  assert.equal(h.stage().attributes['aria-busy'], 'false');
  assert.deepEqual(h.revoked, h.created);
});
