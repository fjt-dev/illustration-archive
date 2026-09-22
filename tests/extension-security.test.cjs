const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const backgroundSource = readFileSync(path.join(root, 'src/background.js'), 'utf8');
const contentSource = readFileSync(path.join(root, 'src/content.js'), 'utf8');

test('privileged page button only accepts a trusted click and confirms the operation', () => {
  assert.match(contentSource, /if \(!event\?\.isTrusted\) return;/);
  assert.match(contentSource, /confirm\(message\("confirmRecordArtwork"\)\)/);
  assert.match(contentSource, /CONTENT_SCRIPT_VERSION = 9/);
});

test('invalidated extension contexts fall back without throwing', () => {
  const helpers = contentSource.slice(
    contentSource.indexOf('const extensionApi = globalThis.chrome;'),
    contentSource.indexOf('try { globalThis[INSTANCE_KEY]')
  );
  const context = {
    chrome: {
      runtime: { get id() { throw new Error('Extension context invalidated'); } },
      i18n: { getMessage() { throw new Error('Extension context invalidated'); } }
    }
  };
  vm.createContext(context);
  vm.runInContext(helpers, context);

  assert.equal(context.extensionContextAvailable(), false);
  assert.equal(context.message('recordButton'), 'recordButton');
});

test('image Referer rule is dynamic and restricted to this extension', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, '3.6.0');
  assert.equal(manifest.declarative_net_request, undefined);
  assert.equal(existsSync(path.join(root, 'rules.json')), false);
  assert.match(backgroundSource, /initiatorDomains: \[chrome\.runtime\.id\]/);
  assert.match(backgroundSource, /requestDomains: \["i\.pximg\.net"\]/);
});

test('work input accepts numeric IDs and canonicalizes extension-controlled URLs', () => {
  const helpers = backgroundSource.slice(
    backgroundSource.indexOf('function normalizeWork(work)'),
    backgroundSource.indexOf('function embeddedImageReferences(work)')
  );
  const context = {
    MAX_IMAGE_COUNT: 200,
    URL,
    message: key => key
  };
  vm.createContext(context);
  vm.runInContext(helpers, context);

  assert.throws(() => context.normalizeWork({ id: '../settings' }), /artworkIdFailed/);
  const work = context.normalizeWork({
    id: '123',
    sourceUrl: 'javascript:alert(1)',
    title: 'Example',
    originalImageUrls: [
      'https://i.pximg.net/image.jpg',
      'https://i.pximg.net.attacker.example/image.jpg'
    ]
  });
  assert.equal(work.sourceUrl, 'https://www.pixiv.net/artworks/123');
  assert.deepEqual([...work.originalImageUrls], ['https://i.pximg.net/image.jpg']);
});

test('image downloads enforce count, per-image, total-size, and MIME limits', () => {
  assert.match(backgroundSource, /MAX_IMAGE_COUNT = 200/);
  assert.match(backgroundSource, /MAX_IMAGE_BYTES = 32 \* 1024 \* 1024/);
  assert.match(backgroundSource, /MAX_TOTAL_IMAGE_BYTES = 256 \* 1024 \* 1024/);
  assert.match(backgroundSource, /unsupportedImageType/);
});
