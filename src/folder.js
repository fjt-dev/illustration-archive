const HANDLE_DB = "pixiv-local-archive-folder";
const HANDLE_STORE = "settings";

function openHandleDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(HANDLE_STORE)) {
        request.result.createObjectStore(HANDLE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function chooseArchiveFolder() {
  if (!("showDirectoryPicker" in globalThis)) {
    throw new Error("このブラウザは記録先フォルダーの選択に対応していません");
  }
  const handle = await globalThis.showDirectoryPicker({ mode: "readwrite" });
  const permission = await handle.requestPermission({ mode: "readwrite" });
  if (permission !== "granted") throw new Error("フォルダーへの書き込みが許可されませんでした");
  const db = await openHandleDb();
  const tx = db.transaction(HANDLE_STORE, "readwrite");
  tx.objectStore(HANDLE_STORE).put(handle, "archive-folder");
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  await chrome.storage.local.set({ archiveFolderSelectionId: crypto.randomUUID() });
  return handle;
}

export async function getArchiveFolder() {
  const db = await openHandleDb();
  const tx = db.transaction(HANDLE_STORE, "readonly");
  const handle = await requestResult(tx.objectStore(HANDLE_STORE).get("archive-folder"));
  db.close();
  return handle || null;
}

export async function getArchiveFolderPermission(handle, mode = "read") {
  if (!handle) return "not-configured";
  return handle.queryPermission({ mode });
}

export async function requestArchiveFolderPermission(handle, mode = "readwrite") {
  if (!handle) return false;
  if (await handle.queryPermission({ mode }) === "granted") return true;
  return await handle.requestPermission({ mode }) === "granted";
}

export async function getArchiveFolderSelectionId() {
  const { archiveFolderSelectionId } = await chrome.storage.local.get("archiveFolderSelectionId");
  return archiveFolderSelectionId || null;
}

export async function saveArchiveToFolder(work, images) {
  const root = await getArchiveFolder();
  if (!root) return { saved: false, reason: "not-configured" };
  if (await root.queryPermission({ mode: "readwrite" }) !== "granted") {
    return { saved: false, reason: "permission-required" };
  }

  const directoryName = safeName(`${work.id}_${work.title || "untitled"}`);
  const directory = await root.getDirectoryHandle(directoryName, { create: true });
  await writeFile(directory, "metadata.json", new Blob([
    JSON.stringify({ ...work, imageCount: images.length }, null, 2)
  ], { type: "application/json" }));

  const imageFiles = [];
  for (let index = 0; index < images.length; index += 1) {
    const extension = extensionFor(images[index].mimeType);
    const fileName = `p${index}.${extension}`;
    await writeFile(directory, fileName, images[index].blob);
    imageFiles.push(fileName);
  }
  return {
    saved: true,
    folderName: root.name,
    folderSelectionId: await getArchiveFolderSelectionId(),
    folderDirectoryName: directoryName,
    imageFiles
  };
}

export async function readArchiveImages(work) {
  const root = await getArchiveFolder();
  if (!root) throw new Error("記録先フォルダーが選択されていません");
  return readArchiveImagesFromFolder(root, work);
}

export async function readArchiveImage(work, index = 0) {
  const root = await getArchiveFolder();
  if (!root) throw new Error("記録先フォルダーが選択されていません");
  if (await root.queryPermission({ mode: "read" }) !== "granted") {
    throw new Error("記録先フォルダーへのアクセス許可が必要です");
  }
  const directoryName = work.folderDirectoryName || safeName(`${work.id}_${work.title || "untitled"}`);
  const directory = await root.getDirectoryHandle(directoryName);
  const names = Array.isArray(work.imageFiles) && work.imageFiles.length
    ? work.imageFiles
    : await findImageFiles(directory);
  const name = names[index];
  if (!name) return null;
  const handle = await directory.getFileHandle(name);
  const blob = await handle.getFile();
  return { index, blob, mimeType: blob.type, byteSize: blob.size };
}

export async function readArchiveImagesFromFolder(root, work) {
  if (await root.queryPermission({ mode: "read" }) !== "granted") {
    throw new Error("記録先フォルダーへのアクセス許可が必要です");
  }

  const directoryName = work.folderDirectoryName || safeName(`${work.id}_${work.title || "untitled"}`);
  const directory = await root.getDirectoryHandle(directoryName);
  const names = Array.isArray(work.imageFiles) && work.imageFiles.length
    ? work.imageFiles
    : await findImageFiles(directory);
  const images = [];
  for (let index = 0; index < names.length; index += 1) {
    const handle = await directory.getFileHandle(names[index]);
    const blob = await handle.getFile();
    images.push({ index, blob, mimeType: blob.type, byteSize: blob.size });
  }
  return images;
}

async function findImageFiles(directory) {
  const names = [];
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind === "file" && /^p\d+\.(?:jpe?g|png|gif|webp)$/i.test(name)) names.push(name);
  }
  return names.sort((a, b) => Number(a.match(/^p(\d+)/)?.[1]) - Number(b.match(/^p(\d+)/)?.[1]));
}

async function writeFile(directory, name, blob) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function safeName(value) {
  const fallback = "untitled";
  const normalized = String(value)
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  const safe = replaceUnsafeTrailingCharacters(normalized);
  const shortened = replaceUnsafeTrailingCharacters(truncateUtf8(safe || fallback, 240));
  return shortened || fallback;
}

function replaceUnsafeTrailingCharacters(value) {
  return value.replace(/[. ~]+$/g, "_");
}

function truncateUtf8(value, maxBytes) {
  const encoder = new TextEncoder();
  let result = "";
  let byteLength = 0;
  for (const character of value) {
    const characterBytes = encoder.encode(character).length;
    if (byteLength + characterBytes > maxBytes) break;
    result += character;
    byteLength += characterBytes;
  }
  return result;
}

function extensionFor(mimeType) {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("gif")) return "gif";
  if (mimeType.includes("webp")) return "webp";
  return "jpg";
}
