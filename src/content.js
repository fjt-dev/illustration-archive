(() => {
if (globalThis.__ILLUSTRATION_ARCHIVE_LOADED__) return;
globalThis.__ILLUSTRATION_ARCHIVE_LOADED__ = true;

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
  return {
    id,
    sourceUrl: location.href,
    title: illust?.title || document.querySelector("h1")?.textContent?.trim() || `pixiv ${id}`,
    creatorId: String(illust?.userId || ""),
    creatorName: illust?.userName || "",
    description: illust?.description || "",
    tags: illust?.tags?.tags?.map((tag) => tag.tag) || [],
    postedAt: illust?.createDate || null,
    pageCount: Number(illust?.pageCount || 0)
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "PING") {
    sendResponse({ ok: true });
    return false;
  }
  if (message.type !== "GET_CURRENT_WORK") return false;
  try { sendResponse({ ok: true, work: currentWork() }); }
  catch (error) { sendResponse({ ok: false, error: error.message }); }
  return false;
});

let autoSaveTimer;
let retryTimer;
let lastArtworkId;
let artworkWatchTimer;
let disposed = false;

function scheduleAutoSave(delay = 700, retry = false, bookmarkAction = false) {
  if (disposed) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    if (disposed) return;
    try {
      const work = currentWork();
      lastArtworkId = work.id;
      const result = await chrome.runtime.sendMessage({
        type: "AUTO_ARCHIVE_WORK",
        work,
        bookmarkAction
      });
      if (!result?.ok) {
        showNotice(result?.error || "自動保存に失敗しました", true);
        return;
      }
      if (result?.ok && !result.skipped) showSavedNotice();
      if (retry && result?.reason === "not-bookmarked") {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => scheduleAutoSave(0), 2200);
      }
    } catch (error) {
      if (isInvalidatedContext(error)) {
        dispose();
        return;
      }
      console.warn("Illustration Archive: automatic saving failed", error);
    }
  }, delay);
}

function isInvalidatedContext(error) {
  return String(error?.message || error).includes("Extension context invalidated");
}

function dispose() {
  disposed = true;
  clearTimeout(autoSaveTimer);
  clearTimeout(retryTimer);
  clearInterval(artworkWatchTimer);
  document.removeEventListener("click", handlePageClick, true);
}

function showSavedNotice() {
  showNotice("ローカルに保存しました");
}

function showNotice(message, isError = false) {
  document.querySelector("[data-illustration-archive-notice]")?.remove();
  const notice = document.createElement("div");
  notice.dataset.illustrationArchiveNotice = "";
  notice.textContent = message;
  Object.assign(notice.style, {
    position: "fixed", right: "20px", bottom: "20px", zIndex: "2147483647",
    padding: "10px 14px", borderRadius: "10px", color: "white",
    background: isError ? "rgba(156, 45, 58, .96)" : "rgba(22, 27, 34, .94)",
    boxShadow: "0 8px 30px rgba(0,0,0,.3)",
    font: "13px system-ui, sans-serif"
  });
  document.body.append(notice);
  setTimeout(() => notice.remove(), 2500);
}

scheduleAutoSave();

function handlePageClick(event) {
  const bookmarkAction = isBookmarkAction(event);
  scheduleAutoSave(850, true, bookmarkAction);
}

function isBookmarkAction(event) {
  if (!(event.target instanceof Element)) return false;
  const control = event.target.closest("button, [role='button']");
  if (!control) return false;
  const label = [
    control.getAttribute("aria-label"),
    control.getAttribute("title"),
    control.textContent
  ].filter(Boolean).join(" ");
  return !/解除|削除|remove|unbookmark/i.test(label)
    && /ブックマーク|いいね|bookmark|like/i.test(label);
}

document.addEventListener("click", handlePageClick, true);

artworkWatchTimer = setInterval(() => {
  const id = location.pathname.match(/\/artworks\/(\d+)/)?.[1];
  if (id && id !== lastArtworkId) scheduleAutoSave(300);
}, 1000);
})();
