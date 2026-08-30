(() => {
const INSTANCE_KEY = "__ILLUSTRATION_ARCHIVE_INSTANCE__";
const CONTENT_SCRIPT_VERSION = 5;
try { globalThis[INSTANCE_KEY]?.dispose?.(); } catch {}

function parsePreload() {
  const node = document.querySelector("#meta-preload-data");
  if (!node?.content) return null;
  try { return JSON.parse(node.content); } catch { return null; }
}

function currentWork() {
  const id = location.pathname.match(/\/artworks\/(\d+)/)?.[1];
  if (!id) throw new Error("作品IDを取得できませんでした");

  const preload = parsePreload();
  const illust = preload?.illust?.[id];
  const embeddedImageUrls = Object.values(illust?.urls || {})
    .filter((url) => typeof url === "string" && url.startsWith("https://i.pximg.net/"));
  const originalImageUrls = [illust?.urls?.original]
    .filter((url) => typeof url === "string" && url.startsWith("https://i.pximg.net/"));
  const tags = tagNames(illust?.tags);
  const creatorId = String(illust?.userId || "");
  const creatorName = illust?.userName || "";
  const postedAt = illust?.createDate || null;
  return {
    id,
    sourceUrl: location.href,
    title: illust?.title || document.querySelector("h1")?.textContent?.trim() || `pixiv ${id}`,
    creatorId,
    creatorName,
    description: illust?.description || "",
    tags: tags || [],
    postedAt,
    pageCount: Number(illust?.pageCount || 0),
    originalImageUrls,
    originalImageFileNames: [...new Set(embeddedImageUrls.map(imageFileName).filter(Boolean))],
    metadataComplete: Boolean(illust && creatorId && creatorName && postedAt && tags)
  };
}

function tagNames(value) {
  const values = Array.isArray(value) ? value : value?.tags;
  if (!Array.isArray(values)) return null;
  return values
    .map((tag) => typeof tag === "string" ? tag : tag?.tag)
    .filter(Boolean);
}

function imageFileName(url) {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || ""); }
  catch { return ""; }
}

function handleRuntimeMessage(message, _sender, sendResponse) {
  if (message.type === "PING") {
    sendResponse({ ok: true, version: CONTENT_SCRIPT_VERSION });
    return false;
  }
  if (message.type !== "GET_CURRENT_WORK") return false;
  try { sendResponse({ ok: true, work: currentWork() }); }
  catch (error) { sendResponse({ ok: false, error: error.message }); }
  return false;
}

chrome.runtime.onMessage.addListener(handleRuntimeMessage);

let disposed = false;
const instance = { dispose };
globalThis[INSTANCE_KEY] = instance;

const recordButton = createRecordButton();
let currentArtworkPath = location.pathname;
const navigationHandler = () => queueMicrotask(updateRecordButton);
globalThis.navigation?.addEventListener("currententrychange", navigationHandler);
globalThis.addEventListener("popstate", navigationHandler);
updateRecordButton();

function createRecordButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.illustrationArchiveRecord = "";
  button.textContent = "＋ 記録";
  button.setAttribute("aria-label", "この作品を記録");
  Object.assign(button.style, {
    position: "fixed", right: "24px", bottom: "104px", zIndex: "2147483646",
    minWidth: "88px", height: "42px", padding: "0 16px", border: "0",
    borderRadius: "21px", color: "white", background: "#0096fa",
    font: "600 14px system-ui, sans-serif", cursor: "pointer"
  });
  button.addEventListener("click", recordCurrentWork);
  document.documentElement.append(button);
  return button;
}

function updateRecordButton() {
  const artworkPath = location.pathname.match(/^\/artworks\/\d+/)?.[0] || "";
  recordButton.hidden = !artworkPath;
  if (artworkPath && artworkPath !== currentArtworkPath) {
    currentArtworkPath = artworkPath;
    recordButton.disabled = false;
    recordButton.textContent = "＋ 記録";
  }
}

async function recordCurrentWork() {
  recordButton.disabled = true;
  recordButton.textContent = "記録中…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "ARCHIVE_WORK", work: currentWork() });
    if (!result?.ok) throw new Error(result?.error || "記録に失敗しました");
    recordButton.textContent = "✓ 記録済み";
    showSavedNotice();
  } catch (error) {
    if (isInvalidatedContext(error)) return dispose();
    recordButton.disabled = false;
    recordButton.textContent = "再試行";
    showNotice(error.message || "記録に失敗しました", true);
  }
}

function isInvalidatedContext(error) {
  return String(error?.message || error).includes("Extension context invalidated");
}

function dispose() {
  if (disposed) return;
  disposed = true;
  globalThis.navigation?.removeEventListener("currententrychange", navigationHandler);
  globalThis.removeEventListener("popstate", navigationHandler);
  recordButton.remove();
  try { chrome.runtime.onMessage.removeListener(handleRuntimeMessage); } catch {}
  if (globalThis[INSTANCE_KEY] === instance) delete globalThis[INSTANCE_KEY];
}

function showSavedNotice() {
  showNotice("作品を記録しました");
}

function showNotice(message, isError = false) {
  document.querySelector("[data-illustration-archive-notice]")?.remove();
  const notice = document.createElement("div");
  notice.dataset.illustrationArchiveNotice = "";
  notice.textContent = message;
  Object.assign(notice.style, {
    position: "fixed", right: "24px", bottom: "156px", zIndex: "2147483647",
    padding: "10px 14px", borderRadius: "10px", color: "white",
    background: isError ? "rgba(156, 45, 58, .96)" : "rgba(22, 27, 34, .94)",
    boxShadow: "0 8px 30px rgba(0,0,0,.3)",
    font: "13px system-ui, sans-serif"
  });
  document.body.append(notice);
  setTimeout(() => notice.remove(), 2500);
}

})();
