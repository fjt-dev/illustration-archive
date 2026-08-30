const DB_NAME = "pixiv-local-archive";
const DB_VERSION = 1;
const WORKS = "works";
const IMAGES = "images";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WORKS)) {
        const works = db.createObjectStore(WORKS, { keyPath: "id" });
        works.createIndex("archivedAt", "archivedAt");
      }
      if (!db.objectStoreNames.contains(IMAGES)) {
        const images = db.createObjectStore(IMAGES, { keyPath: "key" });
        images.createIndex("workId", "workId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function complete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveArchive(work, images, { storeImages = true } = {}) {
  const db = await openDb();
  const tx = db.transaction([WORKS, IMAGES], "readwrite");
  const workStore = tx.objectStore(WORKS);
  const imageStore = tx.objectStore(IMAGES);
  const existingWork = await requestResult(workStore.get(work.id));
  const oldKeys = await requestResult(imageStore.index("workId").getAllKeys(work.id));
  oldKeys.forEach((key) => imageStore.delete(key));
  if (storeImages) {
    images.forEach((image, index) => imageStore.put({
      key: `${work.id}:${index}`,
      workId: work.id,
      index,
      blob: image.blob,
      mimeType: image.mimeType,
      byteSize: image.blob.size
    }));
  }
  workStore.put({
    ...existingWork,
    ...work,
    archivedAt: new Date().toISOString(),
    imageCount: images.length,
    byteSize: images.reduce((sum, image) => sum + image.blob.size, 0)
  });
  await complete(tx);
  db.close();
}

export async function listWorks() {
  const db = await openDb();
  const tx = db.transaction(WORKS, "readonly");
  const works = await requestResult(tx.objectStore(WORKS).getAll());
  db.close();
  return works.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
}

export async function getWork(workId) {
  const db = await openDb();
  const tx = db.transaction(WORKS, "readonly");
  const work = await requestResult(tx.objectStore(WORKS).get(workId));
  db.close();
  return work || null;
}

export async function updateWorkMetadata(workId, metadata) {
  const db = await openDb();
  const tx = db.transaction(WORKS, "readwrite");
  const store = tx.objectStore(WORKS);
  const work = await requestResult(store.get(workId));
  if (!work) {
    db.close();
    throw new Error("記録済み作品が見つかりませんでした");
  }
  store.put({ ...work, ...metadata });
  await complete(tx);
  db.close();
}

export async function getImages(workId) {
  const db = await openDb();
  const tx = db.transaction(IMAGES, "readonly");
  const images = await requestResult(tx.objectStore(IMAGES).index("workId").getAll(workId));
  db.close();
  return images.sort((a, b) => a.index - b.index);
}

export async function deleteImages(workId) {
  const db = await openDb();
  const tx = db.transaction(IMAGES, "readwrite");
  const store = tx.objectStore(IMAGES);
  const keys = await requestResult(store.index("workId").getAllKeys(workId));
  keys.forEach((key) => store.delete(key));
  await complete(tx);
  db.close();
}

export async function deleteWork(workId) {
  const db = await openDb();
  const tx = db.transaction([WORKS, IMAGES], "readwrite");
  tx.objectStore(WORKS).delete(workId);
  const imageStore = tx.objectStore(IMAGES);
  const keys = await requestResult(imageStore.index("workId").getAllKeys(workId));
  keys.forEach((key) => imageStore.delete(key));
  await complete(tx);
  db.close();
}
